import { describe, expect, it } from "vitest";
import { htmlToRichText } from "../../src/webflow/html-to-richtext.js";

describe("htmlToRichText", () => {
  it("converts paragraphs with strong/em spans", () => {
    const out = htmlToRichText("<p><strong>What is</strong> a <em>crown</em>?</p>");
    expect(out).toEqual([
      {
        type: "paragraph",
        text: "What is a crown?",
        spans: [
          { start: 0, end: 7, type: "strong" },
          { start: 10, end: 15, type: "em" },
        ],
      },
    ]);
  });

  it("converts links and list items", () => {
    const out = htmlToRichText('<ul><li>Call <a href="tel:310">us</a></li></ul>');
    expect(out).toEqual([
      {
        type: "list-item",
        text: "Call us",
        spans: [
          { start: 5, end: 7, type: "hyperlink", data: { link_type: "Web", url: "tel:310" } },
        ],
      },
    ]);
  });

  it("drops empty/whitespace blocks (Webflow emits zero-width-joiner <p> spacers)", () => {
    expect(htmlToRichText("<p>‍</p><p> </p><p>Real</p>")).toEqual([
      { type: "paragraph", text: "Real", spans: [] },
    ]);
  });

  it("decodes entities", () => {
    expect(htmlToRichText("<p>it&#x27;s &amp; more</p>")).toEqual([
      { type: "paragraph", text: "it's & more", spans: [] },
    ]);
  });

  it("converts <br> to a single space", () => {
    expect(htmlToRichText("<p>Call today.<br/>We are open.</p>")).toEqual([
      { type: "paragraph", text: "Call today. We are open.", spans: [] },
    ]);
  });

  it("decodes typographic named entities", () => {
    expect(htmlToRichText("<p>it&rsquo;s a &ldquo;crown&rdquo; &mdash; ok</p>")).toEqual([
      { type: "paragraph", text: "it’s a “crown” — ok", spans: [] },
    ]);
  });

  it("trims boundary whitespace and shifts spans", () => {
    expect(htmlToRichText("<p>  <strong>Hi</strong> there  </p>")).toEqual([
      { type: "paragraph", text: "Hi there", spans: [{ start: 0, end: 2, type: "strong" }] },
    ]);
  });

  it("collapses cross-node double spaces with span bookkeeping", () => {
    expect(htmlToRichText("<p>Hello <strong> world</strong></p>")).toEqual([
      { type: "paragraph", text: "Hello world", spans: [{ start: 6, end: 11, type: "strong" }] },
    ]);
  });

  it("strips leading zero-width chars from non-blank blocks", () => {
    expect(htmlToRichText("<p>‍MI Paste</p>")).toEqual([
      { type: "paragraph", text: "MI Paste", spans: [] },
    ]);
  });
});
