import { describe, it, expect } from "vitest";
import type { Band, Node, Media } from "../../../src/blux/grid/types.js";
// Import the unit under test directly (not via ./index.js): the barrel eagerly
// re-exports ./emit.js, which does not exist until Task 3, so a barrel import
// would fail to resolve here. The emit test (Task 3) uses the barrel.
import { bandToCatalogSection } from "../../../src/blux/catalog/classify.js";

const heading = (html: string): Node => ({ kind: "heading", level: 2, html });
const body = (html: string): Node => ({ kind: "body", html });
const cell = (node: Node) => ({ token: { cols: 1, raw: "grid-1" }, node });
const row = (nodes: Node[]): Node => ({ kind: "row", cells: nodes.map(cell) });

describe("bandToCatalogSection", () => {
  it("maps a heading + a row of text cells to a BluxSection spec", () => {
    const band: Band = {
      index: 3,
      root: {
        kind: "stack",
        children: [heading("<h2>Amenities</h2>"), row([body("<p>Pool</p>"), body("<p>Gym</p>")])],
      },
    };
    const spec = bandToCatalogSection(band);
    expect(spec.slice).toBe("BluxSection");
    expect(spec.index).toBe(3);
    expect(spec.heading).toContain("Amenities");
    expect(spec.cells).toHaveLength(2);
    expect(spec.cells[0]).toMatchObject({ kind: "text", body: "<p>Pool</p>" });
  });

  it("captures a media cell's Media and carries the band background", () => {
    // Real `Media` (src/blux/grid/types.ts) requires a `kind` discriminant, so
    // the plan's `{assetId, base, ext}` literals get `kind: "image"` here.
    const media: Media = { kind: "image", assetId: "u1", base: "https://cdn/", ext: "jpg" };
    const band: Band = {
      index: 0,
      background: { kind: "image", assetId: "bg", base: "https://cdn/", ext: "jpg" },
      root: { kind: "row", cells: [cell({ kind: "media", media })] },
    };
    const spec = bandToCatalogSection(band);
    expect(spec.background?.assetId).toBe("bg");
    expect(spec.cells[0]).toMatchObject({ kind: "media" });
    expect(spec.cells[0].media?.assetId).toBe("u1");
  });
});
