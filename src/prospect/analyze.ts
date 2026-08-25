import { z } from "zod";
import type { AnalyzeResult, ChecksResult, CrawlResult } from "./types.js";

/** Bounds on what reaches the model: enough site to judge, small enough to stay
 *  inside one ~$0.50 call. */
const MAX_PAGES = 12;
const MAX_TEXT_CHARS = 1500;

export const AnalyzeSchema = z.object({
  business: z.string(),
  entityClarity: z.object({ score: z.number(), missing: z.array(z.string()) }),
  buyerQuestions: z.array(
    z.object({
      question: z.string(),
      answered: z.enum(["yes", "partial", "no"]),
      quotable: z.boolean(),
      page: z.string().nullable(),
      evidence: z.string().nullable(),
    }),
  ),
  fixes: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      effort: z.enum(["low", "medium", "high"]),
      tier: z.enum(["crawl", "content", "technical"]),
    }),
  ),
  narrative: z.object({
    findability: z.string(),
    readability: z.string(),
    answers: z.string(),
  }),
});

const SYSTEM = `You are an AEO/SEO analyst at Reddoor Creative reviewing a prospect's website.

Judge ONLY from the page content given to you — it is what a crawler can actually read. If you cannot
tell what the business does from that content, say so plainly: that IS the finding, because an answer engine
is working from the same material.

Return:
- business: what this company does, for whom, and where, in one or two sentences.
- entityClarity: 0-100 for how unambiguously the site establishes who/where/what it offers, plus the
  specific things missing.
- buyerQuestions: 6-10 questions a real buyer in this category asks before hiring. For each, whether
  the site answers it (yes/partial/no), whether there is a passage an AI could quote verbatim, the page
  it lives on, and the evidence quote (or null).
- fixes: prioritized, concrete, specific to this site. No generic SEO advice.
- narrative: two or three plain sentences per report section, addressed to the business owner. No
  jargon, no hedging.`;

function summarizeFindings(checks: ChecksResult): string {
  const blocked = checks.crawlerAccess.blockedAi;
  return [
    `Blocked AI crawlers: ${blocked.length ? blocked.join(", ") : "none"}`,
    `Blocked classical crawlers: ${
      checks.crawlerAccess.blockedClassical.length
        ? checks.crawlerAccess.blockedClassical.join(", ")
        : "none"
    }`,
    `Content only present after JavaScript runs: ${
      checks.jsDependence.avgMissing === null
        ? "not measured"
        : `${Math.round(checks.jsDependence.avgMissing * 100)}%`
    }`,
    `Schema types found: ${checks.schema.typesFound.join(", ") || "none"}`,
    `Expected schema missing: ${checks.schema.missingExpected.join(", ") || "none"}`,
    `Pages missing a description: ${checks.meta.missingDescription}/${checks.meta.pageCount}`,
    `Pages without an h1: ${checks.headings.pagesWithoutH1}/${checks.meta.pageCount}`,
    `sitemap.xml: ${checks.sitemapPresent ? "present" : "missing"} · llms.txt: ${
      checks.llmsTxtPresent ? "present" : "missing"
    }`,
  ].join("\n");
}

/** Build the (system, user) pair. Pure — no network, fully assertable. */
export function buildAnalyzeInput(
  url: string,
  crawl: CrawlResult,
  checks: ChecksResult,
): { system: string; user: string } {
  const pages = crawl.pages.slice(0, MAX_PAGES).map((p) => {
    const view = p.rendered ?? p.raw;
    const headings = view?.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n") ?? "";
    const text = (view?.text ?? "").slice(0, MAX_TEXT_CHARS);
    return [
      `URL: ${p.url}`,
      `Title: ${view?.title ?? "(none)"}`,
      `Description: ${view?.metaDescription ?? "(none)"}`,
      headings ? `Headings:\n${headings}` : "Headings: (none)",
      `Text: ${text || "(no text without JavaScript)"}`,
    ].join("\n");
  });

  const user = [
    `Site: ${url}`,
    "",
    "## What the automated checks found",
    summarizeFindings(checks),
    "",
    "## Pages",
    pages.join("\n\n---\n\n"),
  ].join("\n");

  return { system: SYSTEM, user };
}

export type AnalyzeDeps = {
  run: (input: { system: string; user: string }) => Promise<unknown>;
};

/** The real call: one Opus 5 request with adaptive thinking and a schema-constrained
 *  response. Imported lazily so the SDK never loads for a `--no-probes`-style run
 *  that never reaches this stage, nor for any other CLI command. */
export function defaultAnalyzeDeps(): AnalyzeDeps {
  return {
    async run({ system, user }) {
      const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
        import("@anthropic-ai/sdk"),
        import("@anthropic-ai/sdk/helpers/zod"),
      ]);
      const client = new Anthropic();
      const res = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(AnalyzeSchema) },
      });
      if (!res.parsed_output) throw new Error("analyze: the model returned no parsed output");
      return res.parsed_output;
    },
  };
}

export async function analyzeSite(
  url: string,
  crawl: CrawlResult,
  checks: ChecksResult,
  deps: AnalyzeDeps = defaultAnalyzeDeps(),
): Promise<AnalyzeResult> {
  const raw = await deps.run(buildAnalyzeInput(url, crawl, checks));
  return AnalyzeSchema.parse(raw);
}
