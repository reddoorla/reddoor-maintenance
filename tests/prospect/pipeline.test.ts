import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  runProspectAudit,
  PROBES_SKIPPED,
  ANALYZE_SKIPPED,
  type PipelineDeps,
} from "../../src/prospect/pipeline.js";
import type { CrawlDeps, FetchResponse } from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

const HOME = "https://acme.example/";

const crawlDeps = (over: Partial<CrawlDeps> = {}): CrawlDeps => ({
  async fetchUrl(url): Promise<FetchResponse> {
    if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
    if (url.endsWith("/services") || url.endsWith("/about"))
      return { status: 200, body: fixture("rich.html"), headers: {} };
    return { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, fixture("rich.html")]));
  },
  maxPages: 5,
  delayMs: 0,
  ...over,
});

// AnalyzeSchema requires 6-10 buyer questions (analyze.ts) — all "yes" here so
// scores.answers (checks.ts computeScores) lands on a deterministic 100.
const analyzeOutput = {
  businessName: "Acme Roofing",
  business: "Acme Roofing repairs and replaces commercial roofs in Boise, Idaho.",
  entityClarity: { score: 70, missing: [] },
  buyerQuestions: [
    {
      question: "How much does a roof repair cost?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
    {
      question: "Do you offer free estimates?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
    {
      question: "What areas do you service?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
    {
      question: "Are you licensed and insured?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
    {
      question: "Do you handle emergency repairs?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
    {
      question: "What kind of warranty do you offer?",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "…",
    },
  ],
  fixes: [
    {
      title: "Add FAQ schema",
      why: "…",
      impact: "high" as const,
      effort: "low" as const,
      tier: "content" as const,
    },
  ],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

const deps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  crawl: crawlDeps(),
  analyze: { run: async () => analyzeOutput },
  engines: [
    {
      name: "perplexity",
      ask: async () => ({ answer: "Acme Roofing", citedDomains: ["acme.example"] }),
    },
  ],
  lighthouse: async () => ({
    performance: 80,
    accessibility: 90,
    bestPractices: 70,
    seo: 100,
    summary: "lighthouse: all categories passing",
    status: "pass" as const,
  }),
  // Real ProbeRunOptions pacing (probes.ts's pacedEach) genuinely sleeps
  // between queries — 0 keeps this offline suite from spending seconds on it.
  probeDelayMs: 0,
  ...over,
});

describe("runProspectAudit", () => {
  it("returns every stage populated on a healthy run", async () => {
    const result = await runProspectAudit(HOME, {}, deps());
    expect(result.url).toBe(HOME);
    expect(result.businessName).toBe("Acme Roofing");
    expect(result.crawl.ok).toBe(true);
    expect(result.checks.ok).toBe(true);
    expect(result.lighthouse.ok).toBe(true);
    expect(result.analyze.ok).toBe(true);
    expect(result.probes.ok).toBe(true);
    expect(result.scores.findability).toBeGreaterThan(0);
    expect(result.scores.answers).toBe(100);
    expect(result.scores.aiVisibility).toBe(100);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("prefers the operator's business name over the model's", async () => {
    const result = await runProspectAudit(HOME, { business: "Acme Roofing LLC" }, deps());
    expect(result.businessName).toBe("Acme Roofing LLC");
  });

  it("degrades the analyze section and its score, keeping the rest", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.analyze).toEqual({ ok: false, error: "529 overloaded" });
    expect(result.scores.answers).toBeNull();
    expect(result.checks.ok).toBe(true);
    expect(result.scores.readability).not.toBeNull();
  });

  it("degrades lighthouse without touching the other scores", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        lighthouse: async () => {
          throw new Error("npx unavailable");
        },
      }),
    );
    expect(result.lighthouse.ok).toBe(false);
    expect(result.scores.findability).not.toBeNull();
  });

  it("skips probes entirely when asked", async () => {
    const result = await runProspectAudit(HOME, { probes: false }, deps());
    expect(result.probes).toEqual({ ok: false, error: PROBES_SKIPPED });
    expect(result.scores.aiVisibility).toBeNull();
  });

  it("still runs probes when the analyze stage failed", async () => {
    const result = await runProspectAudit(
      HOME,
      { business: "Acme Roofing" },
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.probes.ok).toBe(true);
  });

  it("throws when the site is unreachable — nothing to persist", async () => {
    await expect(
      runProspectAudit(
        HOME,
        {},
        deps({
          crawl: crawlDeps({ fetchUrl: async () => ({ status: 500, body: "", headers: {} }) }),
        }),
      ),
    ).rejects.toThrow(/500/);
  });

  it("reports stage progress to the caller", async () => {
    const seen: string[] = [];
    await runProspectAudit(
      HOME,
      {},
      { ...deps(), onStage: (name, status) => seen.push(`${name}:${status}`) },
    );
    expect(seen).toContain("crawl:ok");
    expect(seen).toContain("probes:ok");
  });

  it("degrades checks — and the cascading analyze skip — while probes still run", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        checks: () => {
          throw new Error("checks blew up");
        },
      }),
    );
    expect(result.checks).toEqual({ ok: false, error: "checks blew up" });
    expect(result.analyze).toEqual({ ok: false, error: ANALYZE_SKIPPED });
    expect(result.probes.ok).toBe(true);
    // findability/readability need a successful checks stage; answers needs
    // buyer questions, which only a successful analyze stage supplies — all
    // three are structurally null here. aiVisibility depends only on probes,
    // which ran, but with zero buyer questions probes.ts's buildQueries never
    // produces a "category" query (only "branded"/"competitor"), so
    // visibilityScore — and this score — are null too: nothing here actually
    // measured discoverability for a real buyer question.
    expect(result.scores.findability).toBeNull();
    expect(result.scores.readability).toBeNull();
    expect(result.scores.answers).toBeNull();
    expect(result.scores.aiVisibility).toBeNull();
  });

  it("falls back to the domain when the model returns no business name", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        analyze: { run: async () => ({ ...analyzeOutput, businessName: "" }) },
      }),
    );
    // An empty businessName is itself a finding (AnalyzeSchema allows it) —
    // the operator supplied no override either, so there is no name to report.
    expect(result.businessName).toBeNull();
    expect(result.probes.ok).toBe(true);
    if (result.probes.ok) {
      // resolveBusinessName (probes.ts) falls back to domainOf(url) rather
      // than querying an empty string.
      expect(result.probes.data.answers.some((a) => a.query.includes("acme.example"))).toBe(true);
      expect(result.probes.data.answers.some((a) => a.query.includes("Acme Roofing"))).toBe(false);
    }
  });
});
