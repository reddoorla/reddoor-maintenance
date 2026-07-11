import { describe, it, expect } from "vitest";
import { parse, type HTMLElement } from "node-html-parser";
import { parseNode, parseGridBands } from "../../src/blux/grid/parse-grid.js";

const node = (html: string) => parseNode(parse(html).firstChild as HTMLElement);

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
