import { describe, it, expect } from "vitest";
import { runChecks, SECURITY_HEADERS } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

function page(url: string, rawHtml: string, renderedHtml = rawHtml): PageCapture {
  return {
    url,
    status: 200,
    raw: extractPage(rawHtml),
    rendered: extractPage(renderedHtml),
    error: null,
  };
}

function crawl(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: null,
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
      { agent: "OAI-SearchBot", allowed: true, matchedRule: null },
      { agent: "ClaudeBot", allowed: true, matchedRule: null },
      { agent: "PerplexityBot", allowed: true, matchedRule: null },
      { agent: "Google-Extended", allowed: true, matchedRule: null },
      { agent: "CCBot", allowed: true, matchedRule: null },
      { agent: "Googlebot", allowed: true, matchedRule: null },
      { agent: "Bingbot", allowed: false, matchedRule: "User-agent: * → Disallow: /" },
    ],
    sitemap: { present: true, urlCount: 4 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: { "x-frame-options": "SAMEORIGIN", "strict-transport-security": "max-age=1" },
    pages: [page("https://acme.example/", fixture("rich.html"))],
    ...over,
  };
}

describe("runChecks — crawler access", () => {
  it("splits AI blocks from classical blocks", () => {
    const c = runChecks(crawl());
    expect(c.crawlerAccess.blockedAi).toEqual(["GPTBot"]);
    expect(c.crawlerAccess.allowedAi).toEqual([
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]);
    expect(c.crawlerAccess.blockedClassical).toEqual(["Bingbot"]);
  });
});

describe("runChecks — crawler access measurement", () => {
  it("reports not measured, with empty lists, when the robots.txt fetch itself failed", () => {
    const c = runChecks(
      crawl({ sidecarErrors: { robots: "fetch failed: ECONNRESET", llms: null, sitemap: null } }),
    );
    expect(c.crawlerAccessMeasured).toBe(false);
    expect(c.crawlerAccess).toEqual({ blockedAi: [], allowedAi: [], blockedClassical: [] });
  });

  it("reports measured, with the populated lists, on a normal crawl", () => {
    const c = runChecks(crawl());
    expect(c.crawlerAccessMeasured).toBe(true);
    expect(c.crawlerAccess.blockedAi).toEqual(["GPTBot"]);
    expect(c.crawlerAccess.blockedClassical).toEqual(["Bingbot"]);
  });
});

describe("runChecks — JS dependence", () => {
  it("is zero when the raw HTML already carries the copy", () => {
    const c = runChecks(crawl());
    expect(c.jsDependence.avgMissing).toBe(0);
  });

  it("is near one when the raw HTML is an empty shell", () => {
    const c = runChecks(
      crawl({ pages: [page("https://acme.example/", fixture("bare.html"), fixture("rich.html"))] }),
    );
    expect(c.jsDependence.avgMissing).toBeGreaterThan(0.9);
    expect(c.jsDependence.perPage[0]!.url).toBe("https://acme.example/");
  });

  it("ignores pages that have no rendered capture", () => {
    const p = page("https://acme.example/", fixture("rich.html"));
    p.rendered = null;
    expect(runChecks(crawl({ pages: [p] })).jsDependence.perPage).toEqual([]);
  });
});

describe("runChecks — schema", () => {
  it("finds the declared types and names the missing ones", () => {
    const c = runChecks(crawl());
    expect(c.schema.typesFound).toContain("LocalBusiness");
    expect(c.schema.missingExpected).toEqual(["Service", "FAQPage", "Article"]);
    expect(c.schema.invalidBlocks).toBe(0);
  });

  it("counts a malformed JSON-LD block", () => {
    const html = `<html><head><script type="application/ld+json">{ nope }</script></head><body>x</body></html>`;
    const c = runChecks(crawl({ pages: [page("https://acme.example/", html)] }));
    expect(c.schema.invalidBlocks).toBe(1);
    expect(c.schema.typesFound).toEqual([]);
  });

  it("reads @graph entries", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":["FAQPage","WebPage"]}]}</script></head><body>x</body></html>`;
    const c = runChecks(crawl({ pages: [page("https://acme.example/", html)] }));
    expect(c.schema.typesFound.sort()).toEqual(["FAQPage", "Organization", "WebPage"]);
  });
});

describe("runChecks — meta, headings, technical", () => {
  it("counts complete metadata on a well-marked page", () => {
    const c = runChecks(crawl());
    expect(c.meta).toEqual({
      pageCount: 1,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingSocial: 0,
    });
    expect(c.headings).toEqual({ pagesWithoutH1: 0, pagesWithLevelSkips: 0 });
    expect(c.viewportOk).toBe(true);
    expect(c.sitemapPresent).toBe(true);
    expect(c.llmsTxtPresent).toBe(false);
  });

  it("counts the gaps on a bare page", () => {
    const c = runChecks(crawl({ pages: [page("https://acme.example/", fixture("bare.html"))] }));
    expect(c.meta.missingDescription).toBe(1);
    expect(c.meta.missingCanonical).toBe(1);
    expect(c.meta.missingSocial).toBe(1);
    expect(c.headings.pagesWithoutH1).toBe(1);
  });

  it("flags a heading level skip", () => {
    const html = `<html><body><h1>A</h1><h3>B</h3></body></html>`;
    expect(runChecks(crawl({ pages: [page("https://acme.example/", html)] })).headings).toEqual({
      pagesWithoutH1: 0,
      pagesWithLevelSkips: 1,
    });
  });

  it("reports present and missing security headers", () => {
    const c = runChecks(crawl());
    expect(c.securityHeaders.present).toEqual(["strict-transport-security", "x-frame-options"]);
    expect(c.securityHeaders.missing).toEqual(
      SECURITY_HEADERS.filter((h) => h !== "strict-transport-security" && h !== "x-frame-options"),
    );
  });
});
