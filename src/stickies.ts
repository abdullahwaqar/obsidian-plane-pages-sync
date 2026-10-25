// Two-way sync between a folder of notes and your Plane stickies.
//
// Each sticky is one note with `plane_sticky` (its id) and `plane_color` in the properties.
// For every sticky we remember the content hash on both sides at the last sync. On each pull:
//   - only Plane changed    -> rewrite the note
//   - only the note changed -> push it
//   - both changed          -> the newer version wins and the other is kept as a "(conflict)" copy,
//                              which itself becomes a new sticky, so nothing is lost.
import { Events, getFrontMatterInfo, Notice, normalizePath, parseYaml, type TFile } from "obsidian";
import type PlanePagesSync from "./main";
import { PlaneError, type PlaneSticky } from "./plane";
import type { StickyRecord } from "./settings";
import {
    isStickyColor,
    normalizeMarkdown,
    plainText,
    planeHtmlToMarkdown,
    randomStickyColor,
    type StickyColor,
    stickyMarkdownToHtml,
    stickyTitle,
} from "./stickyConvert";
import { errorMessage, hash, isInFolder, withLock } from "./util";

export const FM_STICKY = "plane_sticky";
export const FM_COLOR = "plane_color";

interface LocalSticky
{
    id?: string;
    color: StickyColor;
    body: string;
    hash: string;
}

function contentHash(body: string, color: string)
{
    return hash(`${normalizeMarkdown(body)}\n${color}`);
}

