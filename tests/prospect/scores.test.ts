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
  sitemapPresent: true,
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
  business: "Acme",
  entityClarity: { score: 80, missing: [] },
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

const probes: ProbesResult = { answers: [], visibilityScore: 42, competitorsSeen: [] };

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
});
