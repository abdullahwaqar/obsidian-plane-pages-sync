// Minimal stand-ins for the Obsidian APIs the sticky engine uses, for headless tests.
export class Events
{
    private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    on(name: string, cb: (...a: unknown[]) => void)
    {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), cb]);
        return { name, cb };
    }
    trigger(name: string, ...args: unknown[])
    {
        for (const cb of this.handlers.get(name) ?? [])
        {
            cb(...args);
        }
    }
}
export const notices: string[] = [];
export class Notice
{
    constructor(msg: string)
    {
        notices.push(msg);
    }
}
export class TFile
{
    constructor(public path: string, public stat: { mtime: number; })
    {
    }
    get basename()
    {
        return this.path.slice(this.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    }
    get parent()
    {
        const i = this.path.lastIndexOf("/");
        return { path: i < 0 ? "" : this.path.slice(0, i) };
    }
    get extension()
    {
        return "md";
    }
}
export function normalizePath(p: string)
{
    return p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export function getFrontMatterInfo(content: string)
{
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(content);
    if (!m)
    {
        return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
    }
    return { exists: true, frontmatter: m[1], from: 4, to: 4 + m[1].length, contentStart: m[0].length };
}
export function parseYaml(s: string): Record<string, unknown>
{
    const out: Record<string, unknown> = {};
    for (const line of s.split("\n"))
    {
        const i = line.indexOf(":");
        if (i > 0)
        {
            out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
    }
    return out;
}
export function stringifyYaml(o: Record<string, unknown>)
{
    return Object.entries(o).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
}
// Only imported for types or never called in these tests.
export const requestUrl = () =>
{
    throw new Error("network disabled in tests");
};
export class FuzzySuggestModal
{
}
export class PluginSettingTab
{
}
