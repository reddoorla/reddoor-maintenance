import { describe, it, expect } from "vitest";
import { parse, type HTMLElement } from "node-html-parser";
import { parseNode, parseContainer, parseGridBands } from "../../src/blux/grid/parse-grid.js";

const node = (html: string) => parseNode(parse(html).firstChild as HTMLElement);
const container = (html: string) => parseContainer(parse(html).firstChild as HTMLElement);

describe("parseNode", () => {
  it("parses a heading leaf with its role and level", () => {
    expect(node("<h5 class='block-title text5'>The <b>Pointe</b></h5>")).toEqual({
      kind: "heading",
      role: "text5",
      level: 5,
      html: "The <b>Pointe</b>",
    });
  });

  it("parses a body leaf", () => {
    expect(node("<div class='block-body text1'><p>Hello</p></div>")).toEqual({
      kind: "body",
      role: "text1",
      html: "<p>Hello</p>",
    });
  });

  it("peels wrapper divs down to a single leaf", () => {
    const html =
      "<div class='block-content valignmiddleitem'><div class='block-subtitle text13'>Eyebrow</div></div>";
    expect(node(html)).toEqual({
      kind: "subtitle",
      role: "text13",
      text: "Eyebrow",
    });
  });

  it("keeps a subtitle's <br> as a newline but collapses source-formatting whitespace", () => {
    // A pretty-printed export wraps the display line across source rows; only the
    // real <br> is a hard break — the insignificant newlines must collapse.
    const html = "<div class='block-subtitle text12'>\n  distinguished<br>\n  design\n</div>";
    expect(node(html)).toEqual({ kind: "subtitle", role: "text12", text: "distinguished\ndesign" });
  });

  it("decodes HTML entities in a subtitle", () => {
    expect(node("<div class='block-subtitle'>Health &amp; Wellness</div>")).toEqual({
      kind: "subtitle",
      text: "Health & Wellness",
    });
  });

  it("stacks multiple sibling leaves under a container", () => {
    const html =
      "<div class='block-content'><h2 class='block-title text5'>Title</h2><div class='block-body text1'>Body</div></div>";
    expect(node(html)).toEqual({
      kind: "stack",
      children: [
        { kind: "heading", role: "text5", level: 2, html: "Title" },
        { kind: "body", role: "text1", html: "Body" },
      ],
    });
  });

  it("parses a .cagrid into a row of cells with their tokens", () => {
    const html =
      "<div class='block-grid-container cagrid'>" +
      "<div class='block-subcontent cagriditem top grid-2-r60'><div class='block-content'><h1 class='block-title text5'>L</h1></div></div>" +
      "<div class='block-subcontent cagriditem top grid-2-r40'><div class='block-content'><div class='block-media-holder'><div class='camediaload' data-media='abc' data-ext='png'></div></div></div></div>" +
      "</div>";
    expect(node(html)).toEqual({
      kind: "row",
      cells: [
        {
          token: { cols: 2, ratio: 60, raw: "grid-2-r60" },
          node: { kind: "heading", role: "text5", level: 1, html: "L" },
        },
        {
          token: { cols: 2, ratio: 40, raw: "grid-2-r40" },
          node: { kind: "media", media: { kind: "image", assetId: "abc", ext: "png" } },
        },
      ],
    });
  });

  it("treats ibb media+title holders as an implicit row (the stat pattern)", () => {
    const html =
      "<div class='block-content'>" +
      "<div class='block-media-holder ibb top grid-2-r20'><div class='camediaload' data-media='ic' data-ext='png'></div></div>" +
      "<div class='block-title-holder ibb top grid-2-r80'><h5 class='block-title text5'>Label</h5></div>" +
      "</div>";
    expect(node(html)).toEqual({
      kind: "row",
      cells: [
        {
          token: { cols: 2, ratio: 20, raw: "grid-2-r20" },
          node: { kind: "media", media: { kind: "image", assetId: "ic", ext: "png" } },
        },
        {
          token: { cols: 2, ratio: 80, raw: "grid-2-r80" },
          node: { kind: "heading", role: "text5", level: 5, html: "Label" },
        },
      ],
    });
  });

  it("preserves an unrecognized empty container as a raw node", () => {
    expect(node("<div id='burbank_map'></div>")).toEqual({
      kind: "raw",
      html: "",
    });
  });

  it("parses a bare .camediaload image (no block-media-holder wrapper) as media", () => {
    const html =
      "<div class='block-content'><div class='ib img imgfit camediaload' data-media='bare1' data-ext='jpg'></div></div>";
    expect(node(html)).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "bare1", ext: "jpg" },
    });
  });

  it("does not treat a camediaload placeholder without data-media as a media leaf", () => {
    // a lazy placeholder with no asset id should not become a media node; it is
    // not structural either, so it surfaces verbatim inside the wrapper's raw html
    const html = "<div class='block-content'><div class='camediaload'></div></div>";
    expect(node(html)).toEqual({
      kind: "raw",
      html: "<div class='camediaload'></div>",
    });
  });
});

