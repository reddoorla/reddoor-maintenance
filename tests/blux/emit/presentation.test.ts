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
  map: null,
};

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
      // the third slide's media is unresolvable → the slide is dropped
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
});
