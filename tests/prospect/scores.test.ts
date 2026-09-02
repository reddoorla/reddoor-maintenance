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

  it("leaves a question we never got an answer for out of the denominator", () => {
    // "unknown" is our own gap, not a "no" about them. Scored as a zero it
    // would both understate the site and make the number move whenever OUR
    // measurement flaked — the opposite of an instrument you can read twice.
    const s = computeScores({
      checks: null,
      lighthouse: null,
      analyze: analyze(["yes", "partial", "unknown", "unknown"]),
      probes: null,
    });
    // Judged: one yes, one partial → 1.5 of 2, not 1.5 of 4.
    expect(s.answers).toBe(75);
  });

  it("reports no answers score at all when nothing could be judged", () => {
    const s = computeScores({
      checks: null,
      lighthouse: null,
      analyze: analyze(["unknown", "unknown"]),
      probes: null,
    });
    expect(s.answers).toBeNull();
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

    // technical = neutral(0.5)*(2/3) + viewportOk(1)*(1/3) = 2/3
    // base01 = (40 + 10 + 15 + (2/3)*15) / 80 = 75/80 = 0.9375 → 94
    expect(unmeasured.findability).toBe(94);
    // technical = absent(0)*(2/3) + viewportOk(1)*(1/3) = 1/3
    // base01 = (40 + 10 + 15 + (1/3)*15) / 80 = 70/80 = 0.875 → 88
    expect(absent.findability).toBe(88);
    // The unmeasured case must score strictly higher than the confirmed-absent
    // case — "we didn't check" must never be graded as harshly as "we checked
    // and it's missing".
    expect(unmeasured.findability!).toBeGreaterThan(absent.findability!);
    // And it must not reach the full 100 either — neutral, not a free pass.
    expect(unmeasured.findability!).toBeLessThan(100);
  });

  // llms.txt used to be a quarter of the technical component — ~4.7 points of
  // findability — graded with the same confidence as sitemap.xml. Search
  // crawlers demonstrably consume a sitemap; no answer engine has documented
  // consuming llms.txt to build an answer. Marking a prospect down over a
  // proposal nobody has committed to reading was the one place this audit
  // asserted more than it knew, so the field is measured, reported as a
  // footnote, and scored nowhere.
  //
  // This asserts the invariant directly rather than pinning a number: every
  // combination of the two llms fields must produce an identical score.
  it("gives llms.txt no weight in any score, in any state", () => {
    const states: Pick<ChecksResult, "llmsTxtMeasured" | "llmsTxtPresent">[] = [
      { llmsTxtMeasured: true, llmsTxtPresent: true },
      { llmsTxtMeasured: true, llmsTxtPresent: false },
      { llmsTxtMeasured: false, llmsTxtPresent: false },
    ];
    const scored = states.map((s) =>
      computeScores({
        checks: { ...perfectChecks, ...s },
        lighthouse: null,
        analyze: null,
        probes: null,
      }),
    );
    for (const s of scored) expect(s).toEqual(scored[0]);
    // And a perfect site is now a clean 100 — it used to be gated at 98 unless
    // it happened to publish a file nobody reads.
    expect(scored[0]!.findability).toBe(100);
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
    //   technical = sitemapPresent(1)*(2/3) + viewportOk(0)*(1/3) = 2/3
    //   base01 = (1/3*40 + 0*10 + 0.75*15 + (2/3)*15) / 80
    //          = (13.3333... + 0 + 11.25 + 10) / 80 = 34.5833.../80 = 0.4322916...
    //   findability = round(0.4322916... * 100) = round(43.22916...) = 43
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
    expect(s.findability).toBe(43);
    expect(s.readability).toBe(61);
  });
});
