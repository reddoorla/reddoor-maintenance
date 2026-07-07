import { describe, it, expect } from "vitest";
import { assembleIR } from "../../../src/blux/assemble.js";
import { buildReviewManifest } from "../../../src/blux/emit/review.js";
import { minimalSite, minimalHtml } from "../fixtures/minimal-site.js";

describe("buildReviewManifest", () => {
  const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
  it("pairs each page with a converted url + the Blux original", () => {
    const m = buildReviewManifest(ir, {
      convertedBase: "http://localhost:5173",
      bluxBase: "https://www.testsite.com",
    });
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]).toEqual({
      uid: "home",
      converted: "http://localhost:5173/home",
      original: "https://www.testsite.com/",
    });
  });
  it("surfaces diagnostics for the sign-off", () => {
    const m = buildReviewManifest(ir, { convertedBase: "x", bluxBase: "y" });
    expect(Array.isArray(m.diagnostics)).toBe(true);
  });
  it("omits empty pages — they emit no document, so there is nothing to review", () => {
    const withStub = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    withStub.pages.push({ uid: "stub", title: "", description: "", sections: [] });
    const m = buildReviewManifest(withStub, { convertedBase: "x", bluxBase: "y" });
    expect(m.pairs.find((p) => p.uid === "stub")).toBeUndefined();
  });
});
