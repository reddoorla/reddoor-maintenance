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

describe("assembleIR favicon", () => {
  // The real export shape: settings.favicon names a bare media uuid that is
  // routinely ABSENT from the media dict — only the <link rel="icon"> tags in
  // the rendered HTML (with a transform segment) carry its CDN url.
  const withFavicon = {
    ...minimalSite,
    settings: { ...minimalSite.settings, favicon: { media: "img-fav" } },
  };
  const faviconHtml = `<html><head><link rel="icon" href="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-fav.png"></head><body></body></html>`;

  it("resolves meta.favicon from the scraped <link> urls, not the media dict", () => {
    const ir = assembleIR({ siteJson: withFavicon, htmls: [minimalHtml, faviconHtml] });
    expect(ir.meta.favicon).toEqual({
      assetId: "img-fav",
      sourceUrl: "https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-fav.png",
    });
    // the favicon must NOT leak into the plan-bound assets list
    expect(ir.assets.some((a) => a.id === "img-fav")).toBe(false);
  });

  it("keeps the assetId with a null sourceUrl + diagnostic when unscraped", () => {
    const ir = assembleIR({ siteJson: withFavicon, htmls: [minimalHtml] });
    expect(ir.meta.favicon).toEqual({ assetId: "img-fav", sourceUrl: null });
    expect(ir.diagnostics.some((d) => d.kind === "unresolved-asset" && d.where === "img-fav")).toBe(
      true,
    );
  });

  it("omits the meta.favicon key entirely when settings declares none", () => {
    const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    expect("favicon" in ir.meta).toBe(false);
  });
});
