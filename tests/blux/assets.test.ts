import { describe, it, expect } from "vitest";
import { normalizeCdnUrl, collectAssetUrls } from "../../src/blux/assets.js";
import { minimalHtml } from "./fixtures/minimal-site.js";

describe("normalizeCdnUrl", () => {
  it("strips transform segments to the canonical original", () => {
    expect(
      normalizeCdnUrl("https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg"),
    ).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
  });
  it("passes through an already-canonical url", () => {
    expect(normalizeCdnUrl("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png")).toBe(
      "https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png",
    );
  });
  it("returns null for a non-cdn url", () => {
    expect(normalizeCdnUrl("https://example.com/x.jpg")).toBeNull();
  });
});

describe("collectAssetUrls", () => {
  it("builds a uuid → canonical-url map from rendered HTML", () => {
    const map = collectAssetUrls([minimalHtml]);
    expect(map.get("img-1")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
    expect(map.get("img-2")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png");
  });
});
