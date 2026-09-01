// Item 6: pipeline.test.ts stops at the ProspectAuditResult object;
// render.test.ts hand-builds its own fixture ProspectAuditResult and never
// runs the real pipeline. Nothing proves what the real pipeline actually
// EMITS renders into a coherent document — this is the customer-facing
// artifact a small-business owner opens from a cold email, so it gets one
// black-box rehearsal: real runProspectAudit, stubbed network/model deps,
// straight into the real renderProspectReport.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runProspectAudit, type PipelineDeps } from "../../src/prospect/pipeline.js";
import { renderProspectReport } from "../../src/prospect/render.js";
import type { CrawlDeps, FetchResponse } from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

const HOME = "https://riversideplumbing.example/";

// The rendered DOM carries a reviews widget the raw HTML never does — same
// late-injected-content shape as the checks.test.ts messy.html coverage
// (Item 5), so this rehearsal exercises a realistic, partially JS-dependent
// site, not the hand-perfect fixture render.test.ts otherwise always sees.
const messyRendered = fixture("messy.html").replace(
  "</body>",
  `<div class="elementor-widget elementor-widget-reviews">
    <h3 class="elementor-heading-title">What our customers say</h3>
    <p>Riverside Plumbing showed up within the hour and fixed our water heater the same day — five stars.</p>
  </div></body>`,
);

const crawlDeps: CrawlDeps = {
  async fetchUrl(url): Promise<FetchResponse> {
    if (url === HOME) return { status: 200, body: fixture("messy.html"), headers: {} };
    // robots.txt / llms.txt / sitemap.xml, and anything else: genuinely
    // absent, exactly like a real site with none of those files.
    return { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, u === HOME ? messyRendered : fixture("messy.html")]));
  },
  maxPages: 5,
  delayMs: 0,
};

const deps: PipelineDeps = {
  crawl: crawlDeps,
  analyze: {
    run: async () => ({
      businessName: "Riverside Plumbing Co",
      business: "A 24/7 residential plumbing company serving Riverside County.",
      entityClarity: { score: 60, missing: ["service area map"] },
      buyerQuestions: [
        {
          question: "Do you offer emergency plumbing service?",
          answered: "yes" as const,
          quotable: true,
          page: HOME,
          evidence: "24/7 Emergency Plumbing in Riverside County",
        },
        {
          question: "What areas do you serve?",
          answered: "yes" as const,
          quotable: true,
          page: HOME,
          evidence: "Riverside County",
        },
        {
          question: "Do you fix water heaters?",
          answered: "yes" as const,
          quotable: true,
          page: HOME,
          evidence: "water heaters",
        },
        {
          question: "Are you licensed and insured?",
          answered: "no" as const,
          quotable: false,
          page: null,
          evidence: null,
        },
        {
          question: "Do you offer financing?",
          answered: "no" as const,
          quotable: false,
          page: null,
          evidence: null,
        },
        {
          question: "What is your response time?",
          answered: "partial" as const,
          quotable: false,
          page: HOME,
          evidence: "same day",
        },
      ],
      fixes: [
        {
          title: "Fix the malformed JSON-LD block",
          why: "One of two schema blocks on the homepage fails to parse.",
          impact: "high" as const,
          effort: "low" as const,
          tier: "technical" as const,
        },
        {
          title: "Add FAQ schema",
          why: "Answer engines quote FAQ blocks directly.",
          impact: "medium" as const,
          effort: "medium" as const,
          tier: "content" as const,
        },
      ],
      narrative: {
        findability: "Crawlers can reach the site, but two conflicting canonical tags exist.",
        readability:
          "Most of the copy is in the raw HTML; a reviews widget only appears after JavaScript runs.",
        answers: "Most buyer questions are answered on the homepage.",
      },
    }),
  },
  engines: [
    {
      name: "perplexity",
      ask: async (query: string) =>
        query.startsWith("who is")
          ? {
              answer: "Riverside Plumbing Co is a 24/7 residential plumber in Riverside County.",
              citedDomains: ["riversideplumbing.example"],
            }
          : {
              answer: "Several plumbers serve Riverside County; ABC Plumbing is often recommended.",
              citedDomains: ["abcplumbing.example"],
            },
    },
  ],
  // A genuine, realistic failure — proves the "no raw internal error text"
  // requirement holds inside a full real-pipeline round trip, not just in
  // render.test.ts's hand-built fixtures.
  lighthouse: async () => {
    throw new Error("lighthouse: npx exited with ENOENT (no chrome binary found)");
  },
  // The two network stages, stubbed for the same reason the crawl is: this
  // rehearsal is meant to be a closed system. Unstubbed, it fired real HTTP at
  // riversideplumbing.example on every run — a hostname that does not resolve,
  // so the suite's timing (and, on a resolver that hangs rather than refuses,
  // its outcome) depended on the runner's DNS rather than on the code.
  assets: {
    probe: async () => {
      throw new Error("network disabled in tests");
    },
  },
  basics: {
    probe: async () => {
      throw new Error("network disabled in tests");
    },
    probeAs: async () => {
      throw new Error("network disabled in tests");
    },
  },
  probeDelayMs: 0,
};

describe("end to end: runProspectAudit -> renderProspectReport", () => {
  it("renders a coherent, client-safe report from the real pipeline's output over a realistic fixture", async () => {
    const result = await runProspectAudit(HOME, {}, deps);
    const html = renderProspectReport(result);

    // The business name appears.
    expect(html).toContain("Riverside Plumbing Co");

    // The three site score cards are present; the AI Visibility card is
    // deliberately not (visibility is receipts, not a scorecard item).
    for (const label of ["Findability", "Readability", "Answers"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("AI Visibility");

    // No undefined/NaN/[object Object] leaks anywhere in the document.
    expect(html).not.toMatch(/\bundefined\b/);
    expect(html).not.toMatch(/\bNaN\b/);
    expect(html).not.toContain("[object Object]");

    // The lighthouse stage genuinely failed above — its raw error text must
    // not reach this document, only the client-safe phrase.
    expect(html).not.toContain("ENOENT");
    expect(html).not.toContain("no chrome binary found");
    expect(html).toMatch(/could not complete/i);

    // A complete, well-formed document.
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
