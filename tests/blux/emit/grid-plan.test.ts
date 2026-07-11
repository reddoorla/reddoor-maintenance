import { describe, it, expect } from "vitest";
import { buildGridPlan } from "../../../src/blux/emit/grid-plan.js";
import type { SliceSpec, Media } from "../../../src/blux/grid/index.js";
import type { SiteIR } from "../../../src/blux/ir.js";

const img = (id: string): Media => ({ kind: "image", assetId: id, ext: "png", base: "https://cdn/f/" });
const ir = {
  meta: {}, theme: {} as never, collections: [],
  assets: [{ id: "a", sourceUrl: "https://cdn/f/a.png", name: "a.png", mime: "image/png", alt: "Alt A" }],
  diagnostics: [],
  pages: [{ uid: "the-pointe", title: "The Pointe", description: "", sections: [] }],
} as unknown as SiteIR;

const specs: SliceSpec[] = [
  { index: 0, slice: "Hero", heading: "Hi", background: img("a") },
  { index: 1, slice: "Gallery", media: [img("a"), img("b")] },   // "a" dedups
  { index: 2, slice: "Grid", root: { kind: "row", cells: [{ token: { cols: 1, raw: "grid-1" }, node: { kind: "media", media: img("c") } }] } },
];

describe("buildGridPlan", () => {
  it("builds a page document with a heading1 title and one slice per band", () => {
    const plan = buildGridPlan(specs, ir);
    expect(plan.documents).toHaveLength(1);
    const doc = plan.documents[0]!;
    expect(doc.type).toBe("page");
    expect(doc.uid).toBe("the-pointe");
    expect(doc.data.title).toEqual({ __richtext_html: "<h1>The Pointe</h1>" });
    const slices = doc.data.slices as { slice_type: string; primary: { band: number } }[];
    expect(slices.map((s) => s.slice_type)).toEqual(["hero", "gallery", "grid_band"]);
    expect(slices.map((s) => s.primary.band)).toEqual([0, 1, 2]);
  });

  it("collects every referenced asset (deduped) with CDN url + alt for upload", () => {
    const plan = buildGridPlan(specs, ir);
    expect(plan.assets).toEqual([
      { id: "a", url: "https://cdn/f/a.png", alt: "Alt A" },
      { id: "b", url: "https://cdn/f/b.png", alt: "" },
      { id: "c", url: "https://cdn/f/c.png", alt: "" },
    ]);
    expect(Array.isArray(plan.customTypes)).toBe(true);
  });
});
