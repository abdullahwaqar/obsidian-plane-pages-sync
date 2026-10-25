// Markdown (Obsidian flavour) -> HTML that Plane's page editor accepts.
// Pure module: no Obsidian imports, so it can be tested in plain Node.

import type { Tokens } from "marked";
import { Marked } from "marked";

export interface LinkTarget
{
    title: string;
    url?: string; // Plane page URL when the linked note is already synced
}

export interface ConvertOptions
{
    resolveLink: (target: string) => LinkTarget | null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const CALLOUT_EMOJI: Record<string, number> = {
    note: 0x1f4dd,
    info: 0x2139,
    tip: 0x1f4a1,
    hint: 0x1f4a1,
    important: 0x2757,
    success: 0x2705,
    check: 0x2705,
    done: 0x2705,
    question: 0x2753,
    help: 0x2753,
    faq: 0x2753,
    warning: 0x26a0,
    caution: 0x26a0,
    attention: 0x26a0,
    failure: 0x274c,
    fail: 0x274c,
    missing: 0x274c,
    danger: 0x1f6a8,
    error: 0x1f6a8,
    bug: 0x1f41b,
    example: 0x1f4cb,
    quote: 0x1f4ac,
    cite: 0x1f4ac,
    abstract: 0x1f4c4,
    summary: 0x1f4c4,
    todo: 0x2611,
};
const CALLOUT_BG: Record<string, string> = {
    warning: "#fef3c7",
    caution: "#fef3c7",
    attention: "#fef3c7",
    danger: "#fee2e2",
    error: "#fee2e2",
    failure: "#fee2e2",
    fail: "#fee2e2",
    bug: "#fee2e2",
    success: "#dcfce7",
    check: "#dcfce7",
    done: "#dcfce7",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function stripFrontmatter(md: string): string
{
    return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Apply Obsidian-only syntax rewrites outside of code. */
function preprocess(md: string, opts: ConvertOptions): string
{
    md = stripFrontmatter(md);
    md = md.replace(/%%[\s\S]*?%%/g, ""); // Obsidian comments

    // Split so fenced code and inline code are left untouched.
    const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
    return parts
        .map((part, i) =>
        {
            if (i % 2 === 1)
            {
                return part; // code segment
            }
            return part
                // ![[embed]]
                .replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) =>
                {
                    const t = target.trim();
                    if (IMAGE_EXT.test(t))
                    {
                        return `*[image: ${alias?.trim() || t}]*`;
                    }
                    return link(t, alias, opts);
                })
                // [[link#heading|alias]]
                .replace(
                    /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g,
                    (_m, target: string, heading?: string, alias?: string) =>
                        link(target.trim(), alias ?? (heading ? `${target.trim()} > ${heading}` : undefined), opts),
                )
                // ==highlight== -> bold (Plane has no highlight mark in its API HTML)
                .replace(/==([^=\n]+)==/g, "**$1**");
        })
        .join("");
}

function link(target: string, alias: string | undefined, opts: ConvertOptions): string
{
    const r = opts.resolveLink(target);
    const text = (alias?.trim() || r?.title || target).replace(/[[\]]/g, "");
    return r?.url ? `[${text}](${r.url})` : text;
}

function buildMarked(): Marked
{
    const m = new Marked({ gfm: true, breaks: false });
    m.use({
        renderer: {
            checkbox()
            {
                return ""; // handled in list()
            },
            list(token: Tokens.List)
            {
                const renderItem = (item: Tokens.ListItem) =>
                {
                    const inner = this.parser.parse(item.tokens.filter((t) => t.type !== "checkbox"));
                    const body = item.loose ? inner : `<p>${inner}</p>`;
                    return item.task
                        ? `<li data-checked="${item.checked ? "true" : "false"}">${body}</li>`
                        : `<li>${body}</li>`;
                };
                // Plane can't mix checklist and normal items in one list, so split into runs.
                const runs: Tokens.ListItem[][] = [];
                for (const item of token.items)
                {
                    const last = runs[runs.length - 1];
                    if (last && !!last[0].task === !!item.task)
                    {
                        last.push(item);
                    }
                    else
                    {
                        runs.push([item]);
                    }
                }
                let next = typeof token.start === "number" ? token.start : 1;
                return runs
                    .map((run) =>
                    {
                        const items = run.map(renderItem).join("");
                        if (run[0].task)
                        {
                            return `<ul data-type="taskList">${items}</ul>`;
                        }
                        if (token.ordered)
                        {
                            const start = next !== 1 ? ` start="${next}"` : "";
                            next += run.length;
                            return `<ol${start}>${items}</ol>`;
                        }
                        return `<ul>${items}</ul>`;
                    })
                    .join("");
            },
            blockquote(token: Tokens.Blockquote)
            {
                const m = /^\[!(\w+)\][+-]?[ \t]*(.*)/.exec(token.text);
                if (!m)
                {
                    return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>`;
                }
                const type = m[1].toLowerCase();
                const title = m[2].trim();
                let body = this.parser.parse(token.tokens);
                // Drop the "[!type] Title" marker from the first paragraph.
                body = body.replace(/^<p>\[!\w+\][+-]?[^\n<]*(\n|<br>)?/, "<p>").replace(/^<p><\/p>/, "");
                const titleHtml = `<p><strong>${
                    esc(title || type.charAt(0).toUpperCase() + type.slice(1))
                }</strong></p>`;
                return (
                    `<div data-block-type="callout-component" data-background="${CALLOUT_BG[type] ?? "#eff6ff"}" `
                    + `data-logo-in-use="emoji" data-emoji-unicode="${CALLOUT_EMOJI[type] ?? 0x1f4a1}">`
                    + titleHtml + body + `</div>`
                );
            },
            table(token: Tokens.Table)
            {
                const cell = (c: Tokens.TableCell, tag: "th" | "td") =>
                    `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
                const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
                const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
                return `<table><tbody>${head}${rows}</tbody></table>`;
            },
            del({ tokens }: Tokens.Del)
            {
                return `<s>${this.parser.parseInline(tokens)}</s>`;
            },
            hr()
            {
                return "<hr />";
            },
            html(token: Tokens.HTML | Tokens.Tag)
            {
                // Never pass raw HTML through; show it as text instead.
                return "block" in token && token.block ? `<p>${esc(token.text.trim())}</p>` : esc(token.text);
            },
        },
    });
    return m;
}

const marked = buildMarked();

export function markdownToPlaneHtml(md: string, opts: ConvertOptions): string
{
    const html = marked.parse(preprocess(md, opts), { async: false });
    const out = html.trim();
    return out.length ? out : "<p></p>";
}
