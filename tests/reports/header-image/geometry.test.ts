import { describe, it, expect } from "vitest";
import { CANVAS, SCREEN, DOMAIN } from "../../../src/reports/header-image/geometry.js";

describe("reports/header-image geometry", () => {
  it("matches the hand-made headers' canvas", () => {
    expect(CANVAS).toEqual({ width: 2400, height: 3200 });
  });

  it("has a 16:10 screen rect, matching the MacBook mockup", () => {
    expect(SCREEN).toEqual({ x: 302, y: 1913, w: 1349, h: 844 });
    expect(SCREEN.w / SCREEN.h).toBeCloseTo(1.6, 2);
  });

  it("keeps the screen inside the canvas", () => {
    expect(SCREEN.x + SCREEN.w).toBeLessThanOrEqual(CANVAS.width);
    expect(SCREEN.y + SCREEN.h).toBeLessThanOrEqual(CANVAS.height);
  });

  it("places the domain text on the shared 70-design-unit left margin", () => {
    expect(DOMAIN.x).toBe(282);
    expect(DOMAIN.baseline).toBe(3037);
    expect(DOMAIN.color).toBe("#747474");
  });
});
