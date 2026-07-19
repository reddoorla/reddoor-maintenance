import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGridBands, collectMedia } from "../../../src/blux/grid/index.js";
import { bandToCatalog } from "../../../src/blux/catalog/index.js";
import type { CatalogCell, CatalogSpec } from "../../../src/blux/catalog/index.js";

/** Media captured by a catalog spec: leaf media, cell media (recursive through
 * subgrid), or — for the BluxBlock fallback — image entries in the serialized
 * payload. The golden pins the capture RATE: the skeleton managed 7/52; the
 * breadth classifier must not silently regress below 90%. */
function specMediaCount(spec: CatalogSpec): number {
  if (spec.slice === "BluxBlock")
    return JSON.stringify(spec.payload).split('"image"').length - 1;
  if (spec.slice === "BluxMedia" || spec.slice === "BluxMediaText") return 1;
  const walk = (cs: CatalogCell[]): number =>
    cs.reduce(
      (n, c) => n + (c.media ? 1 : 0) + (c.subgrid ? walk(c.subgrid) : 0),
      0,
    );
  return walk(spec.cells);
}

describe("catalog breadth classify — the-pointe (golden)", () => {
  it("routes every band and captures the vast majority of source media", () => {
    const html = readFileSync(
      join(__dirname, "../fixtures/the-pointe-page-content.html"),
      "utf-8",
    );
    const bands = parseGridBands(html);
    const sourceMedia = bands.reduce(
      (n, b) => n + collectMedia(b.root).length,
      0,
    );
    const specs = bands.map(bandToCatalog);
    const captured = specs.reduce((n, s) => n + specMediaCount(s), 0);
    // Skeleton captured 7/52; breadth must capture the vast majority.
    expect(captured).toBeGreaterThanOrEqual(Math.floor(sourceMedia * 0.9));
    const lines = specs.map((s, i) => `${i} ${s.slice} media=${specMediaCount(s)}`);
    expect({ sourceMedia, captured, lines }).toMatchSnapshot();
  });
});
