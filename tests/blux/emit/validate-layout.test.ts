import { describe, expect, it } from "vitest";
import type { Node, SliceSpec } from "../../../src/blux/grid/index.js";
import type { Presentation, RenderNode } from "../../../src/blux/emit/presentation.js";
import { sigOf, validateLayout } from "../../../src/blux/emit/validate-layout.js";

// --- helpers: minimal source + render nodes ---------------------------------
const img = (id: string): Extract<Node, { kind: "media" }> => ({
  kind: "media",
  media: { kind: "image", assetId: id },
});
const rImg = (): Extract<RenderNode, { kind: "media" }> => ({
  kind: "media",
  media: { kind: "image", url: "asset://x" },
});
// a source row of two cells: [6: heading, 6: image]
const srcRow: Node = {
  kind: "row",
  cells: [
    { token: { cols: 6, raw: "grid-2" }, node: { kind: "heading", level: 2, html: "<h2>x</h2>" } },
    { token: { cols: 6, raw: "grid-2" }, node: img("a1") },
  ],
};
// its faithful render twin
const renRow: RenderNode = {
  kind: "row",
  cells: [
    { token: { cols: 6 }, node: { kind: "heading", level: 2, html: "<h2>x</h2>" } },
    { token: { cols: 6 }, node: rImg() },
  ],
};
const gridSpec = (index: number, root: Node): SliceSpec => ({ slice: "Grid", index, root });

describe("sigOf — source Node and RenderNode twins share one signature", () => {
  it("gives a source token and its raw-less render twin the same string", () => {
    expect(sigOf(srcRow)).toBe("row[6:h2,6:media:image]");
    expect(sigOf(renRow)).toBe("row[6:h2,6:media:image]");
    expect(sigOf(srcRow)).toBe(sigOf(renRow));
  });
  it("encodes ratio/sized tokens without the source-only raw", () => {
    const n: Node = {
      kind: "row",
      cells: [{ token: { cols: 2, ratio: 40, raw: "grid-2-r40" }, node: img("a") }],
    };
    expect(sigOf(n)).toBe("row[2r40:media:image]");
  });
});

