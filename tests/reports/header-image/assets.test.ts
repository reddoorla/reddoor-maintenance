import { describe, it, expect } from "vitest";
import { loadPlate } from "../../../src/reports/header-image/assets/index.js";
import sharp from "sharp";

describe("reports/header-image assets", () => {
  it("loads a 2400x3200 plate", async () => {
    const bytes = await loadPlate();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(3200);
  });
});
