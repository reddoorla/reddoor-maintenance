import { describe, it, expect } from "vitest";
import { renderProspectReport } from "../../src/prospect/render.js";
import { PROBES_SKIPPED, ANALYZE_SKIPPED } from "../../src/prospect/pipeline.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
} from "../../src/prospect/types.js";

function crawlData(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: GPTBot\nDisallow: /",
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
    ],
    sitemap: { present: true, urlCount: 12 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [],
    ...over,
  };
}

function checksData(over: Partial<ChecksResult> = {}): ChecksResult {
  return {
    crawlerAccessMeasured: true,
    crawlerAccess: { blockedAi: ["GPTBot"], allowedAi: ["ClaudeBot"], blockedClassical: [] },
    jsDependence: {
      avgMissing: 0.82,
      perPage: [{ url: "https://acme.example/", missing: 0.82, renderedWords: 420 }],
    },
    schema: { typesFound: ["LocalBusiness"], missingExpected: ["FAQPage"], invalidBlocks: 0 },
    meta: {
      pageCount: 4,
      missingTitle: 0,
      missingDescription: 2,
      missingCanonical: 1,
      missingSocial: 3,
      pagesWithoutExtract: 0,
    },
    headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 0 },
    securityHeaders: { present: ["x-frame-options"], missing: ["content-security-policy"] },
    sitemapPresent: true,
    llmsTxtPresent: false,
    viewportOk: true,
    ...over,
  };
}

function lighthouseData(over: Partial<LighthouseScores> = {}): LighthouseScores {
  return {
    performance: 44,
    accessibility: 88,
    bestPractices: 75,
    seo: 92,
    summary: "lighthouse: 2 assertion(s) failed",
    status: "warn",
    ...over,
  };
}

function analyzeData(over: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    businessName: "Acme Roofing",
    business:
      "A Boise-based roofing contractor offering repair, replacement, and inspection services for residential customers.",
    entityClarity: { score: 55, missing: ["service area"] },
    buyerQuestions: [
      {
        question: "What does a repair cost?",
        answered: "partial",
        quotable: false,
        page: "https://acme.example/",
        evidence: "$1,200-$8,000",
      },
      {
        question: "Do you do flat roofs?",
        answered: "no",
        quotable: false,
        page: null,
        evidence: null,
      },
    ],
    fixes: [
      {
        title: "Unblock GPTBot in robots.txt",
        why: "It cannot read a single page today.",
        impact: "high",
        effort: "low",
        tier: "crawl",
      },
      {
        title: "Add FAQ schema",
        why: "Answer engines quote FAQ blocks.",
        impact: "medium",
        effort: "medium",
        tier: "content",
      },
    ],
    narrative: {
      findability: "Two of six AI crawlers are blocked.",
      readability: "Most copy needs JavaScript.",
      answers: "Half the buyer questions go unanswered.",
    },
    ...over,
  };
}

function probesData(over: Partial<ProbesResult> = {}): ProbesResult {
  return {
    answers: [
      {
        engine: "perplexity",
        query: "who is Acme Roofing",
        kind: "branded",
        domainCited: true,
        brandMentioned: true,
        citedDomains: ["acme.example"],
        snippet: "Acme Roofing is a Boise contractor.",
        askedAt: "2026-08-25T16:00:00.000Z",
      },
      {
        engine: "perplexity",
        query: "best roofer in Boise",
        kind: "category",
        domainCited: false,
        brandMentioned: false,
        citedDomains: ["bestroofs.example"],
        snippet: "BestRoofs is frequently recommended.",
        askedAt: "2026-08-25T16:05:00.000Z",
      },
    ],
    visibilityScore: 33,
    brandedRecognized: true,
    competitorsSeen: [{ domain: "bestroofs.example", count: 4 }],
    ...over,
  };
}