describe("leaf anchors (CTA buttons / links)", () => {
  it("captures a standalone link/button anchor as a raw node instead of dropping it", () => {
    // The anchor sits in wrapper divs with no structural descendants; peeling
    // through it (the old behavior) lost the CTA entirely.
    const node = container(
      '<div class="block-content"><div class="text8 buttons"><a class="ib middle links" href="http://x/" target="_blank">Visit Website</a></div></div>',
    );
    expect(node).toEqual({
      kind: "raw",
      html: '<a class="ib middle links" href="http://x/" target="_blank">Visit Website</a>',
    });
  });

  it("keeps multiple sibling CTA anchors as raw nodes in a stack", () => {
    const node = container(
      '<div class="block-content"><a class="ib links" href="http://a/">One</a><a class="ib links" href="http://b/">Two</a></div>',
    );
    expect(node).toEqual({
      kind: "stack",
      children: [
        { kind: "raw", html: '<a class="ib links" href="http://a/">One</a>' },
        { kind: "raw", html: '<a class="ib links" href="http://b/">Two</a>' },
      ],
    });
  });

  it("peels through a linked-media anchor so the wrapped image still parses to media", () => {
    // An anchor WITH structural descendants is not a leaf: it keeps peeling so
    // the inner media resolves normally rather than freezing to raw.
    const node = container(
      '<div class="block-content"><a href="http://x/"><div class="ib img imgfit camediaload" data-media="u1" data-ext="jpg"></div></a></div>',
    );
    expect(node).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "u1", ext: "jpg" },
    });
  });
});

describe("data-exec custom-code embeds", () => {
  it("preserves a data-exec embed as a single raw leaf (outerHTML)", () => {
    const html = `<div id="page-content"><section class="blocks0" id="page-block-0">
      <div class="block-content">
        <div id="custom-element0" data-exec="custom_abc">
          <div id="burbank_map" style="height:600px">map loading...</div>
        </div>
      </div></section></div>`;
    const [band] = parseGridBands(html);
    expect(band?.root).toEqual({
      kind: "raw",
      html: `<div id="custom-element0" data-exec="custom_abc">
          <div id="burbank_map" style="height:600px">map loading...</div>
        </div>`,
    });
  });

  it("keeps a data-exec embed alongside a sibling grid as a stack[raw,row]", () => {
    const html = `<div id="page-content"><section class="blocks0" id="page-block-0">
      <div class="block-content">
        <div id="custom-element0" data-exec="x"><div id="burbank_map">m</div></div>
        <div class="block-grid-container cagrid" data-columns="1">
          <div class="block-subcontent cagriditem top grid-1 "><p class="block-body text2">hi</p></div>
        </div>
      </div></section></div>`;
    const [band] = parseGridBands(html);
    expect(band?.root.kind).toBe("stack");
    const stack = band?.root as { kind: "stack"; children: { kind: string }[] };
    expect(stack.children[0]?.kind).toBe("raw");
    expect(stack.children[1]?.kind).toBe("row");
  });
});