describe("validateLayout — faithful conversions", () => {
  it("passes when every Grid tree round-trips and no media dropped", () => {
    const specs = [gridSpec(0, srcRow)];
    const pres: Presentation = { bands: { "0": { tree: renRow } } };
    const r = validateLayout(specs, pres);
    expect(r.faithful).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.bands).toBe(1);
    expect(r.gridBands).toBe(1);
    expect(r.rows[0]).toMatchObject({ band: 0, slice: "Grid", ok: true });
  });

  it("is vacuously faithful for zero bands", () => {
    const r = validateLayout([], { bands: {} });
    expect(r.faithful).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe("validateLayout — findings", () => {
  it("flags tree drift when the manifest dropped a media cell", () => {
    // render twin lost the image cell (unresolved media → renderNode dropped it)
    const droppedRow: RenderNode = { kind: "row", cells: [renRow.cells[0]!] };
    const r = validateLayout([gridSpec(0, srcRow)], { bands: { "0": { tree: droppedRow } } });
    expect(r.faithful).toBe(false);
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 0,
      expected: "row[6:h2,6:media:image]",
      actual: "row[6:h2]",
    });
    expect(r.rows[0]!.ok).toBe(false);
  });

  it("flags a Grid band with no manifest tree", () => {
    const r = validateLayout([gridSpec(3, srcRow)], { bands: { "3": {} } });
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 3,
      expected: "row[6:h2,6:media:image]",
      actual: "∅",
    });
  });

  it("flags a band missing from the manifest entirely", () => {
    const r = validateLayout([gridSpec(0, srcRow)], { bands: {} });
    expect(r.findings).toContainEqual({ kind: "band-missing", band: 0 });
    expect(r.findings).toContainEqual({ kind: "band-count", specs: 1, manifest: 0 });
  });

  it("flags a band-count mismatch when the manifest has more bands than specs", () => {
    // spec 0 is present + faithful; the stray manifest band "1" surfaces only via band-count.
    const pres: Presentation = { bands: { "0": { tree: renRow }, "1": {} } };
    const r = validateLayout([gridSpec(0, srcRow)], pres);
    expect(r.findings).toContainEqual({ kind: "band-count", specs: 1, manifest: 2 });
    expect(r.findings.some((f) => f.kind === "band-missing")).toBe(false);
  });

  it("flags a short gallery (an image dropped)", () => {
    const specs: SliceSpec[] = [
      {
        slice: "Gallery",
        index: 8,
        media: [
          { kind: "image", assetId: "a" },
          { kind: "image", assetId: "b" },
          { kind: "image", assetId: "c" },
        ],
      },
    ];
    const pres: Presentation = {
      bands: { "8": { gallery: [{ kind: "image", url: "asset://a" }] } },
    };
    const r = validateLayout(specs, pres);
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 8, where: "gallery 1/3" });
    expect(r.rows[0]).toMatchObject({ source: "gallery(3)", converted: "gallery(1)", ok: false });
  });

  it("flags a split_feature whose media/text failed to resolve", () => {
    const specs: SliceSpec[] = [
      {
        slice: "SplitFeature",
        index: 1,
        ratio: 40,
        mediaSide: "right",
        media: { kind: "image", assetId: "m" },
        text: { kind: "body", html: "<p>t</p>" },
      },
    ];
    const r = validateLayout(specs, { bands: { "1": {} } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 1, where: "split" });
  });

  it("passes a SplitFeature whose side/ratio match the manifest", () => {
    const specs: SliceSpec[] = [
      {
        slice: "SplitFeature",
        index: 1,
        ratio: 40,
        mediaSide: "right",
        media: { kind: "image", assetId: "m" },
        text: { kind: "body", html: "<p>t</p>" },
      },
    ];
    const pres: Presentation = {
      bands: {
        "1": {
          split: {
            mediaSide: "right",
            ratio: 40,
            media: { kind: "image", url: "asset://m" },
            text: { kind: "body", html: "<p>t</p>" },
          },
        },
      },
    };
    const r = validateLayout(specs, pres);
    expect(r.faithful).toBe(true);
    expect(r.rows[0]).toMatchObject({ ok: true, converted: "split(right,40)" });
  });

  it("flags a SplitFeature whose media side flipped", () => {
    const specs: SliceSpec[] = [
      {
        slice: "SplitFeature",
        index: 1,
        ratio: 40,
        mediaSide: "right",
        media: { kind: "image", assetId: "m" },
        text: { kind: "body", html: "<p>t</p>" },
      },
    ];
    const pres: Presentation = {
      bands: {
        "1": {
          split: {
            mediaSide: "left",
            ratio: 40,
            media: { kind: "image", url: "asset://m" },
            text: { kind: "body", html: "<p>t</p>" },
          },
        },
      },
    };
    const r = validateLayout(specs, pres);
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 1,
      expected: "split(right,40)",
      actual: "split(left,40)",
    });
    expect(r.rows[0]!.ok).toBe(false);
  });

  it("flags a SplitFeature whose text-side nested media dropped", () => {
    // The split's text side is a full node subtree (band 1 of the-pointe nests
    // media in it). If a nested media fails to resolve, renderNode drops it from
    // bp.split.text while side/ratio still match — the gate must still flag it.
    const textWithMedia: Node = {
      kind: "stack",
      children: [{ kind: "heading", level: 3, html: "<h3>x</h3>" }, img("nested")],
    };
    const specs: SliceSpec[] = [
      {
        slice: "SplitFeature",
        index: 1,
        ratio: 40,
        mediaSide: "right",
        media: { kind: "image", assetId: "m" },
        text: textWithMedia,
      },
    ];
    const droppedText: RenderNode = {
      kind: "stack",
      children: [{ kind: "heading", level: 3, html: "<h3>x</h3>" }], // nested media gone
    };
    const pres: Presentation = {
      bands: {
        "1": {
          split: {
            mediaSide: "right",
            ratio: 40,
            media: { kind: "image", url: "asset://m" },
            text: droppedText,
          },
        },
      },
    };
    const r = validateLayout(specs, pres);
    expect(r.faithful).toBe(false);
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 1,
      expected: "split.text stack[h3,media:image]",
      actual: "split.text stack[h3]",
    });
  });

  it("flags a media_full band whose media dropped", () => {
    const specs: SliceSpec[] = [
      { slice: "MediaFull", index: 5, media: { kind: "image", assetId: "m" } },
    ];
    const r = validateLayout(specs, { bands: { "5": {} } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 5, where: "media" });
  });

  it("flags a video_feature band whose media dropped", () => {
    const specs: SliceSpec[] = [
      { slice: "VideoFeature", index: 6, media: { kind: "video", assetId: "v" } },
    ];
    const r = validateLayout(specs, { bands: { "6": {} } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 6, where: "media" });
    expect(r.rows[0]).toMatchObject({ source: "video" });
  });

  it("flags a dropped band background", () => {
    const specs = [gridSpec(0, srcRow)].map((s) => ({
      ...s,
      background: { kind: "image" as const, assetId: "bg" },
    }));
    const r = validateLayout(specs, { bands: { "0": { tree: renRow } } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 0, where: "background" });
  });

  it("flags a LocationMap band with no map config", () => {
    const specs: SliceSpec[] = [{ slice: "LocationMap", index: 13 }];
    const r = validateLayout(specs, { bands: { "13": {} } });
    expect(r.findings).toContainEqual({ kind: "map-missing", band: 13 });
  });

  it("flags a Grid band with a co-located map widget but no manifest map", () => {
    const root: Node = { kind: "widget", widget: { type: "map" } };
    const pres: Presentation = {
      bands: { "14": { tree: { kind: "widget", widget: { type: "map" } } } },
    };
    const r = validateLayout([gridSpec(14, root)], pres);
    expect(r.findings).toContainEqual({ kind: "map-missing", band: 14 });
  });

  it("does NOT flag a Grid band whose co-located map survived", () => {
    const root: Node = { kind: "widget", widget: { type: "map" } };
    const pres: Presentation = {
      bands: {
        "14": {
          tree: { kind: "widget", widget: { type: "map" } },
          map: { mid: "m", layers: [], toggles: [], styles: [] },
        },
      },
    };
    const r = validateLayout([gridSpec(14, root)], pres);
    expect(r.faithful).toBe(true);
  });
});

import { formatLayoutReport } from "../../../src/blux/emit/validate-layout.js";

describe("formatLayoutReport", () => {
  it("summarizes a faithful report as one FAITHFUL line + a per-band table", () => {
    const specs = [gridSpec(0, srcRow)];
    const out = formatLayoutReport(validateLayout(specs, { bands: { "0": { tree: renRow } } }));
    expect(out).toContain("layout fidelity: FAITHFUL");
    expect(out).toContain("1 bands");
    expect(out).toContain("1 grid-tree checked");
    expect(out).toMatch(/band\s+0\s+Grid\s+ok/);
    expect(out).not.toContain("findings:");
  });

  it("lists each finding with the expected/actual signatures", () => {
    const droppedRow: RenderNode = { kind: "row", cells: [renRow.cells[0]!] };
    const out = formatLayoutReport(
      validateLayout([gridSpec(0, srcRow)], { bands: { "0": { tree: droppedRow } } }),
    );
    expect(out).toContain("1 finding(s)");
    expect(out).toContain("findings:");
    expect(out).toContain("band 0: grid tree drift");
    expect(out).toContain("row[6:h2,6:media:image]");
    expect(out).toContain("row[6:h2]");
  });
});
