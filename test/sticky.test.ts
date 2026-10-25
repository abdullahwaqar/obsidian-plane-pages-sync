import assert from "node:assert/strict";
import { test } from "node:test";
import {
    normalizeMarkdown,
    plainText,
    planeHtmlToMarkdown,
    stickyMarkdownToHtml,
    stickyTitle,
} from "../src/stickyConvert.ts";

test("Plane task lists become Markdown tasks", () =>
{
    const html =
        '<ul data-type="taskList"><li data-checked="true"><p>done</p></li><li data-checked="false"><p>todo</p></li></ul>';
    assert.equal(planeHtmlToMarkdown(html), "- [x] done\n- [ ] todo");
});

test("formatting survives a round trip", () =>
{
    const md = "# Ideas\n\nSome **bold** and *italic* and ~~gone~~.\n\n- [x] done\n- [ ] todo\n\n- one\n- two";
    assert.equal(planeHtmlToMarkdown(stickyMarkdownToHtml(md)), normalizeMarkdown(md));
});

test("empty Plane stickies become empty notes", () =>
{
    assert.equal(planeHtmlToMarkdown("<p></p>"), "");
    assert.equal(planeHtmlToMarkdown(null), "");
});

test("Plane components keep their text", () =>
{
    const html = '<p>Ping <mention-component entity_name="user_mention">Abdullah</mention-component></p>';
    assert.equal(planeHtmlToMarkdown(html), "Ping Abdullah");
});

test("titles come from the first line and are safe file names", () =>
{
    assert.equal(stickyTitle("# Call: supplier / Friday?\nmore"), "Call supplier Friday");
    assert.equal(stickyTitle("- [ ] Buy [[Samples|samples]]"), "Buy samples");
    assert.equal(stickyTitle(""), "Sticky");
    assert.equal(stickyTitle("x".repeat(60)).length, 41);
});

test("plain text strips Markdown syntax", () =>
{
    assert.equal(plainText("## Hello **world**\n- [x] [link](https://a.b)"), "Hello world\nlink");
});
