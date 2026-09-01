// The crawl retrieves pages; not all of them are PAGES. A 404, a Cloudflare
// email-protection interstitial, a render that timed out — every one of those
// is OUR missing data, and the audit's cardinal rule is that our missing data
// never becomes the prospect's defect. This module is the one place that
// decides what counts, so journey, consistency, goals and basics cannot each
// answer it differently.
import { describe, it, expect } from "vitest";
import { fetchedOk, isInfraPath, usablePages } from "../../src/prospect/pages.js";
import type { PageCapture, PageExtract } from "../../src/prospect/types.js";

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

const page = (over: Partial<PageCapture> = {}): PageCapture => ({
  url: "https://example.com/",
  status: 200,
  raw: extract(),
  rendered: extract(),
  error: null,
  ...over,
});

describe("fetchedOk", () => {
  it("accepts a 2xx and a 3xx that resolved", () => {
    expect(fetchedOk(page({ status: 200 }))).toBe(true);
    expect(fetchedOk(page({ status: 299 }))).toBe(true);
  });

  it("rejects a 404 even when a browser rendered something for it", () => {
    // Cloudflare's /cdn-cgi/l/email-protection answers 404 and still paints a
    // page. Playwright captures that paint, so `rendered` is non-null and the
    // page looked real to every consumer that only checked for an extract.
    expect(fetchedOk(page({ status: 404, raw: null, rendered: extract() }))).toBe(false);
  });

  it("rejects a failed fetch, where status is null", () => {
    expect(fetchedOk(page({ status: null, raw: null, rendered: null }))).toBe(false);
  });
});

describe("isInfraPath", () => {
  it("recognises the Cloudflare email-protection interstitial", () => {
    expect(isInfraPath("https://example.com/cdn-cgi/l/email-protection")).toBe(true);
    expect(isInfraPath("https://example.com/cdn-cgi/challenge-platform/x")).toBe(true);
  });

  it("leaves ordinary pages alone, including ones that merely mention cgi", () => {
    expect(isInfraPath("https://example.com/about")).toBe(false);
    expect(isInfraPath("https://example.com/blog/cdn-cgi-explained")).toBe(false);
  });

  it("treats a WordPress admin-ajax endpoint as infrastructure too", () => {
    expect(isInfraPath("https://example.com/wp-admin/admin-ajax.php")).toBe(true);
  });
});

describe("usablePages", () => {
  it("drops non-2xx pages and infrastructure URLs", () => {
    const set = usablePages([
      page({ url: "https://example.com/" }),
      page({ url: "https://example.com/404", status: 404, raw: null }),
      page({ url: "https://example.com/cdn-cgi/l/email-protection", status: 404, raw: null }),
    ]);
    expect(set.pages.map((p) => p.page.url)).toEqual(["https://example.com/"]);
  });

  it("judges every page on the SAME view, so one page's failed render cannot make it look off-template", () => {
    // Three pages fetched fine; Playwright timed out on the third, so only it
    // lacks a rendered view. Judging that page from `raw` while its siblings
    // are judged from `rendered` is how a render timeout of ours turns into
    // "this page is built outside your template". Answering with `raw` for all
    // three keeps the comparison honest AND keeps every page in it.
    const set = usablePages([
      page({ url: "https://example.com/a" }),
      page({ url: "https://example.com/b" }),
      page({ url: "https://example.com/c", rendered: null }),
    ]);
    expect(set.view).toBe("raw");
    expect(set.pages).toHaveLength(3);
    expect(set.pages.every((p) => p.extract === p.page.raw)).toBe(true);
    expect(set.excluded).toBe(0);
  });

  it("prefers rendered when that view covers at least as many pages", () => {
    // The mirror case: a page served as non-HTML has no raw extract, so
    // rendered is the view that covers everything.
    const set = usablePages([
      page({ url: "https://example.com/a" }),
      page({ url: "https://example.com/b" }),
      page({ url: "https://example.com/c", raw: null }),
    ]);
    expect(set.view).toBe("rendered");
    expect(set.pages).toHaveLength(3);
  });

  it("counts a page with neither view as excluded rather than dropping it silently", () => {
    const set = usablePages([
      page({ url: "https://example.com/a" }),
      page({ url: "https://example.com/b", raw: null, rendered: null }),
    ]);
    expect(set.pages).toHaveLength(1);
    expect(set.excluded).toBe(1);
  });

  it("reports whether anchors were measured on every page it kept", () => {
    const measured = usablePages([page(), page({ url: "https://example.com/b" })]);
    expect(measured.anchorsMeasured).toBe(true);

    const withoutAnchors = { ...extract() };
    delete (withoutAnchors as { anchors?: unknown }).anchors;
    const unmeasured = usablePages([
      page(),
      page({ url: "https://example.com/b", raw: withoutAnchors, rendered: withoutAnchors }),
    ]);
    expect(unmeasured.anchorsMeasured).toBe(false);
  });

  it("returns nothing usable rather than throwing when the crawl produced nothing", () => {
    const set = usablePages([]);
    expect(set.pages).toEqual([]);
    expect(set.anchorsMeasured).toBe(false);
  });
});
