import TurndownService from "turndown";
import { strikethrough, tables } from "turndown-plugin-gfm";
import { markdownToPlaneHtml } from "./convert.ts";

export const STICKY_COLORS = [
    { key: "gray", label: "Gray", light: "#d6d6d8", dark: "#404144" },
    { key: "peach", label: "Peach", light: "#ffd5d7", dark: "#593032" },
    { key: "pink", label: "Pink", light: "#fdd4e3", dark: "#562e3d" },
    { key: "orange", label: "Orange", light: "#ffe3cd", dark: "#583e2a" },
    { key: "green", label: "Green", light: "#c3f0de", dark: "#1d4a3b" },
    { key: "light-blue", label: "Light blue", light: "#c5eff9", dark: "#1f495c" },
    { key: "dark-blue", label: "Dark blue", light: "#c9dafb", dark: "#223558" },
    { key: "purple", label: "Purple", light: "#e3d8fd", dark: "#3d325a" },
] as const;

export type StickyColor = (typeof STICKY_COLORS)[number]["key"];

export function isStickyColor(value: unknown): value is StickyColor
{
    return STICKY_COLORS.some((c) => c.key === value);
}

export function randomStickyColor(): StickyColor
{
    return STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)].key;
}

const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
});
turndown.use([strikethrough, tables]);

// GitHub-style double tildes, which is what Obsidian uses.
turndown.addRule("strike", {
    filter: ["del", "s"],
    replacement: (content) => `~~${content}~~`,
});

// List items, written tight ("- item" rather than turndown's "-   item" with blank lines).
// Plane checklist items carry data-checked: <ul data-type="taskList"><li data-checked="true"><p>…</p></li></ul>
// Turndown checks the most recently added rule first, so this one rule handles every <li>.
turndown.addRule("listItem", {
    filter: "li",
    replacement: (content, node) =>
    {
        const text = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n\n+/g, "\n").replace(/\n/g, "\n    ");
        const parent = node.parentNode as HTMLElement | null;
        const checked = node.getAttribute("data-checked");
        let prefix = "- ";
        if (checked !== null)
        {
            prefix = `- [${checked === "true" ? "x" : " "}] `;
        }
        else if (parent?.nodeName === "OL")
        {
            const start = Number(parent.getAttribute("start") ?? "1");
            const index = Array.from(parent.children).indexOf(node);
            prefix = `${start + index}. `;
        }
        return `${prefix}${text}\n`;
    },
});

// Plane callouts: <div data-block-type="callout-component">…</div>
turndown.addRule("planeCallout", {
    filter: (node) => node.nodeName === "DIV" && node.getAttribute("data-block-type") === "callout-component",
    replacement: (content) =>
    {
        const lines = content.trim().split("\n");
        return `\n\n> [!note]\n${lines.map((l) => `> ${l}`.trimEnd()).join("\n")}\n\n`;
    },
});

// Mentions, embeds and other Plane components have no Markdown form: keep their text, drop the tag.
turndown.addRule("planeComponents", {
    filter: (node) => /-COMPONENT$/.test(node.nodeName),
    replacement: (content) => content,
});

/** Normalises Markdown so that formatting-only differences don't count as changes. */
export function normalizeMarkdown(md: string): string
{
    return md
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function planeHtmlToMarkdown(html: string | null | undefined): string
{
    if (!html || /^<p>\s*<\/p>$/.test(html.trim()))
    {
        return "";
    }
    return normalizeMarkdown(turndown.turndown(html));
}

export function stickyMarkdownToHtml(md: string): string
{
    return markdownToPlaneHtml(md, { resolveLink: () => null });
}

/** Plain text used for Plane's search field and for naming the note. */
export function plainText(md: string): string
{
    return md
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/^>\s*\[![^\]]+\]\s*/gm, "")
        .replace(/^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+/gm, "")
        .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
        .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_~`=]/g, "")
        .replace(/[ \t]+/g, " ")
        .trim();
}

/** File name for a sticky note, taken from its first line. */
export function stickyTitle(md: string, fallback = "Sticky"): string
{
    const firstLine = plainText(md).split("\n").find((l) => l.trim()) ?? "";
    const clean = firstLine.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
    if (!clean)
    {
        return fallback;
    }
    return clean.length > 40 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}
