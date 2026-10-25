// Bundled with esbuild (obsidian aliased to test/mocks/obsidian.ts) and run with node --test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getFrontMatterInfo, notices, parseYaml, stringifyYaml, TFile } from "obsidian";
import { PlaneError, type PlaneSticky, type StickyInput } from "../src/plane";
import { DEFAULTS, type Settings } from "../src/settings";
import { FM_STICKY, StickySync } from "../src/stickies";

(globalThis as unknown as { window: typeof globalThis; }).window = globalThis;

class FakeVault
{
    files = new Map<string, { content: string; mtime: number; }>();
    writes = 0;
    clock = 1_000;
    private objs = new Map<string, TFile>();
    tick()
    {
        return ++this.clock;
    }
    file(path: string)
    {
        const f = this.files.get(path);
        if (!f)
        {
            return null;
        }
        let o = this.objs.get(path);
        if (!o)
        {
            o = new TFile(path, { mtime: f.mtime });
            this.objs.set(path, o);
        }
        o.stat.mtime = f.mtime;
        return o;
    }
    getMarkdownFiles()
    {
        return [...this.files.keys()].map((p) => this.file(p)!);
    }
    getFileByPath(p: string)
    {
        return this.file(p);
    }
    getAbstractFileByPath(p: string)
    {
        return this.file(p);
    }
    getFolderByPath()
    {
        return {};
    }
    async createFolder()
    {
    }
    async read(f: TFile)
    {
        return this.files.get(f.path)!.content;
    }
    async create(path: string, content: string)
    {
        this.files.set(path, { content, mtime: this.tick() });
        this.writes++;
        return this.file(path)!;
    }
    async process(f: TFile, fn: (d: string) => string)
    {
        const cur = this.files.get(f.path)!;
        const next = fn(cur.content);
        if (next !== cur.content)
        {
            this.files.set(f.path, { content: next, mtime: this.tick() });
            this.writes++;
        }
    }
    edit(path: string, body: string)
    {
        const cur = this.files.get(path)!;
        const info = getFrontMatterInfo(cur.content);
        this.files.set(path, { content: `${cur.content.slice(0, info.contentStart) + body}\n`, mtime: this.tick() });
    }
    body(path: string)
    {
        const c = this.files.get(path)!.content;
        return c.slice(getFrontMatterInfo(c).contentStart).trim();
    }
    fm(path: string)
    {
        const c = this.files.get(path)!.content;
        return parseYaml(getFrontMatterInfo(c).frontmatter);
    }
}

class FakePlane
{
    stickies = new Map<string, PlaneSticky>();
    calls: string[] = [];
    private n = 0;
    constructor(private vault: FakeVault)
    {
    }
    async listStickies()
    {
        this.calls.push("list");
        return [...this.stickies.values()].map((s) => ({ ...s }));
    }
    async createSticky(input: StickyInput)
    {
        this.calls.push("create");
        const s = { id: `s${++this.n}`, ...input, updated_at: new Date(this.vault.tick()).toISOString() };
        this.stickies.set(s.id, s);
        return { ...s };
    }
    async updateSticky(id: string, input: StickyInput)
    {
        this.calls.push(`update ${id}`);
        const cur = this.stickies.get(id);
        if (!cur)
        {
            throw new PlaneError(404, "not found");
        }
        Object.assign(cur, input, { updated_at: new Date(this.vault.tick()).toISOString() });
        return { ...cur };
    }
    async deleteSticky(id: string)
    {
        this.calls.push(`delete ${id}`);
        this.stickies.delete(id);
    }
    editInPlane(id: string, html: string, color?: string)
    {
        const s = this.stickies.get(id)!;
        s.description_html = html;
        if (color)
        {
            s.background_color = color;
        }
        s.updated_at = new Date(this.vault.tick()).toISOString();
    }
}

function setup()
{
    const vault = new FakeVault();
    const plane = new FakePlane(vault);
    const settings: Settings = structuredClone(DEFAULTS);
    const app = {
        vault,
        metadataCache: {
            getFileCache: (f: TFile) =>
            {
                const c = vault.files.get(f.path)?.content ?? "";
                return { frontmatter: parseYaml(getFrontMatterInfo(c).frontmatter) };
            },
        },
        fileManager: {
            processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) =>
            {
                await vault.process(f, (data) =>
                {
                    const info = getFrontMatterInfo(data);
                    const fm = info.exists ? parseYaml(info.frontmatter) : {};
                    fn(fm);
                    return `---\n${stringifyYaml(fm)}\n---\n${data.slice(info.contentStart)}`;
                });
            },
            trashFile: async (f: TFile) =>
            {
                vault.files.delete(f.path);
            },
            renameFile: async (f: TFile, to: string) =>
            {
                const cur = vault.files.get(f.path)!;
                vault.files.delete(f.path);
                vault.files.set(to, cur);
                f.path = to;
            },
        },
    };
    const plugin = { app, settings, configured: true, client: plane, saveSettings: () => undefined };
    const sync = new StickySync(plugin as never);
    const path = (id: string) => settings.stickies[id]?.path;
    return { vault, plane, settings, sync, path };
}