function stamp()
{
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${
        pad(d.getMinutes())
    }`;
}

export class StickySync extends Events
{
    private timers = new Map<string, number>();
    private pulling: Promise<void> | null = null;
    lastPull = 0;
    lastError = "";

    constructor(private plugin: PlanePagesSync)
    {
        super();
    }

    get app()
    {
        return this.plugin.app;
    }

    get settings()
    {
        return this.plugin.settings;
    }

    get enabled()
    {
        return this.settings.stickiesEnabled && !!this.folder;
    }

    get folder()
    {
        const f = this.settings.stickiesFolder.trim();
        return f ? normalizePath(f) : "";
    }

    isStickyFile(file: TFile)
    {
        return file.extension === "md" && isInFolder(file.path, this.folder);
    }

    files(): TFile[]
    {
        return this.app.vault.getMarkdownFiles().filter((f) => this.isStickyFile(f));
    }

    get pending()
    {
        return this.timers.size;
    }

    destroy()
    {
        for (const t of this.timers.values())
        {
            window.clearTimeout(t);
        }
        this.timers.clear();
    }

    private changed()
    {
        this.trigger("changed");
    }

    // ---------- reading and writing notes ----------

    async readLocal(file: TFile): Promise<LocalSticky>
    {
        const content = await this.app.vault.read(file);
        const info = getFrontMatterInfo(content);
        let fm: Record<string, unknown> = {};
        if (info.exists)
        {
            try
            {
                fm = (parseYaml(info.frontmatter) as Record<string, unknown> | null) ?? {};
            }
            catch
            {
                fm = {};
            }
        }
        const body = content.slice(info.contentStart);
        const color = isStickyColor(fm[FM_COLOR]) ? fm[FM_COLOR] : "gray";
        const id = typeof fm[FM_STICKY] === "string" && fm[FM_STICKY] ? fm[FM_STICKY] : undefined;
        return { id, color, body, hash: contentHash(body, color) };
    }

    /** Replaces the note body, keeping any other properties the user added. */
    async writeBody(file: TFile, body: string)
    {
        await this.app.vault.process(file, (data) =>
        {
            const info = getFrontMatterInfo(data);
            const head = info.exists ? data.slice(0, info.contentStart) : "";
            return `${head}${head && !head.endsWith("\n") ? "\n" : ""}${body.trim()}\n`;
        });
    }

    async setProps(file: TFile, props: { id?: string | null; color?: StickyColor; })
    {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) =>
        {
            if (props.id === null)
            {
                delete fm[FM_STICKY];
            }
            else if (props.id)
            {
                fm[FM_STICKY] = props.id;
            }
            if (props.color)
            {
                fm[FM_COLOR] = props.color;
            }
        });
    }

    private async uniquePath(title: string)
    {
        await this.ensureFolder();
        let path = normalizePath(`${this.folder}/${title}.md`);
        for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++)
        {
            path = normalizePath(`${this.folder}/${title} ${i}.md`);
        }
        return path;
    }

    private async ensureFolder()
    {
        if (!this.app.vault.getFolderByPath(this.folder))
        {
            await this.app.vault.createFolder(this.folder);
        }
    }

    private async createNote(title: string, body: string, color: StickyColor, id?: string): Promise<TFile>
    {
        const path = await this.uniquePath(title);
        const props = [id ? `${FM_STICKY}: ${id}` : "", `${FM_COLOR}: ${color}`].filter(Boolean).join("\n");
        return this.app.vault.create(path, `---\n${props}\n---\n${body.trim()}\n`);
    }

    /** Creates a new, empty sticky note and returns it. Plane gets it on the next push. */
    async newSticky(): Promise<TFile>
    {
        const file = await this.createNote("Sticky", "", randomStickyColor());
        this.records()[`local:${file.path}`] = {
            path: file.path,
            localHash: "",
            remoteHash: "",
            autoName: file.basename,
        };
        this.plugin.saveSettings();
        this.schedule(file);
        return file;
    }

    private records(): Record<string, StickyRecord>
    {
        return this.settings.stickies;
    }

    private recordFor(path: string): [string, StickyRecord] | undefined
    {
        return Object.entries(this.records()).find(([, r]) => r.path === path);
    }

    // ---------- push (note -> Plane) ----------

    schedule(file: TFile, delayMs = 2000)
    {
        if (!this.enabled || !this.plugin.configured)
        {
            return;
        }
        const prev = this.timers.get(file.path);
        if (prev)
        {
            window.clearTimeout(prev);
        }
        const t = window.setTimeout(() =>
        {
            this.timers.delete(file.path);
            const current = this.app.vault.getFileByPath(file.path);
            if (current)
            {
                void this.push(current);
            }
            this.changed();
        }, delayMs);
        this.timers.set(file.path, t);
        this.changed();
    }

    push(file: TFile): Promise<void>
    {
        return withLock(`sticky:${file.path}`, async () =>
        {
            if (!this.enabled || !this.plugin.configured || !this.isStickyFile(file))
            {
                return;
            }
            try
            {
                const local = await this.readLocal(file);
                const html = stickyMarkdownToHtml(local.body);
                const input = {
                    description_html: html,
                    description_stripped: plainText(local.body),
                    background_color: local.color,
                };
                const found = this.recordFor(file.path);
                let id = local.id;
                let rec = found?.[1];

                if (id && rec && found?.[0] === id && rec.localHash === local.hash)
                {
                    return; // nothing new
                }

                let sticky: PlaneSticky | null = null;
                if (id)
                {
                    try
                    {
                        sticky = await this.plugin.client.updateSticky(id, input);
                    }
                    catch (e)
                    {
                        if (!(e instanceof PlaneError && e.status === 404))
                        {
                            throw e;
                        }
                        id = undefined; // deleted in Plane while edited here: recreate
                    }
                }
                if (!id)
                {
                    sticky = await this.plugin.client.createSticky(input);
                    id = sticky.id;
                    await this.setProps(file, { id, color: local.color });
                }

                if (found && found[0] !== id)
                {
                    delete this.records()[found[0]];
                }
                const remoteBody = sticky?.description_html
                    ? planeHtmlToMarkdown(sticky.description_html)
                    : planeHtmlToMarkdown(html);
                rec = {
                    path: file.path,
                    localHash: local.hash,
                    remoteHash: contentHash(remoteBody, local.color),
                    autoName: rec?.autoName,
                };
                this.records()[id] = rec;
                await this.maybeRename(file, local.body, rec);
                this.plugin.saveSettings();
                this.lastError = "";
            }
            catch (e)
            {
                this.lastError = errorMessage(e);
                console.error("[plane-pages-sync] sticky push failed", e);
            }
            finally
            {
                this.changed();
            }
        });
    }

    /** Names a note after its first line, as long as the user hasn't renamed it themselves. */
    private async maybeRename(file: TFile, body: string, rec: StickyRecord)
    {
        const title = stickyTitle(body);
        if (rec.autoName === undefined || file.basename !== rec.autoName || title === "Sticky")
        {
            return;
        }
        if (file.basename === title || file.basename.startsWith(`${title} `))
        {
            return;
        }
        const path = await this.uniquePath(title);
        rec.autoName = path.slice(path.lastIndexOf("/") + 1, -3);
        rec.path = path;
        await this.app.fileManager.renameFile(file, path);
    }

    // ---------- pull (Plane -> notes) ----------

    pull(opts: { quiet?: boolean; } = {}): Promise<void>
    {
        if (!this.enabled || !this.plugin.configured)
        {
            return Promise.resolve();
        }
        this.pulling ??= this.doPull(opts).finally(() =>
        {
            this.pulling = null;
        });
        return this.pulling;
    }

    get isPulling()
    {
        return this.pulling !== null;
    }

    private async doPull(opts: { quiet?: boolean; })
    {
        this.changed();
        try
        {
            const remote = await this.plugin.client.listStickies();
            const seen = new Set<string>();
            const byId = new Map<string, TFile>();
            for (const f of this.files())
            {
                const id: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.[FM_STICKY];
                if (typeof id === "string")
                {
                    byId.set(id, f);
                }
            }

            for (const sticky of remote)
            {
                seen.add(sticky.id);
                await withLock(`sticky-id:${sticky.id}`, () => this.reconcile(sticky, byId.get(sticky.id)));
            }

            // Gone from Plane.
            for (const [id, rec] of Object.entries(this.records()))
            {
                if (seen.has(id) || id.startsWith("local:"))
                {
                    continue;
                }
                delete this.records()[id];
                const file = this.app.vault.getFileByPath(rec.path);
                if (!file)
                {
                    continue;
                }
                const local = await this.readLocal(file);
                if (local.hash === rec.localHash)
                {
                    await this.app.fileManager.trashFile(file);
                }
                else
                {
                    // Edited here after it was deleted in Plane: keep the edits and recreate it.
                    await this.setProps(file, { id: null });
                    this.schedule(file, 500);
                }
            }

            // Notes in the folder that were never pushed.
            for (const f of this.files())
            {
                const id: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.[FM_STICKY];
                if (!id && !this.timers.has(f.path))
                {
                    await this.push(f);
                }
            }

            this.lastPull = Date.now();
            this.lastError = "";
            this.plugin.saveSettings();
        }
        catch (e)
        {
            this.lastError = errorMessage(e);
            if (!opts.quiet)
            {
                new Notice(`Couldn't sync stickies: ${this.lastError}`, 8000);
            }
            console.error("[plane-pages-sync] sticky pull failed", e);
        }
        finally
        {
            this.changed();
        }
    }

    private async reconcile(sticky: PlaneSticky, fileById: TFile | undefined)
    {
        const color: StickyColor = isStickyColor(sticky.background_color) ? sticky.background_color : "gray";
        const remoteBody = planeHtmlToMarkdown(sticky.description_html);
        const remoteHash = contentHash(remoteBody, color);
        const rec = this.records()[sticky.id];
        const file = (rec && this.app.vault.getFileByPath(rec.path)) || fileById;

        if (!file)
        {
            const title = stickyTitle(remoteBody);
            const created = await this.createNote(title, remoteBody, color, sticky.id);
            const local = await this.readLocal(created);
            this.records()[sticky.id] = {
                path: created.path,
                localHash: local.hash,
                remoteHash,
                autoName: created.basename,
            };
            return;
        }

        const local = await this.readLocal(file);
        const localChanged = !rec || local.hash !== rec.localHash;
        const remoteChanged = !rec || remoteHash !== rec.remoteHash;

        if (local.hash === remoteHash)
        {
            this.records()[sticky.id] = { path: file.path, localHash: local.hash, remoteHash, autoName: rec?.autoName };
            return;
        }
        if (remoteChanged && !localChanged)
        {
            await this.applyRemote(file, remoteBody, color, sticky.id, remoteHash, rec?.autoName);
            return;
        }
        if (localChanged && !remoteChanged)
        {
            if (!this.timers.has(file.path))
            {
                await this.push(file);
            }
            return;
        }

        // Both sides changed since the last sync.
        const remoteTime = Date.parse(sticky.updated_at ?? "") || 0;
        const localWins = file.stat.mtime >= remoteTime;
        const timer = this.timers.get(file.path);
        if (timer)
        {
            window.clearTimeout(timer);
            this.timers.delete(file.path);
        }
        if (localWins)
        {
            await this.createNote(`${stickyTitle(remoteBody)} (conflict ${stamp()})`, remoteBody, color);
            if (rec)
            {
                rec.remoteHash = remoteHash;
            }
            await this.push(file);
        }
        else
        {
            await this.createNote(`${stickyTitle(local.body)} (conflict ${stamp()})`, local.body, local.color);
            await this.applyRemote(file, remoteBody, color, sticky.id, remoteHash, rec?.autoName);
        }
        new Notice(
            "A sticky changed in both Obsidian and Plane. Kept both versions; the older one is marked “conflict”.",
        );
    }

    private async applyRemote(
        file: TFile,
        body: string,
        color: StickyColor,
        id: string,
        remoteHash: string,
        autoName: string | undefined,
    )
    {
        await this.setProps(file, { id, color });
        await this.writeBody(file, body);
        const local = await this.readLocal(file);
        this.records()[id] = { path: file.path, localHash: local.hash, remoteHash, autoName };
    }

    // ---------- vault events ----------

    onModify(file: TFile)
    {
        if (this.isStickyFile(file) && this.settings.autoPush)
        {
            this.schedule(file);
        }
        if (this.isStickyFile(file))
        {
            this.changed();
        }
    }

    onCreate(file: TFile)
    {
        if (this.isStickyFile(file))
        {
            this.changed();
        }
    }

    onRename(file: TFile, oldPath: string)
    {
        const found = this.recordFor(oldPath);
        const nowInside = this.isStickyFile(file);
        if (found)
        {
            if (nowInside)
            {
                found[1].path = file.path;
            }
            else
            {
                // Moved out of the stickies folder: it stops being a sticky, so remove it from Plane.
                void this.deleteRemote(found[0]);
            }
            this.plugin.saveSettings();
        }
        else if (nowInside)
        {
            this.schedule(file); // moved in: becomes a new sticky
        }
        this.changed();
    }

    onDelete(path: string)
    {
        const found = this.recordFor(path);
        const timer = this.timers.get(path);
        if (timer)
        {
            window.clearTimeout(timer);
            this.timers.delete(path);
        }
        if (found)
        {
            void this.deleteRemote(found[0]);
        }
        this.changed();
    }

    private async deleteRemote(id: string)
    {
        delete this.records()[id];
        this.plugin.saveSettings();
        if (id.startsWith("local:") || !this.plugin.configured)
        {
            return;
        }
        try
        {
            await this.plugin.client.deleteSticky(id);
        }
        catch (e)
        {
            if (!(e instanceof PlaneError && e.status === 404))
            {
                new Notice(`Couldn't delete the sticky in Plane: ${errorMessage(e)}`, 8000);
            }
        }
    }
}
