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
  ])("loads the %s headline as genuinely transparent ink-box art", async (kind, w, h) => {
    const bytes = await loadHeadline(kind);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(h);
    expect(meta.channels).toBe(4);
    // A Figma MCP export arrives flattened onto opaque white (alpha everywhere
    // 255) — stamping that paints a white slab over the paper texture, which is
    // exactly what made the 2026-08-20 Testing asset unusable. Pin the failure
    // mode so a future re-export can't reintroduce it for any headline.
    const alpha = (await sharp(Buffer.from(bytes)).stats()).channels[3];
    expect(alpha?.min).toBe(0);
  });

  it("maps only report types with a registered overlay; the rest ship clean", () => {
    expect(headlineKindFor("Maintenance")).toBe("Maintenance");
    expect(headlineKindFor("Testing")).toBe("Testing");
    // Awaiting their copy being typed in Figma — see HEADLINE_FILES.
    expect(headlineKindFor("Announcement")).toBeNull();
    expect(headlineKindFor("Launch")).toBeNull();
  });
});
