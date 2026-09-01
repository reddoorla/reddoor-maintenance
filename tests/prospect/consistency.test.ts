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

  // The exact text from seaviewdental.example, which broke the first
  // version. A greedy digit run swallowed the suite number and reported one
  // number as two — 3103789241 AND 31037892411706 — which is the invented
  // inconsistency this whole module is supposed to avoid. Found by running it
  // against a live site, not in review.
  it("does not swallow the number sitting next to a phone number", () => {
    const result = checkConsistency([
      page("https://x.example/", {
        anchors: [link("tel:+13103789241")],
        text: "Call (310) 378-9241 1706 South Catalina Avenue, Redondo Beach",
      }),
    ]);
    expect(result.phones).toHaveLength(1);
    expect(result.phones[0]?.normalized).toBe("3103789241");
  });

  it("does not pick a phone number out of a longer digit run", () => {
    const result = checkConsistency([
      page("https://x.example/", { text: "Order 993103789241557 shipped" }),
    ]);
    expect(result.phones).toEqual([]);
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

describe("phones and emails are an inventory, not an accusation", () => {
  // Replaying the old rule over the stored corpus failed 8 of 22 hosts, and
  // every hit was legitimate: our own site's labelled California and Texas
  // office lines, a nonprofit listing 13 partner helplines, a company's fax
  // number, a firm's "general" and "business inquiries" lines. The count was
  // right; the claim built on it — "a business that disagrees with itself" —
  // was not, and the reader could refute it from the contact page in one click.
  it("records two labelled office numbers without any of them being a conflict", () => {
    const pages = [
      page("https://example.com/contact", {
        text: "California Office +1 310-341-3571 Texas Office +1 310-418-9976",
      }),
    ];

    const result = checkConsistency(pages);

    expect(result.phones).toHaveLength(2);
    // Nothing in the result asserts a disagreement — the shape carries no
    // conflict field for a renderer to reach for.
    expect(result).not.toHaveProperty("phoneConflict");
    expect(result).not.toHaveProperty("hasInconsistentPhones");
  });

  it("still records whether a number is tappable, which is the actionable part", () => {
    const pages = [
      page("https://example.com/", {
        text: "Call 310-341-3571",
        anchors: [{ href: "tel:+13104189976", text: "Call us", rel: "" }],
      }),
    ];

    const result = checkConsistency(pages);

    const prose = result.phones.find((p) => p.normalized === "3103413571");
    const linked = result.phones.find((p) => p.normalized === "3104189976");
    expect(prose?.linked).toBe(false);
    expect(linked?.linked).toBe(true);
  });
});

describe("checkConsistency: pages the server never served", () => {
  it("does not judge a 404 interstitial as a page built outside the template", () => {
    const real = (url: string) =>
      page(url, { anchors: [{ href: "/about", text: "About", rel: "" }] });
    const pages = [
      real("https://example.com/"),
      real("https://example.com/about"),
      real("https://example.com/services"),
      {
        url: "https://example.com/cdn-cgi/l/email-protection",
        status: 404,
        raw: null,
        rendered: {
          ...page("https://example.com/x").rendered!,
          anchors: [],
        },
        error: "HTTP 404",
      },
    ];

    const result = checkConsistency(pages);

    expect(result.pagesOffTemplate).toEqual([]);
    expect(result.pagesExamined).toBe(3);
  });
});
