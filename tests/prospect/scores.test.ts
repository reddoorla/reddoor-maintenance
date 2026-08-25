import { describe, it, expect } from "vitest";
import { computeScores } from "../../src/prospect/checks.js";
import type { AnalyzeResult, ChecksResult, ProbesResult } from "../../src/prospect/types.js";

const perfectChecks: ChecksResult = {
  crawlerAccessMeasured: true,
  crawlerAccess: {
    blockedAi: [],
    allowedAi: [
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ],
    blockedClassical: [],
  },
  jsDependence: { avgMissing: 0, perPage: [] },
  schema: {
    typesFound: ["Organization", "Service", "FAQPage", "Article"],
    missingExpected: [],
    invalidBlocks: 0,
  },
  meta: {
    pageCount: 2,
    missingTitle: 0,
    missingDescription: 0,
    missingCanonical: 0,
    missingSocial: 0,
    pagesWithoutExtract: 0,
  },
  headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
  securityHeaders: { present: [], missing: [] },
  sitemapMeasured: true,
  sitemapPresent: true,
  llmsTxtMeasured: true,
  llmsTxtPresent: true,
  viewportOk: true,
};

const worstChecks: ChecksResult = {
  ...perfectChecks,
  crawlerAccess: {
    blockedAi: [
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ],
    allowedAi: [],
    blockedClassical: ["Googlebot"],
  },
  jsDependence: { avgMissing: 1, perPage: [] },
  schema: {
    typesFound: [],
    missingExpected: ["Organization", "Service", "FAQPage", "Article"],
    invalidBlocks: 2,
  },
  meta: {
    pageCount: 2,
    missingTitle: 2,
    missingDescription: 2,
    missingCanonical: 2,
    missingSocial: 2,
    pagesWithoutExtract: 0,
  },
  headings: { pagesWithoutH1: 2, pagesWithLevelSkips: 2 },
  sitemapPresent: false,
  llmsTxtPresent: false,
  viewportOk: false,
};

const analyze = (
  answers: AnalyzeResult["buyerQuestions"][number]["answered"][],
): AnalyzeResult => ({
  businessName: "Acme",
  business: "Acme",
  entityClarity: { score: 80, missing: [] },
  categoryQueries: ["roof repair contractor Boise", "how much does a roof replacement cost"],
  buyerQuestions: answers.map((answered, i) => ({
    question: `q${i}`,
    answered,
    quotable: answered === "yes",
    page: null,
    evidence: null,
  })),
  fixes: [],
  narrative: { findability: "", readability: "", answers: "" },
});

const probes: ProbesResult = {
  answers: [],
  visibilityScore: 42,
  brandedRecognized: true,
  competitorsSeen: [],
};