test("a sticky made in Plane appears as a note", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Call the supplier</p>", background_color: "peach" });
    await sync.pull();
    const p = path(s.id)!;
    assert.equal(p, "Plane/Stickies/Call the supplier.md");
    assert.equal(vault.body(p), "Call the supplier");
    assert.equal(vault.fm(p)[FM_STICKY], s.id);
    assert.equal(vault.fm(p).plane_color, "peach");
});

test("pulling twice with no changes writes nothing", async () =>
{
    const { plane, vault, sync } = setup();
    await plane.createSticky({ description_html: "<p>Hello</p>", background_color: "gray" });
    await sync.pull();
    const writes = vault.writes;
    plane.calls = [];
    await sync.pull();
    assert.equal(vault.writes, writes);
    assert.deepEqual(plane.calls, ["list"]);
});

test("editing the note pushes it to Plane", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Old</p>", background_color: "gray" });
    await sync.pull();
    vault.edit(path(s.id)!, "New text\n\n- [x] done");
    await sync.push(vault.file(path(s.id)!)!);
    assert.match(plane.stickies.get(s.id)!.description_html!, /New text/);
    assert.match(plane.stickies.get(s.id)!.description_html!, /data-checked="true"/);
});

test("editing in Plane updates the note, colour included", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Old</p>", background_color: "gray" });
    await sync.pull();
    plane.editInPlane(s.id, "<p>Changed in <strong>Plane</strong></p>", "green");
    await sync.pull();
    assert.equal(vault.body(path(s.id)!), "Changed in **Plane**");
    assert.equal(vault.fm(path(s.id)!).plane_color, "green");
});

test("changes on both sides: newer wins, the other goes to Conflicts and is not synced", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Start</p>", background_color: "gray" });
    await sync.pull();
    plane.editInPlane(s.id, "<p>Plane version</p>");
    vault.edit(path(s.id)!, "Obsidian version"); // newer
    await sync.pull();
    assert.equal(vault.body(path(s.id)!), "Obsidian version");
    const copies = [...vault.files.keys()].filter((p) => p.startsWith("Plane/Stickies/Conflicts/"));
    assert.equal(copies.length, 1);
    assert.equal(vault.body(copies[0]), "Plane version");
    // Plane still has exactly one sticky, now with the winning text.
    assert.equal(plane.stickies.size, 1);
    assert.equal(plane.stickies.get(s.id)!.description_html, "<p>Obsidian version</p>");
    // Pulling again doesn't create anything new.
    await sync.pull();
    await sync.pull();
    assert.equal(plane.stickies.size, 1);
    assert.equal([...vault.files.keys()].filter((p) => p.includes("/Conflicts/")).length, 1);
    assert.ok(notices.some((n) => n.includes("both")));
});

test("notes without sticky properties are ignored (e.g. a folder index from another plugin)", async () =>
{
    const { plane, vault, sync } = setup();
    await vault.create(
        "Plane/Stickies/Stickies.md",
        "%% Zoottelkeeper: Beginning of the autogenerated index file %%\n- [[A]]",
    );
    await sync.pull();
    await sync.push(vault.file("Plane/Stickies/Stickies.md")!);
    assert.equal(plane.stickies.size, 0);
    assert.equal(plane.calls.filter((c) => c === "create").length, 0);
});

