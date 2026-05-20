import { describe, it, expect } from "vitest";
import lighthouseConfig, { lighthouseConfig as named } from "../../src/configs/lighthouse.js";

describe("configs/lighthouse", () => {
  it("default export equals the named export", () => {
    expect(lighthouseConfig).toBe(named);
  });

  it("has the LHCI shape we expect", () => {
    expect(lighthouseConfig.ci.collect.url).toContain("http://localhost:5173/dev/a11y-fixtures");
    expect(lighthouseConfig.ci.collect.settings?.preset).toBe("desktop");
    expect(lighthouseConfig.ci.assert.assertions["categories:accessibility"]).toEqual([
      "error",
      { minScore: 0.95 },
    ]);
    expect(lighthouseConfig.ci.upload.target).toBe("temporary-public-storage");
  });
});