function result(over: Partial<ProspectAuditResult> = {}): ProspectAuditResult {
  return {
    url: "https://acme.example/",
    business: "Acme Roofing",
    generatedAt: "2026-08-25T17:00:00.000Z",
    scores: { findability: 62, readability: 41, answers: 50, aiVisibility: 33 },
    crawl: { ok: true, data: crawlData() },
    checks: { ok: true, data: checksData() },
    lighthouse: { ok: true, data: lighthouseData() },
    analyze: { ok: true, data: analyzeData() },
    probes: { ok: true, data: probesData() },
    ...over,
  };
}

describe("renderProspectReport", () => {
  const html = renderProspectReport(result());

  it("is a self-contained, noindex HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("names the business and the audited URL", () => {
    expect(html).toContain("Acme Roofing");
    expect(html).toContain("https://acme.example/");
  });

  it("shows all four scores", () => {
    for (const label of ["Findability", "Readability", "Answers", "AI Visibility"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("62");
    expect(html).toContain("33");
  });

  it("leads with the probe receipts", () => {
    expect(html).toContain("What the AI engines said about you");
    expect(html).toContain("who is Acme Roofing");
    expect(html).toContain("BestRoofs is frequently recommended.");
    expect(html).toContain("bestroofs.example");
    expect(html.indexOf("What the AI engines said about you")).toBeLessThan(
      html.indexOf("What to fix first"),
    );
  });

  it("renders the findings and the fix list in impact order", () => {
    expect(html).toContain("GPTBot");
    expect(html).toContain("82%");
    expect(html).toContain("What does a repair cost?");
    expect(html.indexOf("Unblock GPTBot in robots.txt")).toBeLessThan(
      html.indexOf("Add FAQ schema"),
    );
  });

  it("degrades a failed stage to 'Not measured' without throwing", () => {
    const degraded = renderProspectReport(
      result({
        probes: { ok: false, error: "no visibility engine returned an answer" },
        analyze: { ok: false, error: "529 overloaded" },
        scores: { findability: 62, readability: 41, answers: null, aiVisibility: null },
      }),
    );
    expect(degraded).toContain("Not measured");
    expect(degraded).toContain("no visibility engine returned an answer");
    expect(degraded).toContain("What the AI engines said about you");
  });

  it("escapes content that came from the prospect's site", () => {
    const evil = renderProspectReport(result({ business: '<script>alert("x")</script>' }));
    expect(evil).not.toContain('<script>alert("x")</script>');
    expect(evil).toContain("&lt;script&gt;");
  });

  it("degrades cleanly when every stage but the crawl fails", () => {
    const allFailed = renderProspectReport(
      result({
        checks: { ok: false, error: "crawl produced no comparable pages" },
        lighthouse: { ok: false, error: "lighthouse: no report produced" },
        analyze: { ok: false, error: ANALYZE_SKIPPED },
        probes: { ok: false, error: "no visibility engine returned an answer" },
        scores: { findability: null, readability: null, answers: null, aiVisibility: null },
      }),
    );
    expect(() => allFailed).not.toThrow();
    expect(allFailed.startsWith("<!doctype html>")).toBe(true);
    expect(allFailed).toContain("crawl produced no comparable pages");
    expect(allFailed).toContain("lighthouse: no report produced");
    expect(allFailed).toContain("no visibility engine returned an answer");
    // analyze's error here is the SKIP constant, so it must read as a skip,
    // not a generic "Not measured" for that section.
    expect(allFailed).toMatch(/checks stage failed|skipped/i);
    // Every score card falls back to "Not measured" — four of them.
    expect(allFailed.match(/Not measured/g)?.length).toBeGreaterThanOrEqual(4);
  });

  // --- Corrections 1-6 (plan predates these contract changes) ---

  // Correction 1: business is a NAME (possibly empty), fall back to hostname,
  // never present an empty name as a verified fact. The DESCRIPTION
  // (analyze.data.business) is prose in the body, not the title.
  it("falls back to the hostname when the business name is null or empty", () => {
    const nullName = renderProspectReport(result({ business: null }));
    expect(nullName).toContain("acme.example");

    const emptyName = renderProspectReport(result({ business: "" }));
    expect(emptyName).toContain("acme.example");
  });

  it("uses the analyze description as body prose, not as the report's name", () => {
    const description =
      "A Boise-based roofing contractor offering repair, replacement, and inspection services for residential customers.";
    expect(html).toContain(description);
    // The <h1> carries the NAME, not the (much longer) description sentence.
    const h1 = /<h1>(.*?)<\/h1>/s.exec(html);
    expect(h1).not.toBeNull();
    expect(h1![1]).not.toContain(description);
    expect(h1![1]).toContain("Acme Roofing");
  });

  // Correction 2: aiVisibility score is about buyer/category questions only;
  // brandedRecognized is reported in words, never folded into the number.
  it("labels AI Visibility as being about buyer questions, and reports brand recognition separately in words", () => {
    expect(html).toMatch(/buyer question/i);
    expect(html).toMatch(/recognized/i);
  });

  it("reports brandedRecognized as false in words when the engines never recognized the brand", () => {
    const notRecognized = renderProspectReport(
      result({
        probes: {
          ok: true,
          data: probesData({
            answers: [
              {
                engine: "perplexity",
                query: "who is Acme Roofing",
                kind: "branded",
                domainCited: false,
                brandMentioned: false,
                citedDomains: [],
                snippet: "I don't have information about that business.",
                askedAt: "2026-08-25T16:00:00.000Z",
              },
            ],
            visibilityScore: null,
            brandedRecognized: false,
            competitorsSeen: [],
          }),
        },
      }),
    );
    expect(notRecognized).toMatch(/did not recognize|was not recognized|no recognition/i);
  });

  // Correction 3: group receipts by kind; state when each was asked.
  it("groups probe receipts by kind and states when each was asked", () => {
    expect(html).toMatch(/branded/i);
    expect(html).toMatch(/category|buyer/i);
    // askedAt (2026-08-25) must be rendered somewhere human-readable.
    expect(html).toMatch(/August 25, 2026|2026-08-25/);
  });

  // Correction 4: crawlerAccessMeasured false → "not measured", never a
  // universal-access claim manufactured from our own missing data.
  it("says crawler access was not measured when the robots.txt fetch failed, and never claims universal access", () => {
    const degraded = renderProspectReport(
      result({
        crawl: {
          ok: true,
          data: crawlData({
            sidecarErrors: { robots: "fetch failed: ECONNRESET", llms: null, sitemap: null },
          }),
        },
        checks: {
          ok: true,
          data: checksData({
            crawlerAccessMeasured: false,
            crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
          }),
        },
      }),
    );
    expect(degraded).toMatch(/not measured/i);
    expect(degraded).not.toContain("Every AI crawler we checked can reach the site.");
  });

  // Correction 5: avgMissing null → "not measured", never "0%". Surface
  // pagesWithoutExtract so a partial audit can't read as a complete one.
  it("says readability is not measured (not 0%) when avgMissing is null", () => {
    const degraded = renderProspectReport(
      result({
        checks: { ok: true, data: checksData({ jsDependence: { avgMissing: null, perPage: [] } }) },
      }),
    );
    expect(degraded).toMatch(/not measured/i);
    expect(degraded).not.toContain("0% of the words");
  });

  it("surfaces pages that produced no extract at all", () => {
    const withMissingPages = renderProspectReport(
      result({
        checks: {
          ok: true,
          data: checksData({ meta: { ...checksData().meta, pagesWithoutExtract: 2 } }),
        },
      }),
    );
    expect(withMissingPages).toMatch(
      /2[^%]*(pages?|page).{0,40}(no extract|failed|produced nothing)/i,
    );
  });

  // Correction 6: a requested skip must read differently from an attempted
  // failure — compared against the pipeline's exported constants, never a
  // retyped string literal.
  it("reads a requested probes skip differently from an attempted probes failure", () => {
    const skipped = renderProspectReport(result({ probes: { ok: false, error: PROBES_SKIPPED } }));
    expect(skipped).toMatch(/you asked|skipped by request|requested.*skip/i);
    expect(skipped).not.toContain("Not measured");
  });

  it("reads a requested analyze skip differently from an attempted analyze failure", () => {
    const skipped = renderProspectReport(
      result({ analyze: { ok: false, error: ANALYZE_SKIPPED } }),
    );
    expect(skipped).toMatch(/checks stage failed|couldn't be analyzed|skipped/i);
  });

  // --- Code-review follow-up: safeUrl no longer round-trips the raw string,
  // real Lighthouse numbers must survive an unrelated stage failure, and a
  // branded-only probe run must not read as a positive discoverability finding ---

  it("keeps the measured Lighthouse numbers even when the checks stage failed", () => {
    const rendered = renderProspectReport(
      result({ checks: { ok: false, error: "crawl produced no comparable pages" } }),
    );
    expect(rendered).toContain("performance 44");
    expect(rendered).toContain("SEO 92");
    expect(rendered).toContain("accessibility 88");
  });

  it("qualifies a branded-only probe run as not indicating buyer discoverability", () => {
    const brandedOnly = renderProspectReport(
      result({
        probes: {
          ok: true,
          data: probesData({
            answers: [
              {
                engine: "perplexity",
                query: "who is Acme Roofing",
                kind: "branded",
                domainCited: true,
                brandMentioned: true,
                citedDomains: ["acme.example"],
                snippet: "Acme Roofing is a Boise contractor.",
                askedAt: "2026-08-25T16:00:00.000Z",
              },
            ],
            visibilityScore: null,
          }),
        },
      }),
    );
    expect(brandedOnly).toMatch(/no buyer-question|only name-recognition/i);
    // The default fixture DOES include a category question, so it must not
    // carry the same caveat — proving this is conditional, not boilerplate.
    expect(html).not.toMatch(/no buyer-question \(category\) query was tested/i);
  });

  // --- Adversarial escaping: business/description was already covered
  // above; every other prospect-controlled sink gets its own hostile fixture.
  describe("escapes hostile content at every prospect-controlled sink", () => {
    const scriptPayload = "<script>alert(1)</script>";
    const escapedScript = "&lt;script&gt;alert(1)&lt;/script&gt;";

    it("evidence quote and its source-page link", () => {
      const evil = renderProspectReport(
        result({
          analyze: {
            ok: true,
            data: analyzeData({
              buyerQuestions: [
                {
                  question: "What does a repair cost?",
                  answered: "partial",
                  quotable: false,
                  page: 'https://acme.example/"><script>alert(2)</script>',
                  evidence: scriptPayload,
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
      // The evidence link's href must be percent-encoded by safeUrl, not the
      // raw quote-breakout string.
      expect(evil).not.toContain('"><script>alert(2)</script>');
    });

    it("probe snippet and cited domains", () => {
      const evil = renderProspectReport(
        result({
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is Acme Roofing",
                  kind: "category",
                  domainCited: true,
                  brandMentioned: true,
                  citedDomains: [scriptPayload],
                  snippet: scriptPayload,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
    });

    it("fix title and why", () => {
      const evil = renderProspectReport(
        result({
          analyze: {
            ok: true,
            data: analyzeData({
              fixes: [
                {
                  title: scriptPayload,
                  why: scriptPayload,
                  impact: "high",
                  effort: "low",
                  tier: "crawl",
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
    });

    it("the audited URL itself, in both its href and its visible text", () => {
      const evil = renderProspectReport(
        result({ url: 'https://acme.example/"><script>alert(3)</script>' }),
      );
      expect(evil).not.toContain('"><script>alert(3)</script>');
      // safeUrl now returns the percent-encoded href (never the raw string),
      // so the quote/bracket breakout cannot reach the href attribute
      // literally — this is the live-injection fix.
      expect(evil).not.toContain('href="https://acme.example/">');
      expect(evil).toMatch(/href="https:\/\/acme\.example\/%22/);
    });
  });
});
