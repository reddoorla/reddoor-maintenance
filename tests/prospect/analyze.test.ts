import { describe, it, expect } from "vitest";
import { analyzeSite, buildAnalyzeInput, AnalyzeSchema } from "../../src/prospect/analyze.js";
import { runChecks } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";

function page(url: string, html: string): PageCapture {
  return { url, status: 200, raw: extractPage(html), rendered: extractPage(html), error: null };
}

const html = (title: string, body: string): string =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

function crawl(pageCount = 1): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: GPTBot\nDisallow: /",
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
      { agent: "ClaudeBot", allowed: true, matchedRule: null },
    ],
    sitemap: { present: true, urlCount: pageCount },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: Array.from({ length: pageCount }, (_, i) =>
      page(`https://acme.example/p${i}`, html(`Page ${i}`, `Body copy number ${i}.`)),
    ),
  };
}

const validOutput = {
  business: "Acme Roofing — commercial roofing in Boise, Idaho",
  entityClarity: { score: 72, missing: ["service area"] },
  buyerQuestions: [
    {
      question: "What does a roof repair cost?",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Most repairs run between $1,200 and $8,000",
    },
  ],
  fixes: [
    {
      title: "Unblock GPTBot",
      why: "robots.txt blocks it site-wide",
      impact: "high" as const,
      effort: "low" as const,
      tier: "crawl" as const,
    },
  ],
  narrative: { findability: "…", readability: "…", answers: "…" },
};

describe("buildAnalyzeInput", () => {
  it("puts the deterministic findings and each page's content in the prompt", () => {
    const c = crawl();
    const { system, user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(system).toContain("answer engine");
    expect(user).toContain("https://acme.example/p0");
    expect(user).toContain("Page 0");
    expect(user).toContain("Body copy number 0.");
    expect(user).toContain("GPTBot");
  });

  it("caps the page budget and the per-page text", () => {
    const c = crawl(20);
    c.pages[0]!.rendered!.text = "x".repeat(5000);
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toContain("https://acme.example/p11");
    expect(user).not.toContain("https://acme.example/p12");
    expect(user).not.toContain("x".repeat(2000));
  });

  it("never ships raw HTML to the model", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).not.toContain("<html>");
    expect(user).not.toContain("<h1>");
  });
});

describe("analyzeSite", () => {
  it("returns the validated model output", async () => {
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => validOutput,
    });
    expect(result.business).toContain("Acme Roofing");
    expect(result.buyerQuestions[0]!.answered).toBe("partial");
  });

  it("rejects output that does not match the schema", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => ({ ...validOutput, buyerQuestions: [{ question: "q" }] }),
      }),
    ).rejects.toThrow();
  });

  it("propagates a model failure so the stage degrades", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => {
          throw new Error("529 overloaded");
        },
      }),
    ).rejects.toThrow(/529/);
  });

  it("exports a schema that accepts the documented shape", () => {
    expect(() => AnalyzeSchema.parse(validOutput)).not.toThrow();
  });
});
