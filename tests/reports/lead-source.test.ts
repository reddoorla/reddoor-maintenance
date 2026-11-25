import { describe, it, expect } from "vitest";
import { isLead, isProductionSource, isTestSender } from "../../src/reports/lead-source.js";

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

describe("isTestSender (maintenance#2296, the operator's pick (a), 11-25)", () => {
  it("is Reddoor's own domain, any local part or +tag, and its subdomains", () => {
    expect(isTestSender("staff@reddoorla.com")).toBe(true);
    expect(isTestSender("someone+hedloc-autoreply-1110@reddoorla.com")).toBe(true);
    expect(isTestSender("Info@REDDOORLA.com ")).toBe(true);
    expect(isTestSender("a@mail.reddoorla.com")).toBe(true);
  });

  it("is a reserved domain no mail reaches", () => {
    expect(isTestSender("turnstile-proof@example.com")).toBe(true);
    expect(isTestSender("x@example.org")).toBe(true);
    expect(isTestSender("x@example.net")).toBe(true);
    expect(isTestSender("x@sub.example.com")).toBe(true);
    expect(isTestSender("x@shop.test")).toBe(true);
    expect(isTestSender("x@nowhere.invalid")).toBe(true);
    expect(isTestSender("x@box.localhost")).toBe(true);
    expect(isTestSender("x@corp.example")).toBe(true);
  });

  it("is a one-letter top-level domain", () => {
    expect(isTestSender("t@c.v")).toBe(true);
  });

  it("is not a real person on a look-alike or ordinary domain", () => {
    expect(isTestSender("owner@notreddoorla.com")).toBe(false);
    expect(isTestSender("owner@reddoorla.com.au")).toBe(false);
    expect(isTestSender("owner@myexample.com")).toBe(false);
    expect(isTestSender("jane@gmail.com")).toBe(false);
    expect(isTestSender("jane@t.co")).toBe(false);
    expect(isTestSender("jane@studio.io")).toBe(false);
  });

  it("never matches on a name: 'test' in the local part alone is not a test sender", () => {
    expect(isTestSender("transtar.tests@gmail.com")).toBe(false);
  });

  it("is false for an address with no domain", () => {
    expect(isTestSender("")).toBe(false);
    expect(isTestSender("nobody")).toBe(false);
  });
});

describe("isLead", () => {
  it("needs both a production source and a real sender", () => {
    const site = "https://reddoorla.com/";
    expect(isLead({ sourceUrl: "https://reddoorla.com/c", email: "jane@gmail.com" }, site)).toBe(
      true,
    );
    expect(isLead({ sourceUrl: "https://reddoorla.com/medtech", email: "t@c.v" }, site)).toBe(
      false,
    );
    expect(
      isLead({ sourceUrl: "https://staging.reddoorla.com/c", email: "jane@gmail.com" }, site),
    ).toBe(false);
  });
});
