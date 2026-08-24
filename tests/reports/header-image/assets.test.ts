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

  it("loads the maintenance headline as genuinely transparent ink-box art", async () => {
    const bytes = await loadHeadline("Maintenance");
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(1328);
    expect(meta.height).toBe(660);
    expect(meta.channels).toBe(4);
    // The Testing export of 2026-08-20 shipped flattened onto an opaque red
    // rectangle (alpha everywhere 255) — this pins the failure mode so a
    // future re-export can't reintroduce it for any registered headline.
    const alpha = (await sharp(Buffer.from(bytes)).stats()).channels[3];
    expect(alpha?.min).toBe(0);
  });

  it("maps only report types with a registered overlay; the rest ship clean", () => {
    expect(headlineKindFor("Maintenance")).toBe("Maintenance");
    expect(headlineKindFor("Testing")).toBeNull();
    expect(headlineKindFor("Announcement")).toBeNull();
    expect(headlineKindFor("Launch")).toBeNull();
  });
});
