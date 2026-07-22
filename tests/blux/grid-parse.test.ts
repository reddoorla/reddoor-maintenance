import { describe, it, expect } from "vitest";
import { parse, type HTMLElement } from "node-html-parser";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseNode, parseContainer, parseGridBands } from "../../src/blux/grid/parse-grid.js";
import type { Node } from "../../src/blux/grid/types.js";

const node = (html: string) => parseNode(parse(html).firstChild as HTMLElement);
const container = (html: string) => parseContainer(parse(html).firstChild as HTMLElement);

const fixture = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));
const styleOf = (n: Node) => (n as { style?: Record<string, string> }).style;

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

  // block-subbody is a secondary body text role Blux emits alongside block-body
  // (e.g. williamsonHomes' about-page lead paragraph). It carries real content,
  // so it must parse as a body leaf too — otherwise its text is silently dropped.
  it("parses a subbody leaf as body (block-subbody)", () => {
    expect(node("<div class='block-subbody text3'><p>Lead paragraph.</p></div>")).toEqual({
      kind: "body",
      role: "text3",
      html: "<p>Lead paragraph.</p>",
    });
  });

  it("stacks a block-subbody sibling under a container (not dropped)", () => {
    const html =
      "<div class='block-content'><h2 class='block-title text5'>Title</h2>" +
      "<div class='block-subbody text3'>Sub body copy</div></div>";
    expect(container(html)).toEqual({
      kind: "stack",
      children: [
        { kind: "heading", role: "text5", level: 2, html: "Title" },
        { kind: "body", role: "text3", html: "Sub body copy" },
      ],
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

describe("text-leaf style deviations", () => {
  it("captures an allowlisted inline padding on a heading", () => {
    expect(node('<h3 class="block-title text6" style="padding: 0px 0px 0px 8px">T</h3>')).toEqual({
      kind: "heading",
      role: "text6",
      style: { padding: "0px 0px 0px 8px" },
      level: 3,
      html: "T",
    });
  });
  it("captures a subtitle's inline color (the hero-subtitle shape)", () => {
    expect(
      node('<div class="block-subtitle text13" style="color: rgb(255, 255, 255)">Eyebrow</div>'),
    ).toEqual({
      kind: "subtitle",
      role: "text13",
      style: { color: "rgb(255, 255, 255)" },
      text: "Eyebrow",
    });
  });
  it("decodes a margin utility class on a body with no inline style", () => {
    expect(node('<div class="block-body text1 margin-20r"><p>B</p></div>')).toEqual({
      kind: "body",
      role: "text1",
      style: { "margin-right": "20%" },
      html: "<p>B</p>",
    });
  });
  it("emits no style key when the leaf has neither inline deviations nor utilities", () => {
    expect(node('<div class="block-body text1"><p>B</p></div>')).not.toHaveProperty("style");
  });
  it("captures caption styles inside a media holder (the #395 path)", () => {
    // Band-8-style slider tiles nest the caption in the .camediaload holder;
    // the recovered caption must carry its style deviations too.
    const n = node(
      '<div class="ib camediaload" data-media="s1" data-bgmedia="1"><div class="block-content"><h5 class="block-title text5" style="color: rgb(255, 255, 255)">cap</h5></div></div>',
    );
    expect(n).toEqual({
      kind: "stack",
      children: [
        { kind: "media", media: { kind: "image", assetId: "s1" } },
        {
          kind: "heading",
          role: "text5",
          style: { color: "rgb(255, 255, 255)" },
          level: 5,
          html: "cap",
        },
      ],
    });
  });
});

describe("band blockClass capture", () => {
  it("captures the wrapper's blocksN class (div hero band and plain section)", () => {
    const html = `<div id="page-content">
      <div id="page-block-0" class="blocks2 camediaload" data-bgmedia="1" data-ext="jpg" data-media="bg1.jpg"><div class="block-content"><div class="block-body text1">x</div></div></div>
      <section id="page-block-1" class="blocks0"><div class="block-content"><div class="block-body text1">y</div></div></section>
    </div>`;
    const bands = parseGridBands(html);
    expect(bands[0]?.blockClass).toBe("blocks2");
    expect(bands[1]?.blockClass).toBe("blocks0");
  });
  it("leaves blockClass absent when no blocksN class matches", () => {
    const html = `<div id="page-content">
      <section id="page-block-0" class="fancy blocksy"><div class="block-body text1">y</div></section>
    </div>`;
    const [band] = parseGridBands(html);
    expect(band).not.toHaveProperty("blockClass");
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

describe("card background capture", () => {
  it("rides a peeled wrapper's background-color onto the grid row it wraps", () => {
    // A Blux "card": a `.blocks0` with an inline white background wrapping a
    // grid. The wrapper is peeled (no token/cagrid of its own), so its color
    // would be lost — instead it lands on the row as a `style` deviation.
    const html =
      '<div class="block-content">' +
      '<div class="blocks0" style="background-color: rgb(255, 255, 255); text-align: left;">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-2-r50"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-2-r50"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("row");
    expect(styleOf(result)).toEqual({ "background-color": "rgb(255, 255, 255)" });
    if (result.kind === "row") expect(result.cells).toHaveLength(2);
  });

  it("carries the card's fill, padding and valign hint, but not inline text-align", () => {
    // A card's background (fill), content padding (inset), and the wrapper's
    // `valignmiddle` class (as the `_valign` presentation hint — the original
    // vertically centers this cell against its row siblings) all ride along.
    // Inline text-align / vertical-align CSS stays a band-level concern, dropped.
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0" style="background-color: rgb(0, 0, 0); text-align: center; vertical-align: middle;">' +
      '<div class="blocks0container valignmiddle" style="padding: 40px;">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div></div>";
    expect(styleOf(container(html))).toEqual({
      "background-color": "rgb(0, 0, 0)",
      padding: "40px",
      _valign: "middle",
    });
  });

  it("rides the inner .blocksNcontainer padding onto the card (fill outer, inset inner)", () => {
    // The real Blux card shape: background sits on the `.blocksN` fill, padding on
    // its `.blocksNcontainer` content wrapper — a *different* peeled element. Both
    // must reach the card node (the nearest wrapper wins for each).
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0" style="background-color: rgb(255, 255, 255);">' +
      '<div class="blocks0container" style="padding: 100px 4% 80px;">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div></div>";
    expect(styleOf(container(html))).toEqual({
      "background-color": "rgb(255, 255, 255)",
      padding: "100px 4% 80px",
    });
  });

  it("ignores a BAND-level container's padding (the band's own content padding)", () => {
    // A `.blocksNcontainer` padding ABOVE any grid-cell boundary is the band's
    // content padding, already handled via the band style/blockClass defaults —
    // it must not ride onto a nested node, or the inset would be applied twice.
    // (Inside a cell, padding rides with or without a fill — see the cell tests.)
    const html =
      '<div class="block-content">' +
      '<div class="blocks0container" style="padding: 100px 4% 80px;">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div>";
    expect(styleOf(container(html))).toBeUndefined();
  });

  it("rides a cell-level container padding WITHOUT a fill (band 11's padded heading cell)", () => {
    // Inside a grid cell, a container's inline padding is real content inset
    // even with no background — live band 11's middle cell pads its lone
    // heading by 20px/30px. A bare leaf gains a synthetic one-child stack to
    // carry the box.
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0">' +
      '<div class="blocks0container" style="padding: 20px 0px 30px;">' +
      '<div class="block-content"><h4 class="block-title text11">A city</h4></div>' +
      "</div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({ padding: "20px 0px 30px" });
    if (result.kind === "stack") {
      expect(result.children).toHaveLength(1);
      expect(result.children[0]?.kind).toBe("heading");
    }
  });

  it("drops a hidden feed-template prototype instead of rendering its {{…}} tokens", () => {
    // A JS-hydrated feed grid: the only static child is the display:none
    // `…-template` cagriditem Blux clones per record. It carries Handlebars
    // tokens, never real content — the parser drops it (the visible tiles are
    // materialized from the feed records, not this element).
    const html =
      '<div class="block-content"><div class="block-grid-container cagrid" data-columns="3">' +
      '<div id="page-block-1-template" class="block-subcontent cagriditem grid-3-s10" style="display: none;">' +
      '<div class="blocks5"><div class="block-content">' +
      '<div class="block-media-holder">{{media}}</div>' +
      '<h6 class="block-title text5">{{title}}</h6>' +
      "</div></div></div></div></div>";
    const result = container(html);
    // Nothing renders — no {{media}}/{{title}} leaks into a raw node.
    expect(JSON.stringify(result)).not.toContain("{{");
    // A grid whose ONLY child was the template collapses to an empty raw.
    expect(result).toEqual({ kind: "raw", html: "" });
  });

  it("keeps the real tiles when a feed grid has both static tiles and a hidden template", () => {
    // Home-band shape: pre-rendered tiles PLUS the hidden clone template. The
    // real tiles survive; the template drops.
    const html =
      '<div class="block-content"><div class="block-grid-container cagrid" data-columns="2">' +
      '<div class="block-subcontent cagriditem grid-2"><h5 class="block-title text5">Real</h5></div>' +
      '<div id="x-template" class="block-subcontent cagriditem grid-2" style="display:none">' +
      '<h5 class="block-title text5">{{title}}</h5></div>' +
      "</div></div>";
    const result = container(html);
    expect(JSON.stringify(result)).not.toContain("{{");
    // Only the real tile remains — a lone grid-2 (width-constrained) cell
    // keeps its row (the token IS the column width), holding the real heading.
    expect(result.kind).toBe("row");
    if (result.kind !== "row") return;
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.node).toMatchObject({ kind: "heading", html: "Real" });
  });

  it("captures a nested block-in-cell: min-height, background layer, and valign (the-tower band 1)", () => {
    // A grid cell holding a FULL Blux block: the item pins its box with inline
    // `min-height` (80vh), paints it via an abs-fill `block-background-layer`
    // (a gradient — not a background-color the fill capture sees), and centers
    // content with a valignmiddle container. The peel dropped all three, so
    // the cell rendered at content height with no fill (-808px vs live).
    const html =
      '<div class="block-subcontent grid-2">' +
      '<div class="blocks0" style="text-align: left; vertical-align: middle; min-height: 80vh;">' +
      '<div class="block-background-layer abs-fill" style="background: linear-gradient(45deg, rgb(82, 102, 126) 0%, rgb(175, 173, 168) 100%); z-index: 0;"></div>' +
      '<div class="block-holder" style="position: relative; z-index: 2;">' +
      '<div class="blockcontainer blocks0container valignmiddle" style="min-height: 80vh; height: 1px;">' +
      '<div class="block-content valignmiddleitem" style="width: 100%;">' +
      '<div class="block-sub-item-container">' +
      '<div class="block-grid-container ">' +
      '<div class="block-subcontent ">' +
      '<h1 class="block-title text11">the tower</h1>' +
      '<h5 class="block-title text10">Stand above the rest</h5>' +
      "</div></div></div></div></div></div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({
      "min-height": "80vh",
      background: "linear-gradient(45deg, rgb(82, 102, 126) 0%, rgb(175, 173, 168) 100%)",
      _valign: "middle",
    });
    if (result.kind === "stack")
      expect(result.children.map((c) => c.kind)).toEqual(["heading", "heading"]);
  });

  it("ignores a BAND-level container's min-height (band chrome, not cell sizing)", () => {
    // Above any grid-cell boundary, a container's `min-height: 100vh; height:
    // 1px` is the band's own full-height chrome (the hero pattern) — band
    // sizing is the band style's concern, so it must not ride onto a nested
    // node. Mirrors the band-level padding exclusion above.
    const html =
      '<div class="block-content">' +
      '<div class="blocks0container" style="min-height: 100vh; height: 1px;">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div>";
    expect(styleOf(container(html))).toBeUndefined();
  });

  it("a min-height wrapper around a bare leaf gains the synthetic stack (a sized box)", () => {
    // Like padding/valign, a min-height is a real box the leaf must sit in —
    // a leaf has no style slot, so the one-child stack carries it. Zero/auto
    // min-heights carry no sizing and are ignored.
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0" style="min-height: 400px;">' +
      '<div class="blocks0container" style="min-height: 0; padding: 0px;">' +
      '<div class="block-content"><h4 class="block-title text11">Boxed</h4></div>' +
      "</div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({ "min-height": "400px" });
  });

  it("a min-height wrapper around a MEDIA leaf folds into media.minHeight — never a box", () => {
    // Slider slides are pure-media cells behind min-height wrappers; boxing
    // them in a synthetic stack demotes Carousel classification (slides must
    // stay bare media), turning working sliders into static galleries. The
    // wrapper's height folds into media.minHeight instead (a no-op when the
    // holder already carries the same value, as real slides do).
    const boxed = container(
      '<div class="block-subcontent">' +
        '<div class="blocks0" style="min-height: 500px;">' +
        '<div class="ib camediaload" data-media="s1"></div>' +
        "</div></div>",
    );
    expect(boxed).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "s1", minHeight: "500px" },
    });
    // The holder's own min-height wins over the wrapper's when both exist.
    const own = container(
      '<div class="block-subcontent">' +
        '<div class="blocks0" style="min-height: 500px;">' +
        '<div class="ib camediaload" data-media="s2" style="min-height: 80vh;"></div>' +
        "</div></div>",
    );
    expect(own).toEqual({
      kind: "media",
      media: { kind: "image", assetId: "s2", minHeight: "80vh" },
    });
  });

  it("a gradient-layer-only card around a bare text leaf keeps the fill (synthetic stack)", () => {
    // A flush, content-height gradient card holding one heading: no padding,
    // no min-height, no valignmiddle — the layer paint is the only capture,
    // and it has no other render path, so the box must carry it.
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0">' +
      '<div class="block-background-layer abs-fill" style="background: linear-gradient(rgb(0, 0, 0), rgb(9, 9, 9));"></div>' +
      '<div class="block-holder"><div class="blocks0container" style="padding: 0px;">' +
      '<div class="block-content"><h4 class="block-title text11">Filled</h4></div>' +
      "</div></div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({
      background: "linear-gradient(rgb(0, 0, 0), rgb(9, 9, 9))",
    });
  });

  it("a boxed wrapper (min-height/layer) over TWO blocks promotes the group — box applied once", () => {
    // The padding promotion's parallel: threading an 80vh gradient box onto
    // each of two sibling leaves would double the box (160vh, painted twice).
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0" style="min-height: 80vh;">' +
      '<h4 class="block-title text5">A</h4>' +
      '<div class="block-body text1">B</div>' +
      "</div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({ "min-height": "80vh" });
    if (result.kind === "stack")
      expect(result.children.map((c) => c.kind)).toEqual(["heading", "body"]);
  });

  it("a cagridFlexHeight grid marks painted cells `_fill: column`; plain grids don't", () => {
    // The original stretches each FlexHeight cell's direct block to the full
    // row height (`.cagriditem>div{height:100%}`) — a painted block fills its
    // whole column, not just its content box. Unpainted cells stay unmarked
    // (stretching an unpainted box is visually identity).
    const grid = (extra: string) =>
      `<div class="block-grid-container ${extra} cagrid">` +
      '<div class="block-subcontent grid-2">' +
      '<div class="blocks0">' +
      '<div class="block-background-layer abs-fill" style="background: linear-gradient(rgb(1, 1, 1), rgb(2, 2, 2));"></div>' +
      '<div class="block-holder"><div class="blocks0container" style="padding: 40px;">' +
      '<div class="block-content"><h4 class="block-title text5">A</h4><div class="block-body text1">B</div></div>' +
      "</div></div></div></div>" +
      '<div class="block-subcontent grid-2"><h5 class="block-title text5">plain</h5></div>' +
      "</div>";
    const flex = container(grid("cagridFlexHeight"));
    expect(flex.kind).toBe("row");
    if (flex.kind !== "row") return;
    const painted = styleOf(flex.cells[0]!.node);
    expect(painted?.["_fill"]).toBe("column");
    expect(painted?.["background"]).toContain("linear-gradient");
    // The unpainted text cell carries no fill hint.
    expect(styleOf(flex.cells[1]!.node)?.["_fill"]).toBeUndefined();
    // A plain (non-FlexHeight) grid: same shapes, no fill hints anywhere.
    const plain = container(grid(""));
    if (plain.kind !== "row") return;
    expect(styleOf(plain.cells[0]!.node)?.["_fill"]).toBeUndefined();
  });

  it("groups a multi-child grid cell into its own stack (margin containment)", () => {
    // A bare block-subcontent with two blocks parses to a nested stack — the
    // original contains the blocks' margins per cell (a block-content clearfix
    // blocks the collapse), so the boundary must survive the flatten.
    const html =
      '<div class="block-content">' +
      '<div class="block-grid-container">' +
      '<div class="block-subcontent">' +
      '<h4 class="block-title text5">Title</h4>' +
      '<div class="block-body text1">Copy</div>' +
      "</div>" +
      '<div class="block-subcontent">' +
      '<div class="block-body text1">Solo</div>' +
      "</div></div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    if (result.kind !== "stack") return;
    // cell 1 (two blocks) is contained; cell 2 (one block) stays a bare leaf
    expect(result.children.map((c) => c.kind)).toEqual(["stack", "body"]);
    const cell = result.children[0];
    if (cell?.kind === "stack")
      expect(cell.children.map((c) => c.kind)).toEqual(["heading", "body"]);
  });

  it("a LONE width-constrained cell keeps its row (the token IS the column width)", () => {
    // Band 9/11's shape: one grid-2-r60 cell in a bare grid container — the 60%
    // token is the content column's width; flattening to a stack would render
    // the content full-width (a real regression caught on the live diff).
    const html =
      '<div class="block-content">' +
      '<div class="block-grid-container">' +
      '<div class="block-subcontent grid-2-r60"><h4 class="block-title text5">T</h4></div>' +
      "</div></div>";
    const result = container(html);
    expect(result.kind).toBe("row");
    if (result.kind !== "row") return;
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.token).toMatchObject({ cols: 2, ratio: 60 });
  });

  it("a lone cols-1 cell still flattens (no width constraint, no row noise)", () => {
    const html =
      '<div class="block-content">' +
      '<div class="block-grid-container">' +
      '<div class="block-subcontent grid-1"><h4 class="block-title text5">T</h4></div>' +
      "</div></div>";
    expect(container(html).kind).toBe("heading");
  });

  it("a padded wrapper around TWO blocks pads the group once, not each child", () => {
    const html =
      '<div class="block-subcontent">' +
      '<div class="blocks0container" style="padding: 20px 0px;">' +
      '<h4 class="block-title text5">A</h4>' +
      '<div class="block-body text1">B</div>' +
      "</div></div>";
    const result = container(html);
    expect(result.kind).toBe("stack");
    expect(styleOf(result)).toEqual({ padding: "20px 0px" });
    if (result.kind !== "stack") return;
    expect(result.children.map((c) => c.kind)).toEqual(["heading", "body"]);
    // neither child carries the padding
    for (const c of result.children) expect(styleOf(c)).toBeUndefined();
  });

  it("ignores a transparent background (not a real deviation)", () => {
    const html =
      '<div class="block-content">' +
      '<div class="blocks0" style="background-color: rgba(0, 0, 0, 0);">' +
      '<div class="block-grid-container cagrid">' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">A</h5></div>' +
      '<div class="block-subcontent grid-1"><h5 class="block-title text5">B</h5></div>' +
      "</div></div></div>";
    expect(styleOf(container(html))).toBeUndefined();
  });

  it("drops a card background around a bare leaf (no container node to carry it)", () => {
    // A leaf has no `style` slot for a container background; such cards (the
    // the-pointe carousel captions) are handled by their own render path, and
    // the Grid tree must not invent one — the leaf parses unchanged.
    const html =
      '<div class="block-content">' +
      '<div class="blocks0" style="background-color: rgb(255, 255, 255);">' +
      '<h5 class="block-title text5">Solo</h5>' +
      "</div></div>";
    expect(container(html)).toEqual({ kind: "heading", role: "text5", level: 5, html: "Solo" });
  });

  it("restores the-pointe band 3's white stats card (real fixture)", () => {
    const bands = parseGridBands(readFileSync(fixture, "utf-8"));
    const band3 = bands.find((b) => b.index === 3);
    expect(band3).toBeDefined();
    // Band 3 is a 50/50 row: cell[0] = building images (left), cell[1] = the
    // stats grid (right) — the card that carries the white background.
    const root = band3!.root;
    expect(root.kind).toBe("row");
    if (root.kind !== "row") return;
    const [left, right] = root.cells;
    // The white fill, the card's 100px/4%/80px content inset, and its
    // valignmiddle centering hint all ride along. The band's grid is
    // cagridFlexHeight, so the painted card also carries the column-fill
    // hint — live stretches the white card to the full row height (the old
    // 44px live-vs-ours residual on this card was exactly this stretch).
    expect(styleOf(right!.node)).toEqual({
      "background-color": "rgb(255, 255, 255)",
      padding: "100px 4% 80px",
      _valign: "middle",
      _fill: "column",
    });
    // The building-image column and the band root itself stay transparent.
    expect(styleOf(left!.node)?.["background-color"]).toBeUndefined();
    expect(styleOf(root)?.["background-color"]).toBeUndefined();
    // The band root carries no card padding (only the nested stats card does).
    expect(styleOf(root)?.padding).toBeUndefined();
  });
});
