import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/index.js";
import { bandToCatalog, buildCatalogPlan } from "../../../src/blux/catalog/index.js";

const CATALOG_SLICE_TYPES = [
  "blux_section",
  "blux_grid",
  "blux_gallery",
  "blux_carousel",
  "blux_media",
  "blux_media_text",
  "blux_block",
];

describe("catalog plan — the-pointe (golden)", () => {
  it("emits a populated, breadth-routed plan from the real page", () => {
    const html = readFileSync(
      fileURLToPath(new URL("../fixtures/the-pointe-page-content.html", import.meta.url)),
      "utf-8",
    );
    const bands = parseGridBands(html);
    expect(bands.length).toBeGreaterThan(0);
    const specs = bands.map(bandToCatalog);
    const plan = buildCatalogPlan([{ uid: "home", title: "The Pointe", specs }], {
      assets: [],
      diagnostics: [],
    });
    const doc = plan.documents[0]!;
    const slices = (
      doc.data as { slices: { slice_type: string; primary: Record<string, unknown> }[] }
    ).slices;
    // Every emitted slice is one of the 7 catalog slices, and the breadth
    // router actually varies the routing (the skeleton emitted only sections).
    expect(slices.every((s) => CATALOG_SLICE_TYPES.includes(s.slice_type))).toBe(true);
    expect(new Set(slices.map((s) => s.slice_type)).size).toBeGreaterThanOrEqual(2);
    // At least one section carries real heading text and non-empty cells.
    expect(
      slices.some(
        (s) =>
          s.slice_type === "blux_section" &&
          s.primary.heading &&
          (s.primary.cells as unknown[]).length > 0,
      ),
    ).toBe(true);
    expect(plan).toMatchSnapshot();
  });
});
