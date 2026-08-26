import { describe, it, expect } from "vitest";
import { checkConsistency, normalizePhone } from "../../src/prospect/consistency.js";
import type { PageAnchor, PageCapture, PageExtract } from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: null,
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    anchors: [],
    anchorCount: 0,
    imageSrcs: [],
    forms: [],
    ...over,
  };
}

function page(url: string, over: Partial<PageExtract> = {}): PageCapture {
  return { url, status: 200, raw: extract(over), rendered: extract(over), error: null };
}

const link = (href: string): PageAnchor => ({ href, text: href, rel: "" });

describe("normalizePhone", () => {
  it("makes formatting differences compare equal", () => {
    expect(normalizePhone("(310) 341-3571")).toBe("3103413571");
    expect(normalizePhone("+1 310 341 3571")).toBe("3103413571");
    expect(normalizePhone("310.341.3571")).toBe("3103413571");
  });

  // The loose text pattern matches years, prices and street numbers. Reporting
  // those as phone numbers would manufacture an inconsistency out of nothing.
  it("rejects anything too short to be a phone number", () => {
    expect(normalizePhone("2026")).toBeNull();
    expect(normalizePhone("123 456")).toBeNull();
  });

  it("rejects anything absurdly long", () => {
    expect(normalizePhone("1234567890123456789")).toBeNull();
  });
});

describe("checkConsistency", () => {
  it("treats one number written three ways as one number", () => {
    const result = checkConsistency([
      page("https://x.example/", { anchors: [link("tel:+13103413571")] }),
      page("https://x.example/about", { text: "Call us at (310) 341-3571 today." }),
      page("https://x.example/contact", { text: "310.341.3571" }),
    ]);
    expect(result.phones).toHaveLength(1);
    expect(result.phones[0]?.normalized).toBe("3103413571");
    // The receipts: every spelling seen, so a reader can check the claim.
    expect(result.phones[0]?.seenAs.length).toBeGreaterThan(1);
    expect(result.phones[0]?.pages).toHaveLength(3);
  });

  it("reports genuinely different numbers separately", () => {
    const result = checkConsistency([
      page("https://x.example/", { anchors: [link("tel:+13103413571")] }),
      page("https://x.example/contact", { anchors: [link("tel:+13105550100")] }),
    ]);
    expect(result.phones).toHaveLength(2);
  });

  it("folds email case but keeps distinct addresses apart", () => {
    const result = checkConsistency([
      page("https://x.example/", { anchors: [link("mailto:Info@X.example")] }),
      page("https://x.example/a", { anchors: [link("mailto:info@x.example")] }),
      page("https://x.example/b", { anchors: [link("mailto:sales@x.example")] }),
    ]);
    expect(result.emails).toHaveLength(2);
  });

  it("finds copyright years and reports the newest", () => {
    const result = checkConsistency([
      page("https://x.example/", { text: "© 2019 Acme" }),
      page("https://x.example/a", { text: "Copyright 2021 Acme" }),
      page("https://x.example/b", { text: "© 2015–2019 Acme" }),
    ]);
    expect(result.copyrightYears).toEqual([2019, 2021]);
    expect(result.newestCopyrightYear).toBe(2021);
  });

  it("ignores a four-digit number that is not a plausible year", () => {
    const result = checkConsistency([page("https://x.example/", { text: "© 1200 Acme" })]);
    expect(result.copyrightYears).toEqual([]);
    expect(result.newestCopyrightYear).toBeNull();
  });

  // The bug this replaced: an INTERSECTION of every page is vacuous, because a
  // page missing the nav deletes those links from it — so no page can ever be
  // found missing it. The one page the check exists to find is the one that
  // would have destroyed the evidence. A majority threshold instead.
  it("finds the page built outside the site template", () => {
    const nav = [link("/"), link("/about"), link("/contact")];
    const result = checkConsistency([
      page("https://x.example/", { anchors: nav }),
      page("https://x.example/about", { anchors: nav }),
      page("https://x.example/contact", { anchors: nav }),
      page("https://x.example/lp/promo", { anchors: [link("https://elsewhere.example/")] }),
    ]);
    expect(result.pagesOffTemplate).toEqual(["https://x.example/lp/promo"]);
    expect(result.sharedNavLinks).toBeGreaterThan(0);
  });

  it("does not accuse a page of being off-template when there are too few pages to tell", () => {
    const result = checkConsistency([
      page("https://x.example/", { anchors: [link("/about")] }),
      page("https://x.example/other", { anchors: [link("https://elsewhere.example/")] }),
    ]);
    expect(result.pagesOffTemplate).toEqual([]);
  });

  it("excludes pages that produced no extract", () => {
    const result = checkConsistency([
      page("https://x.example/", { anchors: [link("tel:+13103413571")] }),
      { url: "https://x.example/dead", status: null, raw: null, rendered: null, error: "x" },
    ]);
    expect(result.pagesExamined).toBe(1);
  });

  it("returns an empty, non-crashing shape for a site with none of this", () => {
    const result = checkConsistency([page("https://x.example/")]);
    expect(result.phones).toEqual([]);
    expect(result.emails).toEqual([]);
    expect(result.newestCopyrightYear).toBeNull();
    expect(result.pagesOffTemplate).toEqual([]);
  });
});