describe("computeScores", () => {
  it("scores a perfect site at 100 across the deterministic tiers", () => {
    const s = computeScores({
      checks: perfectChecks,
      lighthouse: null,
      analyze: null,
      probes: null,
    });
    expect(s.findability).toBe(100);
    expect(s.readability).toBe(100);
  });

  it("scores a fully blocked, fully client-rendered site at 0", () => {
    const s = computeScores({ checks: worstChecks, lighthouse: null, analyze: null, probes: null });
    expect(s.findability).toBe(0);
    expect(s.readability).toBe(0);
  });

  it("returns null for every score whose inputs are missing", () => {
    expect(computeScores({ checks: null, lighthouse: null, analyze: null, probes: null })).toEqual({
      findability: null,
      readability: null,
      answers: null,
      aiVisibility: null,
    });
  });

  it("grades answers as yes=1, partial=0.5, no=0", () => {
    const s = computeScores({
      checks: null,
      lighthouse: null,
      analyze: analyze(["yes", "partial", "no", "no"]),
      probes: null,
    });
    expect(s.answers).toBe(38);
  });

  it("passes the probe visibility score through", () => {
    expect(
      computeScores({ checks: null, lighthouse: null, analyze: null, probes }).aiVisibility,
    ).toBe(42);
  });

  it("folds the Lighthouse SEO score into findability when present", () => {
    const withLh = computeScores({
      checks: worstChecks,
      lighthouse: {
        performance: 50,
        accessibility: 50,
        bestPractices: 50,
        seo: 100,
        summary: "",
        status: "pass",
      },
      analyze: null,
      probes: null,
    });
    expect(withLh.findability).toBe(20);
  });

  it("reads JS-dependence as not measured (null) without dragging down findability", () => {
    const jsUnmeasured: ChecksResult = {
      ...perfectChecks,
      jsDependence: { avgMissing: null, perPage: [] },
    };
    const s = computeScores({
      checks: jsUnmeasured,
      lighthouse: null,
      analyze: null,
      probes: null,
    });
    expect(s.readability).toBeNull();
    // Findability doesn't depend on jsDependence at all — it must still compute.
    expect(s.findability).toBe(100);
  });

  it("reads crawler access as not measured (null) without dragging down readability", () => {
    const crawlerUnmeasured: ChecksResult = {
      ...perfectChecks,
      crawlerAccessMeasured: false,
    };
    const s = computeScores({
      checks: crawlerUnmeasured,
      lighthouse: null,
      analyze: null,
      probes: null,
    });
    expect(s.findability).toBeNull();
    // Readability doesn't depend on crawlerAccessMeasured at all — it must still compute.
    expect(s.readability).toBe(100);
  });

  it("does not score findability when no page was readable", () => {
    const noPagesRead: ChecksResult = {
      ...perfectChecks,
      meta: {
        ...perfectChecks.meta,
        pageCount: 0,
        pagesWithoutExtract: 2,
      },
    };
    const s = computeScores({
      checks: noPagesRead,
      lighthouse: null,
      analyze: analyze(["yes", "partial", "no", "no"]),
      probes,
    });
    expect(s.findability).toBeNull();
    // answers and aiVisibility come from their own stages, unaffected by checks.
    expect(s.answers).toBe(38);
    expect(s.aiVisibility).toBe(42);
  });

  it("scores an unmeasured sitemap fetch as neutral, not as a confirmed absence", () => {
    // perfectChecks scores 100. Flipping ONLY sitemapMeasured to false (leaving
    // sitemapPresent untouched, since an unmeasured sidecar makes that field
    // moot) must not drop findability to what an actually-absent-and-measured
    // sitemap would score.
    const sitemapUnmeasured: ChecksResult = { ...perfectChecks, sitemapMeasured: false };
    const sitemapAbsent: ChecksResult = { ...perfectChecks, sitemapPresent: false };

    const unmeasured = computeScores({
      checks: sitemapUnmeasured,
      lighthouse: null,
      analyze: null,
      probes: null,
    });
    const absent = computeScores({
      checks: sitemapAbsent,
      lighthouse: null,
      analyze: null,
      probes: null,
    });

    // technical = neutral(0.5)*0.5 + viewportOk(1)*0.25 + llms(1)*0.25 = 0.75
    // base01 = (40 + 10 + 15 + 0.75*15) / 80 = 76.25/80 = 0.953125 → 95
    expect(unmeasured.findability).toBe(95);
    // technical = absent(0)*0.5 + viewportOk(1)*0.25 + llms(1)*0.25 = 0.5
    // base01 = (40 + 10 + 15 + 0.5*15) / 80 = 72.5/80 = 0.90625 → 91
    expect(absent.findability).toBe(91);
    // The unmeasured case must score strictly higher than the confirmed-absent
    // case — "we didn't check" must never be graded as harshly as "we checked
    // and it's missing".
    expect(unmeasured.findability!).toBeGreaterThan(absent.findability!);
    // And it must not reach the full 100 either — neutral, not a free pass.
    expect(unmeasured.findability!).toBeLessThan(100);
  });

  it("scores an unmeasured llms.txt fetch as neutral, not as a confirmed absence", () => {
    const llmsUnmeasured: ChecksResult = { ...perfectChecks, llmsTxtMeasured: false };
    const s = computeScores({
      checks: llmsUnmeasured,
      lighthouse: null,
      analyze: null,
      probes: null,
    });
    // technical = sitemap(1)*0.5 + viewportOk(1)*0.25 + neutral(0.5)*0.25 = 0.875
    // base01 = (40 + 10 + 15 + 0.875*15) / 80 = 78.125/80 = 0.9765625 → 98
    expect(s.findability).toBe(98);
  });

  it("pins the exact score from a mixed ChecksResult, catching a swapped weight", () => {
    // Every component below is a genuine fraction (never 0 or 1), so a weight
    // swap between any two findability terms {AI-access:40, classical:10,
    // metadata:15, technical:15} or any two readability terms
    // {jsDependence:60, structure:25, schema:15} changes the total — unlike
    // the perfect/worst fixtures above, where every term is 0 or 1 and any
    // weighting that sums to the same total is indistinguishable.
    //
    // Findability:
    //   aiOpen = 2 allowed / 6 total = 1/3
    //   classicalOpen = 0 (Bingbot blocked)
    //   metaComplete = 1 - (missingTitle 1 + missingDescription 2 + missingCanonical 0) / (pageCount 4 * 3)
    //                = 1 - 3/12 = 0.75
    //   technical = sitemapPresent(1)*0.5 + viewportOk(0)*0.25 + llmsTxtPresent(0)*0.25 = 0.5
    //   base01 = (1/3*40 + 0*10 + 0.75*15 + 0.5*15) / 80
    //          = (13.3333... + 0 + 11.25 + 7.5) / 80 = 32.0833.../80 = 0.4010416...
    //   findability = round(0.4010416... * 100) = round(40.10416...) = 40
    //
    // Readability:
    //   jsTerm = (1 - avgMissing 0.4) * 60 = 0.6 * 60 = 36
    //   structure = 1 - (pagesWithoutH1 1 + pagesWithLevelSkips 1) / (pageCount 4 * 2) = 1 - 2/8 = 0.75
    //             → 0.75 * 25 = 18.75
    //   schemaCoverage = 1 - missingExpected.length(2)/4 - min(0.25, invalidBlocks(1)*0.1)
    //                  = 1 - 0.5 - 0.1 = 0.4 → 0.4 * 15 = 6
    //   readability = round(36 + 18.75 + 6) = round(60.75) = 61
    const mixed: ChecksResult = {
      crawlerAccessMeasured: true,
      crawlerAccess: {
        allowedAi: ["GPTBot", "OAI-SearchBot"],
        blockedAi: ["ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"],
        blockedClassical: ["Bingbot"],
      },
      jsDependence: { avgMissing: 0.4, perPage: [] },
      schema: {
        typesFound: ["Organization"],
        missingExpected: ["FAQPage", "Article"],
        invalidBlocks: 1,
      },
      meta: {
        pageCount: 4,
        missingTitle: 1,
        missingDescription: 2,
        missingCanonical: 0,
        missingSocial: 1,
        pagesWithoutExtract: 0,
      },
      headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 1 },
      securityHeaders: { present: [], missing: [] },
      sitemapMeasured: true,
      sitemapPresent: true,
      llmsTxtMeasured: true,
      llmsTxtPresent: false,
      viewportOk: false,
    };

    const s = computeScores({ checks: mixed, lighthouse: null, analyze: null, probes: null });
    expect(s.findability).toBe(40);
    expect(s.readability).toBe(61);
  });
});