describe("media holder with a nested caption (slider-tile de-opaquing)", () => {
  it("emits the media PLUS its nested caption as a stack", () => {
    // Blux slider tiles put the slide caption inside the .camediaload holder.
    const n = node(
      '<div class="ib camediaload" data-media="s1" data-bgmedia="1"><div class="block-holder"><div class="block-content"><h5 class="block-title text5">a place to sit and breathe</h5></div></div></div>',
    );
    expect(n).toEqual({
      kind: "stack",
      children: [
        { kind: "media", media: { kind: "image", assetId: "s1" } },
        { kind: "heading", level: 5, role: "text5", html: "a place to sit and breathe" },
      ],
    });
  });
  it("a pure media holder (no caption descendant) stays a bare media node", () => {
    expect(node('<div class="ib camediaload" data-media="p1"></div>')).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "p1" },
    });
  });
});

describe("empty caslider cleanup", () => {
  it("drops an empty caslider so a lone poster stays a single media (not [media, empty])", () => {
    const n = container(
      '<div class="block-content"><div class="block-media-holder"><div class="camediaload" data-media="m1"></div></div><div class="block-grid-container cagrid caslider"></div></div>',
    );
    expect(n).toEqual({ kind: "media", media: { kind: "image", assetId: "m1" } });
  });
});

describe("slider marker (.caslider rows)", () => {
  const slide = (id: string) =>
    `<div class="block-subcontent cagriditem grid-1"><div class="blocks2 camediaload" data-bgmedia="1" data-ext="jpg" data-base="https://cdn/x/" data-media="${id}.jpg"></div></div>`;

  it("marks a .caslider row as a slider and captures data-columns", () => {
    const html = `<div id="page-content"><section id="page-block-0" class="blocks0">
      <div class="block-grid-container cagrid caslider" data-columns="1">${slide("a")}${slide("b")}</div></section></div>`;
    const [band] = parseGridBands(html);
    const row = band!.root;
    expect(row.kind).toBe("row");
    if (row.kind !== "row") return;
    expect(row.slider).toEqual({ columns: 1 });
  });

  it("a plain cagrid row carries no slider marker", () => {
    const html = `<div id="page-content"><section id="page-block-0" class="blocks0">
      <div class="block-grid-container cagrid" data-columns="1">${slide("a")}${slide("b")}</div></section></div>`;
    const [band] = parseGridBands(html);
    const row = band!.root;
    expect(row.kind).toBe("row");
    if (row.kind !== "row") return;
    expect(row.slider).toBeUndefined();
  });

  it("a .caslider without a valid data-columns still marks the row (no columns)", () => {
    const html = `<div id="page-content"><section id="page-block-0" class="blocks0">
      <div class="block-grid-container cagrid caslider">${slide("a")}${slide("b")}</div></section></div>`;
    const [band] = parseGridBands(html);
    const row = band!.root;
    expect(row.kind).toBe("row");
    if (row.kind !== "row") return;
    expect(row.slider).toEqual({});
  });

  it("captures the media holder's inline min-height", () => {
    const n = node(
      '<div class="ib camediaload" data-media="m1" data-bgmedia="1" style="min-height: 80vh; background-size: cover;"></div>',
    );
    expect(n).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "m1", fit: "cover", minHeight: "80vh" },
    });
  });
});

describe("caption capture hardening", () => {
  it("ignores an entity/whitespace-only caption (no phantom stack)", () => {
    expect(
      node(
        '<div class="ib camediaload" data-media="e1"><h5 class="block-title text5">&nbsp;</h5></div>',
      ),
    ).toEqual({ kind: "media", media: { kind: "image", assetId: "e1" } });
  });
  it("ignores a disabled caption so hidden copy never leaks", () => {
    expect(
      node(
        '<div class="ib camediaload" data-media="d1"><div class="disable"><h5 class="block-title text5">hidden</h5></div></div>',
      ),
    ).toEqual({ kind: "media", media: { kind: "image", assetId: "d1" } });
  });
});
