import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse.js";
import { minimalSite } from "./fixtures/minimal-site.js";

describe("parseBluxSite", () => {
  it("shapes meta, pages, feeds, media, styles from site.json", () => {
    const raw = parseBluxSite(minimalSite);
    expect(raw.meta).toEqual({
      name: "Test Site",
      domain: "www.testsite.com",
      bluxSiteId: "site-1",
    });
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]!.items).toHaveLength(4);
    expect(Object.keys(raw.feeds)).toEqual(["feed-1"]);
    expect(Object.keys(raw.media)).toEqual(["img-1", "img-2"]);
    expect(raw.styles.colors).toBeDefined();
  });

  it("throws a clear error on a non-object", () => {
    expect(() => parseBluxSite(null)).toThrow(/site\.json/i);
  });
});