test("an index plugin rewriting the folder on every change can't start a loop", async () =>
{
    const { plane, vault, sync } = setup();
    // Simulate Zoottelkeeper: after every new file, rewrite Stickies.md listing the folder.
    const rewriteIndex = () =>
    {
        const list = [...vault.files.keys()].filter((p) => !p.endsWith("Stickies.md")).map((p) => `- [[${p}]]`);
        vault.files.set("Plane/Stickies/Stickies.md", {
            content: `%% Zoottelkeeper %%\n${list.join("\n")}\n`,
            mtime: vault.tick(),
        });
    };
    const create = vault.create.bind(vault);
    vault.create = async (p: string, c: string) =>
    {
        const f = await create(p, c);
        rewriteIndex();
        return f;
    };
    await plane.createSticky({ description_html: "<p>One</p>", background_color: "gray" });
    await plane.createSticky({ description_html: "<p>Two</p>", background_color: "pink" });
    for (let i = 0; i < 5; i++)
    {
        await sync.pull();
        for (const f of vault.getMarkdownFiles())
        {
            await sync.push(f);
        }
    }
    assert.equal(plane.stickies.size, 2);
    assert.equal(vault.files.size, 3); // two stickies + the index note
});

test("several conflicts in one run pause sync instead of piling up copies", async () =>
{
    const { plane, vault, sync, settings, path } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
    {
        ids.push((await plane.createSticky({ description_html: `<p>Note ${i}</p>`, background_color: "gray" })).id);
    }
    await sync.pull();
    for (const id of ids)
    {
        plane.editInPlane(id, "<p>remote edit</p>");
        vault.edit(path(id)!, "local edit");
    }
    await sync.pull();
    assert.equal(settings.stickiesEnabled, false);
    assert.ok([...vault.files.keys()].filter((p) => p.includes("/Conflicts/")).length <= 2);
    assert.equal(plane.stickies.size, 5);
});

test("clean-up removes loop leftovers and keeps one copy of each real sticky", async () =>
{
    const { plane, vault, sync } = setup();
    await plane.createSticky({ description_html: "<p>Learn PCB Kicad</p>", background_color: "orange" });
    await plane.createSticky({ description_html: "<p>Learn PCB Kicad</p>", background_color: "orange" });
    await plane.createSticky({ description_html: "<p>Add team subdomain (conflict 2026-10-25 08.15)</p>" });
    await plane.createSticky({ description_html: "<p>PlaneStickies Zoottelkeeper Beginning of the index</p>" });
    await plane.createSticky({ description_html: "<p>Tabdrift width</p>", background_color: "green" });
    await sync.pull();
    const plan = await sync.findJunk();
    assert.equal(plan.remote.length, 3);
    await sync.cleanUp(plan);
    const left = [...plane.stickies.values()].map((x) => x.description_html).sort();
    assert.deepEqual(left, ["<p>Learn PCB Kicad</p>", "<p>Tabdrift width</p>"]);
    const notes = [...vault.files.keys()].filter((p) => !p.includes("/Conflicts/"));
    assert.equal(notes.length, 2);
});

test("deleting in Plane removes an untouched note", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Bye</p>", background_color: "gray" });
    await sync.pull();
    const p = path(s.id)!;
    plane.stickies.delete(s.id);
    await sync.pull();
    assert.equal(vault.files.has(p), false);
});

test("deleting in Plane keeps a note you edited, and recreates the sticky", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Keep</p>", background_color: "gray" });
    await sync.pull();
    const p = path(s.id)!;
    vault.edit(p, "Keep, with edits");
    plane.stickies.delete(s.id);
    await sync.pull();
    assert.equal(vault.body(p), "Keep, with edits");
    await sync.push(vault.file(p)!);
    assert.equal(plane.stickies.size, 1);
    assert.match([...plane.stickies.values()][0].description_html!, /with edits/);
});

test("a new note becomes a sticky and is named after its first line", async () =>
{
    const { plane, vault, sync } = setup();
    const file = await sync.newSticky();
    vault.edit(file.path, "Book flights\nfor March");
    await sync.push(vault.file(file.path)!);
    assert.equal(plane.stickies.size, 1);
    const [p] = [...vault.files.keys()];
    assert.equal(p, "Plane/Stickies/Book flights.md");
    assert.ok(vault.fm(p)[FM_STICKY]);
});

test("pushing the same new note twice at once creates one sticky", async () =>
{
    const { plane, vault, sync } = setup();
    const file = await sync.newSticky();
    vault.edit(file.path, "Only once");
    const f = vault.file(file.path)!;
    await Promise.all([sync.push(f), sync.push(f)]);
    assert.equal(plane.stickies.size, 1);
});

test("deleting the note deletes the sticky", async () =>
{
    const { plane, vault, sync, path } = setup();
    const s = await plane.createSticky({ description_html: "<p>Gone</p>", background_color: "gray" });
    await sync.pull();
    const p = path(s.id)!;
    vault.files.delete(p);
    sync.onDelete(p);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(plane.stickies.has(s.id), false);
});
