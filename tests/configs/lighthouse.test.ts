import { describe, it, expect } from "vitest";
import lighthouseConfig, { lighthouseConfig as named } from "../../src/configs/lighthouse.js";

describe("configs/lighthouse", () => {
  it("default export equals the named export", () => {
    expect(lighthouseConfig).toBe(named);
  });

  it("binds vite to the same port the collected URL names", () => {
    // `startServerReadyPattern` matches vite's "ready in" line whatever port it
    // chose, so an unbound vite that drifts off 5173 still reads as ready and
    // lighthouse then audits whatever IS on 5173. Asserted as a relationship
    // between the two fields rather than a literal, so changing one alone
    // cannot reopen the gap.
    const collected = new URL(lighthouseConfig.ci.collect.url[0]).port;
    expect(lighthouseConfig.ci.collect.startServerCommand).toContain(`--port ${collected}`);
    expect(lighthouseConfig.ci.collect.startServerCommand).toContain("--strictPort");
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
