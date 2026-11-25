import { describe, it, expect } from "vitest";
import { isProductionSource } from "../../src/reports/lead-source.js";

const SITE = "https://reddoorla.com/";

describe("isProductionSource (maintenance#2296)", () => {
  it("counts the apex and www pages of the site", () => {
    expect(isProductionSource("https://reddoorla.com/contact", SITE)).toBe(true);
    expect(isProductionSource("https://www.reddoorla.com/contact", SITE)).toBe(true);
  });

  it("counts the apex when the site's url is stored on www", () => {
    const site = "https://www.williamson-construction.com/";
    expect(isProductionSource("https://williamson-construction.com/join", site)).toBe(true);
    expect(isProductionSource("https://www.williamson-construction.com/join", site)).toBe(true);
  });

  it("does not count a staging subdomain (exact host, never a suffix match)", () => {
    expect(isProductionSource("https://staging.reddoorla.com/medtech", SITE)).toBe(false);
    expect(isProductionSource("https://www.staging.reddoorla.com/medtech", SITE)).toBe(false);
  });

  it("does not count a look-alike host that merely ends in the domain", () => {
    expect(isProductionSource("https://notreddoorla.com/contact", SITE)).toBe(false);
  });

  it("does not count a netlify.app host or a deploy preview", () => {
    expect(isProductionSource("https://reddoor.netlify.app/contact", SITE)).toBe(false);
    expect(
      isProductionSource(
        "https://deploy-preview-4--hedloc.netlify.app/contact",
        "https://hedloc.netlify.app/",
      ),
    ).toBe(false);
  });

  it("counts a site whose production host is its netlify.app host", () => {
    expect(
      isProductionSource("https://hedloc.netlify.app/contact", "https://hedloc.netlify.app/"),
    ).toBe(true);
  });

  it("does not count localhost", () => {
    expect(isProductionSource("http://localhost:4173/contact", SITE)).toBe(false);
    expect(isProductionSource("http://127.0.0.1:4173/contact", SITE)).toBe(false);
  });

  it("does not count a missing or unparseable source_url", () => {
    expect(isProductionSource(null, SITE)).toBe(false);
    expect(isProductionSource("", SITE)).toBe(false);
    expect(isProductionSource("reddoorla.com/contact", SITE)).toBe(false);
  });

  it("counts nothing for a site with no usable url", () => {
    expect(isProductionSource("https://reddoorla.com/contact", "")).toBe(false);
    expect(isProductionSource("https://reddoorla.com/contact", "not a url")).toBe(false);
  });

  it("ignores case and port in the source host", () => {
    expect(isProductionSource("https://WWW.Reddoorla.com:443/contact", SITE)).toBe(true);
  });
});
