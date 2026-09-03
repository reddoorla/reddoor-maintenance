import { describe, it, expect } from "vitest";
import { renderBlocks } from "../../src/forms/rich-text.js";
import type { ReplyBlock } from "../../src/forms/reply-copy.js";

const p = (text: string, spans?: ReplyBlock["spans"]): ReplyBlock => ({
  type: "paragraph",
  text,
  ...(spans ? { spans } : {}),
});

describe("renderBlocks", () => {
  it("renders paragraphs and escapes their text", () => {
    expect(renderBlocks([p("Hello & <welcome>")])).toBe("<p>Hello &amp; &lt;welcome&gt;</p>");
  });

  it("applies a span without letting escaping shift its offsets", () => {
    // "A&B bold" — the & becomes 5 characters once escaped. A renderer that
    // escaped first and sliced after would bold the wrong characters.
    const html = renderBlocks([p("A&B bold", [{ start: 4, end: 8, type: "strong" }])]);
    expect(html).toBe("<p>A&amp;B <strong>bold</strong></p>");
  });

  it("renders italic and links", () => {
    const html = renderBlocks([
      p("see the show", [
        { start: 0, end: 3, type: "em" },
        { start: 8, end: 12, type: "link", url: "https://gallerysonder.com/exhibitions" },
      ]),
    ]);
    expect(html).toBe(
      '<p><em>see</em> the <a href="https://gallerysonder.com/exhibitions">show</a></p>',
    );
  });

  it("drops a link whose scheme is not https or mailto", () => {
    const html = renderBlocks([
      p("click me", [{ start: 0, end: 5, type: "link", url: "javascript:alert(1)" }]),
    ]);
    expect(html).toBe("<p>click me</p>");
  });

  it("keeps a mailto link and escapes the href", () => {
    const html = renderBlocks([
      p("email us", [{ start: 0, end: 5, type: "link", url: 'mailto:info@x.com?subject="hi"' }]),
    ]);
    expect(html).toContain('href="mailto:info@x.com?subject=&quot;hi&quot;"');
  });

  it("handles overlapping spans without dropping either", () => {
    const html = renderBlocks([
      p("bold link", [
        { start: 0, end: 9, type: "strong" },
        { start: 5, end: 9, type: "link", url: "https://x.com" },
      ]),
    ]);
    expect(html).toContain("<strong>");
    expect(html).toContain('<a href="https://x.com"');
    expect(html).toContain("link");
    // Well-formed: every opened tag closes.
    expect((html.match(/<strong>/g) ?? []).length).toBe((html.match(/<\/strong>/g) ?? []).length);
    expect((html.match(/<a /g) ?? []).length).toBe((html.match(/<\/a>/g) ?? []).length);
  });

  it("clamps or drops spans with impossible offsets rather than throwing", () => {
    expect(renderBlocks([p("short", [{ start: 2, end: 99, type: "strong" }])])).toBe(
      "<p>sh<strong>ort</strong></p>",
    );
    expect(renderBlocks([p("short", [{ start: 4, end: 2, type: "strong" }])])).toBe("<p>short</p>");
    expect(renderBlocks([p("short", [{ start: -5, end: 2, type: "em" }])])).toBe(
      "<p><em>sh</em>ort</p>",
    );
  });

  it("groups consecutive list items into one list, and separates the two kinds", () => {
    const html = renderBlocks([
      p("Before"),
      { type: "list-item", text: "one" },
      { type: "list-item", text: "two" },
      { type: "o-list-item", text: "first" },
      p("After"),
    ]);
    expect(html).toBe(
      "<p>Before</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><p>After</p>",
    );
  });

  it("renders headings", () => {
    expect(renderBlocks([{ type: "heading2", text: "Details" }])).toContain("Details");
    expect(renderBlocks([{ type: "heading2", text: "Details" }])).toMatch(/^<h2[ >]/);
    expect(renderBlocks([{ type: "heading3", text: "Parking" }])).toMatch(/^<h3[ >]/);
  });

  it("drops empty blocks and returns empty string for nothing usable", () => {
    expect(renderBlocks([p("   "), p("")])).toBe("");
    expect(renderBlocks([])).toBe("");
  });

  it("never emits a tag the whitelist does not name", () => {
    const html = renderBlocks([
      p("<script>alert(1)</script>", [{ start: 0, end: 8, type: "strong" }]),
      { type: "list-item", text: "<img src=x onerror=alert(1)>" },
    ]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});
