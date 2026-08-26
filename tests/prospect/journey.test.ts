import { describe, it, expect } from "vitest";
import {
  affordancesOn,
  buildJourney,
  canonicalizeUrl,
  resolveNavigable,
} from "../../src/prospect/journey.js";
import type { FormShape, PageAnchor, PageCapture, PageExtract } from "../../src/prospect/types.js";

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

const contactForm = (over: Partial<FormShape> = {}): FormShape => ({
  kind: "enquiry",
  action: "/submit",
  method: "post",
  fieldCount: 3,
  hasContactField: true,
  hasSubmit: true,
  ...over,
});

describe("canonicalizeUrl", () => {
  it("folds trailing slash, www and case so one page is one node", () => {
    expect(canonicalizeUrl("https://WWW.Example.com/about/")).toBe("example.com/about");
    expect(canonicalizeUrl("https://example.com/about")).toBe("example.com/about");
  });

  it("drops query and hash — they address a state, not another page", () => {
    expect(canonicalizeUrl("https://example.com/a?utm=x#top")).toBe("example.com/a");
  });

  it("keeps the root path distinguishable", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("example.com/");
  });

  it("rejects non-http schemes and junk", () => {
    expect(canonicalizeUrl("mailto:a@b.com")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("resolveNavigable", () => {
  it("resolves a relative href against the page", () => {
    expect(resolveNavigable("/about", "https://example.com/blog/post")).toBe(
      "https://example.com/about",
    );
  });

  // These are the ones that would silently inflate connectivity: they look like
  // links and go nowhere else.
  it("refuses hrefs that do not navigate to another page", () => {
    for (const href of ["#top", "tel:+15551234", "mailto:a@b.com", "javascript:void(0)", ""]) {
      expect(resolveNavigable(href, "https://example.com/")).toBeNull();
    }
  });
});

describe("affordancesOn", () => {
  it("finds tel and mailto links", () => {
    const found = affordancesOn(
      page("https://example.com/", {
        anchors: [link("tel:+1 555 0100"), link("mailto:hi@example.com?subject=x")],
      }),
    );
    expect(found).toEqual([
      { kind: "tel", page: "https://example.com/", detail: "+1 555 0100" },
      { kind: "mailto", page: "https://example.com/", detail: "hi@example.com" },
    ]);
  });

  // The whole point of FormShape.hasContactField. A site with a search box and
  // no way to reach a human has no conversion path, and counting forms alone
  // would score that a pass.
  it("ignores a form that asks for no way to reply", () => {
    const found = affordancesOn(
      page("https://example.com/", {
        forms: [
          contactForm({ kind: "other", hasContactField: false, fieldCount: 1, action: "/search" }),
        ],
      }),
    );
    expect(found).toEqual([]);
  });

  it("counts a form that does ask for one", () => {
    const found = affordancesOn(page("https://example.com/", { forms: [contactForm()] }));
    expect(found).toEqual([{ kind: "form", page: "https://example.com/", detail: "/submit" }]);
  });

  // Caught on real data, not in review. Icovy carries a one-field email box in
  // the footer of every page; before `FormKind` split subscribe from enquiry it
  // counted as a way to reach a human, and the whole site read as zero clicks
  // from contact when the only form that reaches a person is the nine-field one
  // on /contact-us.
  it("does not treat a lone newsletter email box as a way to reach a human", () => {
    const found = affordancesOn(
      page("https://example.com/blog", {
        forms: [contactForm({ kind: "subscribe", fieldCount: 1, action: "/subscribe" })],
      }),
    );
    expect(found).toEqual([]);
  });

  it("still finds the real enquiry form on a page that also has a newsletter box", () => {
    const found = affordancesOn(
      page("https://example.com/contact", {
        forms: [
          contactForm({ kind: "enquiry", fieldCount: 9, action: "/enquiry" }),
          contactForm({ kind: "subscribe", fieldCount: 1, action: "/subscribe" }),
        ],
      }),
    );
    expect(found).toEqual([
      { kind: "form", page: "https://example.com/contact", detail: "/enquiry" },
    ]);
  });

  it("returns nothing for a page that produced no extract", () => {
    const dead: PageCapture = {
      url: "https://example.com/x",
      status: 500,
      raw: null,
      rendered: null,
      error: "boom",
    };
    expect(affordancesOn(dead)).toEqual([]);
  });
});

describe("buildJourney", () => {
  it("measures clicks from a deep page to the nearest contact", () => {
    // post -> blog -> home(contact). The visitor who lands on the post — which
    // is where a search engine sends them — is two clicks from a phone number.
    const journey = buildJourney([
      page("https://example.com/", { anchors: [link("tel:+15550100")] }),
      page("https://example.com/blog", { anchors: [link("/")] }),
      page("https://example.com/blog/post", { anchors: [link("/blog")] }),
    ]);
    const byUrl = Object.fromEntries(journey.pages.map((p) => [p.url, p.clicksToContact]));
    expect(byUrl["https://example.com/"]).toBe(0);
    expect(byUrl["https://example.com/blog"]).toBe(1);
    expect(byUrl["https://example.com/blog/post"]).toBe(2);
    expect(journey.worstClicksToContact).toBe(2);
    expect(journey.deadEnds).toEqual([]);
  });

  it("reports a page with no path as a dead end", () => {
    const journey = buildJourney([
      page("https://example.com/", { anchors: [link("tel:+15550100")] }),
      // Links only outward, never back into the site.
      page("https://example.com/orphan", { anchors: [link("https://elsewhere.example/")] }),
    ]);
    expect(journey.deadEnds).toEqual(["https://example.com/orphan"]);
    expect(journey.worstClicksToContact).toBe(0);
  });

  it("does not count a self-link or an external link as an internal edge", () => {
    const journey = buildJourney([
      page("https://example.com/", {
        anchors: [link("https://example.com/"), link("https://other.example/"), link("#section")],
      }),
    ]);
    expect(journey.pages[0]?.internalLinks).toBe(0);
  });

  it("treats /about and /about/ as one page", () => {
    const journey = buildJourney([
      page("https://example.com/about/", { anchors: [link("tel:+15550100")] }),
      page("https://example.com/contact", { anchors: [link("/about")] }),
    ]);
    const contact = journey.pages.find((p) => p.url.endsWith("/contact"));
    expect(contact?.clicksToContact).toBe(1);
  });

  // Our transport failure is not the prospect's dead end.
  it("excludes pages that produced no extract rather than calling them dead ends", () => {
    const journey = buildJourney([
      page("https://example.com/", { anchors: [link("tel:+15550100")] }),
      { url: "https://example.com/broken", status: null, raw: null, rendered: null, error: "x" },
    ]);
    expect(journey.pagesExamined).toBe(1);
    expect(journey.deadEnds).toEqual([]);
  });

  it("reports no contact anywhere as every page being a dead end", () => {
    const journey = buildJourney([
      page("https://example.com/", { anchors: [link("/about")] }),
      page("https://example.com/about", { anchors: [link("/")] }),
    ]);
    expect(journey.deadEnds).toHaveLength(2);
    expect(journey.worstClicksToContact).toBeNull();
    expect(journey.affordances).toEqual([]);
  });

  it("walks backwards from every contact page at once, taking the nearest", () => {
    // deep is 1 from /contact and 2 from /. The answer must be 1.
    const journey = buildJourney([
      page("https://example.com/", { anchors: [link("mailto:a@example.com"), link("/deep")] }),
      page("https://example.com/contact", { anchors: [link("tel:+15550100")] }),
      page("https://example.com/deep", { anchors: [link("/contact"), link("/")] }),
    ]);
    const deep = journey.pages.find((p) => p.url.endsWith("/deep"));
    expect(deep?.clicksToContact).toBe(1);
  });
});
