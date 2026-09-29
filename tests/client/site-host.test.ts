import { describe, it, expect } from "vitest";
import { siteHostnames, isSiteHost } from "../../src/client/site-host.js";
import { measuredHostnames } from "../../src/reports/ga/client.js";

describe("siteHostnames", () => {
  it("returns the apex and its www twin, whichever form it is given", () => {
    expect(siteHostnames("reddoorla.com")).toEqual(["reddoorla.com", "www.reddoorla.com"]);
    expect(siteHostnames("www.beachfrontdentistry.com")).toEqual([
      "beachfrontdentistry.com",
      "www.beachfrontdentistry.com",
    ]);
  });

  it("lowercases and trims, so a config typo in case cannot silence the tag", () => {
    expect(siteHostnames("  WWW.ReddoorLA.com ")).toEqual(["reddoorla.com", "www.reddoorla.com"]);
  });

  it("treats a subdomain as its own host, so staging is never the production apex", () => {
    expect(siteHostnames("staging.reddoorla.com")).toEqual([
      "staging.reddoorla.com",
      "www.staging.reddoorla.com",
    ]);
  });

  it("returns nothing for a value with no apex/www twin", () => {
    // "" and "localhost" have no dot. "www." reduces to an EMPTY apex, which
    // would otherwise produce a filter value matching nothing — a silent zero
    // dressed up as a measurement.
    for (const bad of ["", "localhost", "www.", "   "]) {
      expect(siteHostnames(bad)).toEqual([]);
    }
  });

  it("keeps a dotless apex, which `measuredHostnames` always returned", () => {
    // Widening the empty-apex guard to "no dot" silently narrowed
    // `measuredHostnames`, and `reports/draft.ts` reads the property UNFILTERED
    // on an empty list — so such a site's monthly report would have flipped to
    // counting every environment, which is 13,417 against 105 on reddoor's own.
    expect(siteHostnames("www.intranet")).toEqual(["intranet", "www.intranet"]);
  });
});

describe("isSiteHost", () => {
  it("accepts the production host and its twin, in either direction", () => {
    expect(isSiteHost("beachfrontdentistry.com", "www.beachfrontdentistry.com")).toBe(true);
    expect(isSiteHost("www.beachfrontdentistry.com", "beachfrontdentistry.com")).toBe(true);
  });

  it("rejects every host a deploy actually runs on that is not the site", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "beachfront-dentistry.netlify.app",
      "deploy-preview-12--beachfront-dentistry.netlify.app",
      "staging.beachfrontdentistry.com",
      "beachfrontdentistry.com.evil.test",
    ]) {
      expect(isSiteHost(host, "www.beachfrontdentistry.com")).toBe(false);
    }
  });

  it("stays OFF when the production host is unusable, rather than defaulting on", () => {
    // Failing open here pollutes a client's property with preview traffic, and
    // GA4 has no way to delete it after the fact.
    for (const bad of ["", "localhost", "   "]) {
      expect(isSiteHost("www.beachfrontdentistry.com", bad)).toBe(false);
    }
  });
});

describe("the emit gate and the report's read filter agree", () => {
  // The whole reason siteHostnames is shared. If these two ever drift, a site
  // emits on a host the Data API query filters out: the property fills up and
  // every monthly report reads zero, which looks like "no traffic" and not
  // like a bug. Asserted for real fleet URLs in both apex and www forms.
  const siteUrls = [
    "https://www.beachfrontdentistry.com/",
    "https://reddoorla.com/",
    "https://espadarealestate.com/",
    "https://www.erpfunds.com/",
    "https://29navy.com",
  ];

  for (const url of siteUrls) {
    it(`${url} emits only on hosts the report counts`, () => {
      const counted = measuredHostnames(url);
      expect(counted.length).toBeGreaterThan(0);
      const productionHost = new URL(url).hostname;
      for (const host of counted) {
        expect(isSiteHost(host, productionHost)).toBe(true);
      }
      // And the converse: every host the tag would fire on is counted.
      for (const host of siteHostnames(productionHost)) {
        expect(counted).toContain(host);
      }
    });
  }
});
