import { type App, debounce, ItemView, Menu, Modal, Setting, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import type PlanePagesSync from "./main";
import type { CleanupPlan } from "./stickies";
import { STICKY_COLORS, type StickyColor } from "./stickyConvert";

export const STICKY_VIEW = "plane-stickies";

interface Card
{
    file: TFile;
    color: StickyColor;
    body: string;
    mtime: number;
}

export class StickyBoardView extends ItemView
{
    private gridEl!: HTMLElement;
    private statusEl!: HTMLElement;
    private dirty = false;
    private editing: TFile | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: PlanePagesSync)
    {
        super(leaf);
    }

    getViewType()
    {
        return STICKY_VIEW;
    }

    getDisplayText()
    {
        return "Plane stickies";
    }

    getIcon()
    {
        return "sticky-note";
    }

    get sync()
    {
        return this.plugin.stickies;
    }

    async onOpen()
    {
        const root = this.contentEl;
        root.empty();
        root.addClass("pps-board");

        const header = root.createDiv({ cls: "pps-header" });
        header.createDiv({ cls: "pps-title", text: "Stickies" });
        const actions = header.createDiv({ cls: "pps-actions" });
        this.iconButton(actions, "plus", "New sticky", () => void this.addSticky());
        this.iconButton(actions, "refresh-cw", "Sync with Plane", () => void this.sync.pull());
        this.iconButton(actions, "eraser", "Clean up duplicate stickies", () => void this.plugin.cleanUpStickies());

        this.statusEl = root.createDiv({ cls: "pps-status" });
        this.gridEl = root.createDiv({ cls: "pps-grid" });

        const refresh = debounce(() => void this.render(), 250, true);
        this.registerEvent(this.sync.on("changed", () => this.renderStatus()));
        this.registerEvent(
            this.app.vault.on("modify", (f) => f instanceof TFile && this.sync.isStickyFile(f) && refresh()),
        );
        this.registerEvent(this.app.vault.on("create", () => refresh()));
        this.registerEvent(this.app.vault.on("delete", () => refresh()));
        this.registerEvent(this.app.vault.on("rename", () => refresh()));
        this.registerEvent(this.app.metadataCache.on("changed", (f) => this.sync.isStickyFile(f) && refresh()));
        this.registerEvent(this.app.workspace.on("css-change", () => refresh()));

        await this.render();
        void this.sync.pull({ quiet: true });
    }

    async onClose()
    {
        this.contentEl.empty();
    }

    private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void)
    {
        const btn = parent.createEl("button", { cls: "clickable-icon pps-icon", attr: { "aria-label": label } });
        setIcon(btn, icon);
        btn.addEventListener("click", onClick);
        return btn;
    }

    private renderStatus()
    {
        if (!this.statusEl)
        {
            return;
        }
        const s = this.sync;
        let text: string;
        if (!this.plugin.configured)
        {
            text = "Add your Plane token in settings to sync.";
        }
        else if (!s.enabled)
        {
            text = "Sticky sync is turned off in settings.";
        }
        else if (s.lastError)
        {
            text = `Sync problem: ${s.lastError}`;
        }
        else if (s.isPulling || s.pending)
        {
            text = "Syncing…";
        }
        else if (s.lastPull)
        {
            text = `Synced ${new Date(s.lastPull).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        }
        else
        {
            text = "Not synced yet";
        }
        this.statusEl.setText(text);
        this.statusEl.toggleClass("mod-error", !!s.lastError);
    }

    private async loadCards(): Promise<Card[]>
    {
        const cards = await Promise.all(
            this.sync.files().map(async (file) =>
            {
                const local = await this.sync.readLocal(file);
                return local.managed
                    ? { file, color: local.color, body: local.body.trim(), mtime: file.stat.mtime }
                    : null;
            }),
        );
        return cards.filter((c): c is Card => c !== null).sort((a, b) => b.mtime - a.mtime);
    }

    async render()
    {
        // Don't rebuild under someone's cursor; catch up when they leave the card.
        if (this.editing)
        {
            this.dirty = true;
            return;
        }
        this.dirty = false;
        this.renderStatus();
        const cards = await this.loadCards();
        this.gridEl.empty();

        if (!cards.length)
        {
            const empty = this.gridEl.createDiv({ cls: "pps-empty" });
            empty.createDiv({ text: "No stickies yet." });
            empty.createDiv({
                cls: "pps-empty-hint",
                text: "Add one here or in Plane. They stay in sync both ways.",
            });
            return;
        }

        const dark = activeDocument.body.hasClass("theme-dark");
        for (const card of cards)
        {
            this.renderCard(card, dark);
        }
    }

    private renderCard(card: Card, dark: boolean)
    {
        const swatch = STICKY_COLORS.find((c) => c.key === card.color) ?? STICKY_COLORS[0];
        const el = this.gridEl.createDiv({ cls: "pps-sticky", attr: { "data-path": card.file.path } });
        el.setCssProps({ "--pps-sticky-bg": dark ? swatch.dark : swatch.light });

        const text = el.createEl("textarea", {
            cls: "pps-text",
            attr: { placeholder: "Write something…", spellcheck: "true" },
        });
        text.value = card.body;

        const save = debounce(
            async () =>
            {
                await this.sync.writeBody(card.file, text.value);
            },
            600,
            true,
        );

        text.addEventListener("focus", () =>
        {
            this.editing = card.file;
        });
        text.addEventListener("input", () => save());
        text.addEventListener("blur", () =>
        {
            void save.run();
            this.editing = null;
            if (this.dirty)
            {
                void this.render();
            }
        });

        const footer = el.createDiv({ cls: "pps-footer" });
        this.iconButton(footer, "palette", "Colour", () => undefined).addEventListener("click", (evt) =>
        {
            const menu = new Menu();
            for (const c of STICKY_COLORS)
            {
                menu.addItem((item) =>
                    item
                        .setTitle(c.label)
                        .setChecked(c.key === card.color)
                        .onClick(() => void this.sync.setProps(card.file, { color: c.key }))
                );
            }
            menu.showAtMouseEvent(evt);
        });
        this.iconButton(footer, "file-text", "Open as note", () =>
        {
            void this.app.workspace.getLeaf("tab").openFile(card.file);
        });
        this.iconButton(footer, "trash-2", "Delete", () =>
        {
            new ConfirmDelete(this.app, () => void this.app.fileManager.trashFile(card.file)).open();
        });
    }

    private async addSticky()
    {
        const file = await this.sync.newSticky();
        await this.render();
        const card = Array.from(this.gridEl.querySelectorAll<HTMLElement>(".pps-sticky")).find((el) =>
            el.dataset.path === file.path
        );
        card?.querySelector<HTMLTextAreaElement>(".pps-text")?.focus();
    }
}

export class ConfirmCleanup extends Modal
{
    constructor(app: App, private plan: CleanupPlan, private onConfirm: () => void)
    {
        super(app);
    }

    onOpen()
    {
        const { remote, notes, preview } = this.plan;
        this.setTitle("Clean up duplicate stickies?");
        this.contentEl.createEl("p", {
            text: `This deletes ${remote.length} sticky${
                remote.length === 1 ? "" : "s"
            } in Plane and moves ${notes.length} note${
                notes.length === 1 ? "" : "s"
            } to your trash. They look like copies or conflict leftovers; one copy of each real sticky is kept.`,
        });
        if (preview.length)
        {
            const list = this.contentEl.createEl("ul");
            for (const title of preview)
            {
                list.createEl("li", { text: title });
            }
            if (remote.length > preview.length)
            {
                this.contentEl.createEl("p", { text: `…and ${remote.length - preview.length} more.` });
            }
        }
        new Setting(this.contentEl)
            .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((b) =>
                b.setButtonText("Clean up").setDestructive().onClick(() =>
                {
                    this.onConfirm();
                    this.close();
                })
            );
    }

    onClose()
    {
        this.contentEl.empty();
    }
}

class ConfirmDelete extends Modal
{
    constructor(app: App, private onConfirm: () => void)
    {
        super(app);
    }

    onOpen()
    {
        this.setTitle("Delete sticky?");
        this.contentEl.createEl("p", { text: "It will be deleted in Plane too. The note goes to your trash." });
        new Setting(this.contentEl)
            .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((b) =>
                b.setButtonText("Delete").setDestructive().onClick(() =>
                {
                    this.onConfirm();
                    this.close();
                })
            );
    }

    onClose()
    {
        this.contentEl.empty();
    }
}
