import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands, gridSignature } from "../../src/blux/grid/index.js";

const fixture = fileURLToPath(
  new URL("./fixtures/the-pointe-page-content.html", import.meta.url),
);
const hasFixture = existsSync(fixture);

it("keeps the golden fixture committed (the fidelity gate must not silently disable)", () => {
  expect(hasFixture).toBe(true);
});

describe.skipIf(!hasFixture)("grid parser — the-pointe golden", () => {
  const bands = parseGridBands(readFileSync(fixture, "utf-8"));

  it("parses the top-level bands with contiguous indices", () => {
    expect(bands.length).toBe(16);
    expect(bands.map((b) => b.index)).toEqual(
      bands.map((_, i) => i),
    );
  });

  it("finds the hero band background and real grid rows", () => {
    expect(bands[0]?.background?.kind).toBe("image");
    const rows = bands.filter((b) => b.root.kind === "row");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("has a stable structural signature", () => {
    expect(gridSignature(bands)).toMatchSnapshot();
  });
});
