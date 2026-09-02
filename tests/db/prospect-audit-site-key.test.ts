import { describe, expect, it } from "vitest";
import { siteKey } from "../../src/db/prospect-audits.js";

/**
 * One site, one lineage.
 *
 * The audited URL is stored exactly as it was given, because it is a fact about
 * the run. But it is the wrong thing to group by: the corpus already contains
 * `beachfrontdentistry.com` and `beachfrontdentistry.com/` as two separate
 * histories, and `ludlowkingsley.com` twice for the same reason. Nothing has
 * broken yet only because nothing compares two audits of one site — the moment
 * the report offers a before and an after, a trailing slash silently becomes a
 * client with no history.
 */
describe("siteKey", () => {
  it("gives one key to the ways of writing the same site", () => {
    const expected = "beachfrontdentistry.com";
    for (const written of [
      "https://beachfrontdentistry.com",
      "https://beachfrontdentistry.com/",
      "http://beachfrontdentistry.com/",
      "https://www.beachfrontdentistry.com/",
      "https://BeachfrontDentistry.com//",
      "beachfrontdentistry.com",
    ]) {
      expect(siteKey(written), written).toBe(expected);
    }
  });

  it("keeps a path, because a site in a subdirectory is a different site", () => {
    expect(siteKey("https://example.com/clients/acme")).toBe("example.com/clients/acme");
    expect(siteKey("https://example.com/clients/acme/")).toBe("example.com/clients/acme");
  });

  it("keeps different hosts apart, including subdomains", () => {
    expect(siteKey("https://shop.example.com")).not.toBe(siteKey("https://example.com"));
    // "www" is the one subdomain that is conventionally the same site.
    expect(siteKey("https://www.example.com")).toBe(siteKey("https://example.com"));
  });

  it("drops a query string and a fragment, which never identify a site", () => {
    expect(siteKey("https://example.com/?utm_source=x#top")).toBe("example.com");
  });

  it("falls back to the trimmed input when the URL will not parse", () => {
    // Never throws: a key we cannot compute must not take the audit down with
    // it. A bad key groups nothing, which is the same as today's behaviour.
    expect(siteKey("not a url")).toBe("not a url");
    expect(siteKey("  ")).toBe("");
  });
});
