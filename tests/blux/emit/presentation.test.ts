import { describe, it, expect } from "vitest";
import { buildPresentation, type PresentationDeps } from "../../../src/blux/emit/presentation.js";
import type { SliceSpec, Media, Node } from "../../../src/blux/grid/index.js";

const url = (m: Media) => ({
  kind: m.kind,
  url: `https://cdn/${m.assetId}.jpg`,
  alt: `alt-${m.assetId}`,
  ...(m.minHeight ? { minHeight: m.minHeight } : {}),
});
const deps: PresentationDeps = {
  resolveMedia: url,
  styleFor: (i) => (i === 7 ? { "background-color": "#fff" } : undefined),
  defaultsFor: () => undefined,
  map: null,
};

// The real the-pointe class defaults (blocks0/blocks2), for the fill tests.
const pointeDefaults: PresentationDeps["defaultsFor"] = (blockClass) =>
  blockClass === "blocks0"
    ? {
        padding: "120px 4% 120px 4%",
        mobilePadding: "80px 4% 80px 4%",
        maxWidth: "1280px",
      }
    : undefined;

const img = (id: string): Media => ({ kind: "image", assetId: id });

describe("buildPresentation", () => {
  it("keys bands by String(index) and attaches style/background per band", () => {
    const specs: SliceSpec[] = [{ index: 7, slice: "Hero", heading: "H", background: img("bg") }];
    const p = buildPresentation(specs, deps);
    expect(Object.keys(p.bands)).toEqual(["7"]);
    expect(p.bands["7"]).toEqual({
      style: { "background-color": "#fff" },
      background: { kind: "image", url: "https://cdn/bg.jpg", alt: "alt-bg" },
    });
  });

  it("Gallery → gallery[], MediaFull/VideoFeature → media, no style when absent", () => {
    const specs: SliceSpec[] = [
      { index: 0, slice: "Gallery", media: [img("a"), img("b")] },
      { index: 1, slice: "MediaFull", media: img("c") },
      { index: 2, slice: "VideoFeature", media: { kind: "video", assetId: "v" } },
    ];
    const p = buildPresentation(specs, deps);
    expect(p.bands["0"]).toEqual({ gallery: [url(img("a")), url(img("b"))] });
    expect(p.bands["1"]).toEqual({ media: url(img("c")) });
    expect(p.bands["2"]).toEqual({
      media: { kind: "video", url: "https://cdn/v.jpg", alt: "alt-v" },
    });
  });

  it("SplitFeature → split payload with resolved media + recursively-serialized text", () => {
    const text: Node = { kind: "body", html: "<p>copy</p>" };
    const specs: SliceSpec[] = [
      { index: 1, slice: "SplitFeature", ratio: 40, mediaSide: "right", media: img("m"), text },
    ];
    const p = buildPresentation(specs, deps);
    expect(p.bands["1"]).toEqual({
      split: {
        mediaSide: "right",
        ratio: 40,
        media: url(img("m")),
        text: { kind: "body", html: "<p>copy</p>" },
      },
    });
  });

  it("Grid → tree with GridToken.raw stripped and cell Media resolved", () => {
    const root: Node = {
      kind: "row",
      cells: [
        { token: { cols: 2, raw: "grid-2" }, node: { kind: "body", html: "<p>x</p>" } },
        {
          token: { cols: 2, ratio: 40, raw: "grid-2-r40" },
          node: { kind: "media", media: img("z") },
        },
      ],
    };
    const p = buildPresentation([{ index: 3, slice: "Grid", root }], deps);
    expect(p.bands["3"]!.tree).toEqual({
      kind: "row",
      cells: [
        { token: { cols: 2 }, node: { kind: "body", html: "<p>x</p>" } },
        { token: { cols: 2, ratio: 40 }, node: { kind: "media", media: url(img("z")) } },
      ],
    });
  });

  it("Carousel → carousel slides (resolved media incl. minHeight, caption meta only) + columns", () => {
    const specs: SliceSpec[] = [
      {
        index: 8,
        slice: "Carousel",
        columns: 1,
        slides: [
          {
            media: { ...img("a"), minHeight: "80vh" },
            caption: { html: "a place to sit", level: 5, role: "text5" },
          },
          { media: img("b") },
          { media: img("gone") },
        ],
      },
    ];
    const p = buildPresentation(specs, {
      ...deps,
      // the third slide's media is unresolvable → the list truncates there
      resolveMedia: (m) => (m.assetId === "gone" ? null : url(m)),
    });
    expect(p.bands["8"]).toEqual({
      carousel: {
        slides: [
          {
            media: url({ ...img("a"), minHeight: "80vh" }),
            caption: { level: 5, role: "text5" }, // caption TEXT lives in the page doc
          },
          { media: url(img("b")) },
        ],
        columns: 1,
      },
    });
  });

  it("truncates carousel slides at an unresolved MIDDLE media — later slides must not shift onto the wrong page-doc caption", () => {
    const specs: SliceSpec[] = [
      {
        index: 8,
        slice: "Carousel",
        slides: [{ media: img("a") }, { media: img("gone") }, { media: img("c") }],
      },
    ];
    const p = buildPresentation(specs, {
      ...deps,
      resolveMedia: (m) => (m.assetId === "gone" ? null : url(m)),
    });
    expect(p.bands["8"]).toEqual({ carousel: { slides: [{ media: url(img("a")) }] } });
  });

  it("omits the carousel payload entirely when every slide's media is unresolved", () => {
    const specs: SliceSpec[] = [
      { index: 8, slice: "Carousel", slides: [{ media: img("x") }, { media: img("y") }] },
    ];
    const p = buildPresentation(specs, { ...deps, resolveMedia: () => null });
    expect(p.bands["8"]).toEqual({});
  });

  it("LocationMap → map payload from deps.map", () => {
    const map = { mid: "M", layers: [], toggles: [], styles: [] };
    const p = buildPresentation([{ index: 5, slice: "LocationMap" }], { ...deps, map });
    expect(p.bands["5"]).toEqual({ map });
  });

  it("attaches deps.map to a Grid band whose tree contains a widget:map", () => {
    const map = { mid: "M", layers: [], toggles: [], styles: [] };
    const root: Node = {
      kind: "stack",
      children: [
        { kind: "widget", widget: { type: "map" } },
        { kind: "body", html: "<p>addr</p>" },
      ],
    };
    const p = buildPresentation([{ index: 9, slice: "Grid", root }], { ...deps, map });
    expect(p.bands["9"]!.map).toEqual(map);
    expect(p.bands["9"]!.tree?.kind).toBe("stack");
  });

  it("drops a media node whose asset is unresolved rather than emitting a bad url", () => {
    const p = buildPresentation([{ index: 0, slice: "MediaFull", media: img("gone") }], {
      ...deps,
      resolveMedia: () => null,
    });
    expect(p.bands["0"]).toEqual({}); // media omitted, band still present
  });

  it("fills class-default padding (+mobile, +max-width) when the block's own styles omit them", () => {
    // A TitleBand on purpose: the fill runs before the per-slice switch, so
    // text-only slices get their band padding too.
    const specs: SliceSpec[] = [
      { index: 4, slice: "TitleBand", heading: "T", blockClass: "blocks0" },
    ];
    const p = buildPresentation(specs, { ...deps, defaultsFor: pointeDefaults });
    expect(p.bands["4"]!.style).toEqual({
      _contentPadding: "120px 4% 120px 4%",
      _contentPaddingMobile: "80px 4% 80px 4%",
      "_max-content-width": "1280px",
    });
  });

  it("keeps a block's own styles alongside the fill (own keys win, missing ones fill)", () => {
    const specs: SliceSpec[] = [
      { index: 1, slice: "TitleBand", heading: "T", blockClass: "blocks0" },
    ];
    const p = buildPresentation(specs, {
      ...deps,
      styleFor: () => ({ "text-align": "center", "_max-content-width": "1280px" }),
      defaultsFor: pointeDefaults,
    });
    expect(p.bands["1"]!.style).toEqual({
      "text-align": "center",
      "_max-content-width": "1280px", // the block's own value, not re-filled
      _contentPadding: "120px 4% 120px 4%",
      _contentPaddingMobile: "80px 4% 80px 4%",
    });
  });

  it("leaves a block that carries its own _contentPadding untouched — no mobile key added", () => {
    const specs: SliceSpec[] = [
      { index: 0, slice: "TitleBand", heading: "T", blockClass: "blocks0" },
    ];
    const own = { _contentPadding: "0 4% 0 4%", "_max-content-width": "1280px" };
    const p = buildPresentation(specs, {
      ...deps,
      styleFor: () => ({ ...own }),
      defaultsFor: pointeDefaults,
    });
    expect(p.bands["0"]!.style).toEqual(own);
    expect(p.bands["0"]!.style).not.toHaveProperty("_contentPaddingMobile");
  });

  it("leaves a band with no blockClass, or no defaults entry for it, untouched", () => {
    const specs: SliceSpec[] = [
      { index: 0, slice: "TitleBand", heading: "A" }, // no blockClass
      { index: 1, slice: "TitleBand", heading: "B", blockClass: "blocks9" }, // no entry
    ];
    const p = buildPresentation(specs, { ...deps, defaultsFor: pointeDefaults });
    expect(p.bands["0"]).toEqual({});
    expect(p.bands["1"]).toEqual({});
  });

  it("passes text-node style deviations through to the RenderNode (all three variants)", () => {
    const root: Node = {
      kind: "stack",
      children: [
        { kind: "heading", level: 3, html: "H", style: { padding: "0px 0px 0px 8px" } },
        { kind: "body", html: "<p>B</p>", style: { "margin-right": "20%" } },
        { kind: "subtitle", text: "S", style: { color: "rgb(255, 255, 255)" } },
        { kind: "body", html: "<p>plain</p>" }, // absent stays absent
      ],
    };
    const p = buildPresentation([{ index: 2, slice: "Grid", root }], deps);
    expect(p.bands["2"]!.tree).toEqual({
      kind: "stack",
      children: [
        { kind: "heading", level: 3, html: "H", style: { padding: "0px 0px 0px 8px" } },
        { kind: "body", html: "<p>B</p>", style: { "margin-right": "20%" } },
        { kind: "subtitle", text: "S", style: { color: "rgb(255, 255, 255)" } },
        { kind: "body", html: "<p>plain</p>" },
      ],
    });
  });
});
