import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/index.js";
import { bandToCatalogSection, buildCatalogPlan } from "../../../src/blux/catalog/index.js";

describe("catalog plan — the-pointe Section band (golden)", () => {
  it("emits a populated blux_section document from a real band", () => {
    const html = readFileSync(
      fileURLToPath(new URL("../fixtures/the-pointe-page-content.html", import.meta.url)),
      "utf-8",
    );
    const bands = parseGridBands(html);
    expect(bands.length).toBeGreaterThan(0);
    const specs = bands.map(bandToCatalogSection);
    const plan = buildCatalogPlan([{ uid: "home", title: "The Pointe", specs }], {
      assets: [],
      diagnostics: [],
    });
    const doc = plan.documents[0];
    const slices = (
      doc.data as { slices: { slice_type: string; primary: Record<string, unknown> }[] }
    ).slices;
    // Every emitted slice is a populated blux_section (skeleton routes all → Section).
    expect(slices.every((s) => s.slice_type === "blux_section")).toBe(true);
    // At least one section carries real heading text and non-empty cells.
    expect(
      slices.some((s) => s.primary.heading && (s.primary.cells as unknown[]).length > 0),
    ).toBe(true);
    expect(plan).toMatchSnapshot();
  });
});
