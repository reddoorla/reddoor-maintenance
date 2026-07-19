import { describe, it, expect } from "vitest";
import type { Band, Node, Media } from "../../../src/blux/grid/types.js";
// Direct module import, mirroring the skeleton's classify.test.ts pattern.
import { bandToCatalog } from "../../../src/blux/catalog/classify.js";

const img = (id: string): Media => ({ kind: "image", assetId: id });
const heading = (html: string): Node => ({ kind: "heading", level: 3, html });
const body = (html: string): Node => ({ kind: "body", html });
const media = (m: Media): Node => ({ kind: "media", media: m });
const cell = (node: Node) => ({ token: { cols: 1, raw: "grid-1" }, node });
const row = (nodes: Node[]): Node => ({ kind: "row", cells: nodes.map(cell) });
const stack = (children: Node[]): Node => ({ kind: "stack", children });

describe("bandToCatalog (breadth)", () => {
  it("routes a 2-cell media+text row to BluxMediaText carrying media + title + body", () => {
    const band: Band = {
      index: 1,
      root: row([
        media(img("m1")),
        stack([heading("<h3>Villa</h3>"), body("<p>desc</p>")]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxMediaText");
    if (spec.slice !== "BluxMediaText") return;
    expect(spec.media.assetId).toBe("m1");
    expect(spec.mediaSide).toBe("left");
    expect(spec.title).toContain("Villa");
    expect(spec.body).toContain("desc");
    expect(spec.index).toBe(1);
  });

  it("routes a pure-media row to BluxGallery with one media cell per image", () => {
    const band: Band = {
      index: 2,
      root: row([media(img("g1")), media(img("g2")), media(img("g3"))]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGallery");
    if (spec.slice !== "BluxGallery") return;
    expect(spec.cells).toHaveLength(3);
    expect(spec.cells.every((c) => c.kind === "media")).toBe(true);
    expect(spec.cells.map((c) => c.media?.assetId)).toEqual(["g1", "g2", "g3"]);
  });

  it("routes a single-media band to BluxMedia", () => {
    const band: Band = { index: 3, root: media(img("solo")) };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxMedia");
    if (spec.slice !== "BluxMedia") return;
    expect(spec.media.assetId).toBe("solo");
  });

  it("routes a heading-only band to BluxSection without duplicating the heading as a cell", () => {
    const band: Band = { index: 4, root: heading("<h2>About Us</h2>") };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxSection");
    if (spec.slice !== "BluxSection") return;
    expect(spec.heading).toContain("About Us");
    expect(spec.cells).toHaveLength(0);
  });

  it("routes a shallow Grid band to BluxGrid, splitting the section heading out", () => {
    const band: Band = {
      index: 6,
      root: stack([
        heading("<h2>Features</h2>"),
        row([
          stack([heading("<h4>a</h4>"), body("<p>x</p>")]),
          stack([heading("<h4>b</h4>"), body("<p>y</p>")]),
          media(img("f1")),
        ]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(spec.heading).toContain("Features");
    expect(spec.cells.length).toBeGreaterThan(0);
    expect(JSON.stringify(spec.cells)).toContain("f1");
  });

  it("routes a band nesting rows past cell→subgrid depth to BluxBlock, preserving buried media", () => {
    // Three row levels (row → subgrid cell → another row) — past what the
    // Prismic cell→subgrid model can render, so content survives via the
    // serialized fallback.
    const band: Band = {
      index: 5,
      root: row([stack([row([row([media(img("d1")), media(img("d2"))])])])]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxBlock");
    if (spec.slice !== "BluxBlock") return;
    const flat = JSON.stringify(spec.payload);
    expect(flat).toContain("d1");
    expect(flat).toContain("d2");
  });
});
