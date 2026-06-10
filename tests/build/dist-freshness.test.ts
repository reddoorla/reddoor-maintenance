import { describe, it, expect } from "vitest";
import { distIsStale } from "../../vitest.global-setup.js";

describe("distIsStale", () => {
  it("is stale when the dist bin is missing (never built)", () => {
    expect(distIsStale(null, [100, 200, 300])).toBe(true);
  });

  it("is fresh when every source is older than the dist bin", () => {
    expect(distIsStale(1000, [500, 800, 999])).toBe(false);
  });

  it("is stale when any source is newer than the dist bin", () => {
    expect(distIsStale(1000, [500, 1500, 800])).toBe(true);
  });

  it("treats a source whose mtime equals the dist bin's as fresh (build runs last → strictly newer)", () => {
    expect(distIsStale(1000, [1000])).toBe(false);
  });

  it("is fresh in the degenerate no-sources case (nothing to be stale against)", () => {
    expect(distIsStale(1000, [])).toBe(false);
  });
});
