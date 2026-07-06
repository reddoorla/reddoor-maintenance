import { describe, it, expect } from "vitest";
import { assembleIR } from "../../src/blux/assemble.js";
import { minimalSite, minimalHtml } from "./fixtures/minimal-site.js";

describe("assembleIR", () => {
  const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
  it("assembles a complete SiteIR", () => {
    expect(ir.meta.name).toBe("Test Site");
    expect(ir.pages).toHaveLength(1);
    expect(ir.collections).toHaveLength(1);
    expect(ir.theme.colors).toHaveLength(3);
  });
  it("resolves every referenced asset to a canonical url", () => {
    const img1 = ir.assets.find((a) => a.id === "img-1")!;
    expect(img1.sourceUrl).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
    expect(ir.assets.every((a) => a.sourceUrl !== null)).toBe(true);
    expect(ir.diagnostics.filter((d) => d.kind === "unresolved-asset")).toHaveLength(0);
  });
  it("is deterministic — same input yields deep-equal output", () => {
    const again = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    expect(again).toEqual(ir);
  });
});
