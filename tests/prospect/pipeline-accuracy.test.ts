import { describe, expect, it } from "vitest";
import { runProspectAudit, ACCURACY_SKIPPED } from "../../src/prospect/pipeline.js";
import { checkAccuracy } from "../../src/prospect/accuracy.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CrawlDeps, FetchResponse } from "../../src/prospect/crawl.js";

/**
 * The accuracy stage answers the question the whole report is now named for:
 * when an engine describes this business, where is it getting that from.
 *
 * It was written, tested and left unwired for a fortnight — computed by nobody,
 * rendered nowhere. These tests pin the wiring, and in particular the two ways
 * it must decline to run rather than produce a confident empty result.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

const HOME = "https://acme.example/";

const crawlDeps = (): CrawlDeps => ({
  async fetchUrl(url): Promise<FetchResponse> {
    return url === HOME || url.endsWith("/services") || url.endsWith("/about")
      ? { status: 200, body: fixture("rich.html"), headers: {} }
      : { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, fixture("rich.html")]));
  },
  maxPages: 3,
  delayMs: 0,
});

const analyzeOutput = {
  businessName: "Acme Roofing",
  business: "Acme Roofing repairs commercial roofs.",
  entityClarity: { score: 70, missing: [] },
  primaryGoal: "enquire" as const,
  categoryQueries: ["commercial roofing boise", "flat roof repair idaho", "roof replacement cost"],
  buyerQuestions: [
    { id: "cost", answered: "no" as const, quotable: false, page: null, evidence: null },
  ],
  fixes: [],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

/** A branded answer kept whole — the only kind accuracy can read. */
const brandedEngine = (fullAnswer: string | undefined) => [
  {
    name: "claude",
    ask: async () => ({
      answer: "Acme Roofing is a commercial roofer that has served Boise since 1994.",
      ...(fullAnswer === undefined ? {} : { fullAnswer }),
      citedDomains: ["yelp.com"],
    }),
  },
];

function deps(over: Record<string, unknown> = {}) {
  return {
    crawl: crawlDeps(),
    analyze: { run: async () => analyzeOutput },
    engines: brandedEngine("Acme Roofing has served Boise since 1994."),
    lighthouse: async () => {
      throw new Error("skipped in test");
    },
    probeDelayMs: 0,
    accuracy: {
      run: async () => ({
        assertions: [
          {
            claim: "Serving Boise since 1994",
            engineQuote: "has served Boise since 1994",
            verdict: "absent" as const,
            siteQuote: null,
            searchTerms: ["1994"],
          },
        ],
      }),
      ownership: { fetchPage: async () => null },
    },
    ...over,
  };
}

describe("runProspectAudit — the accuracy stage", () => {
  it("runs and lands on the result", async () => {
    const result = await runProspectAudit(HOME, { goal: "enquire" }, deps());
    const acc = result.accuracy;
    if (!acc?.ok) throw new Error(`accuracy did not run: ${acc?.error}`);
    expect(acc.data.answersRead).toBeGreaterThan(0);
    expect(acc.data.assertions.length).toBeGreaterThan(0);
  });

  it("is skipped, not failed, when the probes did not run", async () => {
    // No branded answers means nothing to check. That is an absence of input,
    // not a finding — and certainly not "the engine said nothing wrong".
    const result = await runProspectAudit(HOME, { goal: "enquire", probes: false }, deps());
    expect(result.accuracy?.ok).toBe(false);
    expect(result.accuracy?.ok === false && result.accuracy.error).toBe(ACCURACY_SKIPPED);
  });

  it("reports nothing read for a stored answer that predates fullAnswer", async () => {
    // Not reachable through the pipeline — probes always keeps a branded answer
    // whole now — but every report stored before it did has branded answers
    // with no text to check claims against. The stage must say it read nothing
    // rather than return an empty, confident "we found no inaccuracies".
    const result = await checkAccuracy(
      HOME,
      { pages: [], origin: HOME } as never,
      [{ kind: "branded", query: "who is Acme", citedDomains: [] } as never],
      [],
      {
        run: async () => {
          throw new Error("the model must not be called when there is nothing to check");
        },
        ownership: { fetchPage: async () => null },
      },
    );
    expect(result.answersRead).toBe(0);
    expect(result.assertions).toEqual([]);
  });

  it("degrades to a failed stage rather than taking the audit down", async () => {
    const result = await runProspectAudit(
      HOME,
      { goal: "enquire" },
      deps({
        accuracy: {
          run: async () => {
            throw new Error("529 overloaded");
          },
          ownership: { fetchPage: async () => null },
        },
      }),
    );
    expect(result.accuracy?.ok).toBe(false);
    // Everything else still made it.
    expect(result.analyze.ok).toBe(true);
    expect(result.goalFit?.ok).toBe(true);
  });
});
