import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToPlaneHtml } from "../src/convert.ts";

const PAGE_URL = "https://app.plane.so/ws/projects/p/pages/1";

function convert(md: string): string
{
    return markdownToPlaneHtml(md, {
        resolveLink: (target) => target === "Other Note" ? { title: "Other Note", url: PAGE_URL } : null,
    });
}

test("drops frontmatter and comments", () =>
{
    const html = convert("---\nplane_page: abc\n---\n# Title\n%% hidden %%\ntext");
    assert.ok(!html.includes("plane_page"));
    assert.ok(!html.includes("hidden"));
    assert.ok(html.startsWith("<h1>Title</h1>"));
});

test("task lists become Plane checklists", () =>
{
    const html = convert("- [x] done\n- [ ] todo");
    assert.equal(
        html,
        '<ul data-type="taskList"><li data-checked="true"><p>done</p></li><li data-checked="false"><p>todo</p></li></ul>',
    );
});

test("wikilinks resolve to Plane pages or fall back to text", () =>
{
    const html = convert("See [[Other Note]], [[Other Note#Setup]] and [[Missing|alias]].");
    assert.ok(html.includes(`<a href="${PAGE_URL}">Other Note</a>`));
    assert.ok(html.includes(`<a href="${PAGE_URL}">Other Note &gt; Setup</a>`));
    assert.ok(html.includes("and alias."));
});

test("wikilinks inside code are left alone", () =>
{
    const html = convert('`[[inline]]`\n\n```ts\nconst x = "[[block]]";\n```');
    assert.ok(html.includes("<code>[[inline]]</code>"));
    assert.ok(html.includes("[[block]]"));
});

test("callouts become Plane callout blocks", () =>
{
    const html = convert("> [!warning] Careful\n> Body line");
    assert.ok(html.startsWith('<div data-block-type="callout-component"'));
    assert.ok(html.includes("<strong>Careful</strong>"));
    assert.ok(html.includes("<p>Body line"));
    assert.ok(!html.includes("[!warning]"));
});

test("plain quotes stay quotes", () =>
{
    assert.ok(convert("> just a quote").startsWith("<blockquote>"));
});

test("tables render header cells inside tbody", () =>
{
    const html = convert("| A | B |\n|---|---|\n| 1 | 2 |");
    assert.equal(html, "<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>");
});

test("raw HTML is escaped, never injected", () =>
{
    const html = convert("<script>alert(1)</script>");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
});

test("local image embeds become placeholders", () =>
{
    assert.ok(convert("![[diagram.png]]").includes("<em>[image: diagram.png]</em>"));
});

test("empty note produces an empty paragraph", () =>
{
    assert.equal(convert("---\na: 1\n---\n"), "<p></p>");
});

test("checklist and normal items in one list stay separate", () =>
{
    const html = convert("- [x] done\n\n- plain");
    assert.ok(html.includes('<ul data-type="taskList"><li data-checked="true">'));
    assert.ok(html.includes("<ul><li>"));
    assert.ok(!html.includes('data-checked="false"'));
});
