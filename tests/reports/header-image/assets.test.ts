import { describe, it, expect } from "vitest";
import {
  loadPlate,
  loadHeadline,
  headlineKindFor,
} from "../../../src/reports/header-image/assets/index.js";
import sharp from "sharp";

describe("reports/header-image assets", () => {
  it("loads a 2400x3200 plate", async () => {
    const bytes = await loadPlate();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(3200);
  });

  it.each([
    ["Maintenance" as const, 1328, 660],
    ["Testing" as const, 1715, 664],
    ["Announcement" as const, 1199, 664],
    ["Launch" as const, 1129, 386],
  ])("loads the %s headline as genuinely transparent ink-box art", async (kind, w, h) => {
    const bytes = await loadHeadline(kind);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
    expect(meta.channels).toBe(4);
    // A Figma MCP export is always flattened onto its backdrop — white inside a
    // frame, canvas grey on the bare canvas — and stamping that paints a solid
    // slab over the paper texture, which is what made the 2026-08-20 Testing
    // asset unusable. Pin the failure mode for every registered headline.
    const alpha = (await sharp(Buffer.from(bytes)).stats()).channels[3];
    expect(alpha?.min).toBe(0);
    expect(alpha?.max).toBe(255);
  });

  it("maps every report type that has an overlay; unknown types ship clean", () => {
    expect(headlineKindFor("Maintenance")).toBe("Maintenance");
    expect(headlineKindFor("Testing")).toBe("Testing");
    expect(headlineKindFor("Announcement")).toBe("Announcement");
    expect(headlineKindFor("Launch")).toBe("Launch");
    expect(headlineKindFor("Nonsense")).toBeNull();
  });
});
