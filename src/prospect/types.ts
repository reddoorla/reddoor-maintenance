import type { AuditResult } from "../types.js";

/** Every pipeline stage resolves to this. A failed stage degrades its report
 *  section to "not measured" — it never kills the run (spec: error handling). */
export type StageResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type RobotsAgentAccess = {
  agent: string;
  /** May this agent fetch "/" per robots.txt? (No robots.txt → allowed.) */
  allowed: boolean;
  /** The deciding rule, e.g. "User-agent: GPTBot → Disallow: /". Null = no rule matched. */
  matchedRule: string | null;
};

export type PageExtract = {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  /** property/name → content for og:* and twitter:* metas. */
  social: Record<string, string>;
  /** `level` is 1-6 (H1-H6). */
  headings: { level: number; text: string }[];
  /** Raw text of each <script type="application/ld+json"> block. */
  jsonLd: string[];
  images: { total: number; withAlt: number };
  hasViewportMeta: boolean;
  /** Visible text, whitespace-collapsed. */
  text: string;
};

export type PageCapture = {
  url: string;
  /** HTTP status of the raw fetch. Null = the fetch itself failed. */
  status: number | null;
  /** Extract of the raw HTTP HTML (what non-JS crawlers see). */
  raw: PageExtract | null;
  /** Extract of the Playwright-rendered DOM (what a browser sees). */
  rendered: PageExtract | null;
  error: string | null;
};

export type CrawlResult = {
  /** Normalized origin, e.g. "https://example.com". */
  origin: string;
  robotsTxt: string | null;
  /** One entry per agent in crawl.ts's ALL_AGENTS (6 AI + 2 classical). */
  agentAccess: RobotsAgentAccess[];
  sitemap: { present: boolean; urlCount: number };
  llmsTxt: { present: boolean; firstLine: string | null };
  /** Per sidecar, the error that stopped us fetching it, or null. A fetch that
   *  FAILED must never be reported as "the site has no robots.txt" — that would
   *  claim the crawlers are unrestricted when we simply did not look. */
  sidecarErrors: { robots: string | null; llms: string | null; sitemap: string | null };
  /** Lower-cased homepage response headers (security-header check input). */
  homeHeaders: Record<string, string>;
  pages: PageCapture[];
};

export type ChecksResult = {
  /** False when the robots.txt fetch itself failed, so "no AI crawler is
   *  blocked" would be our silence rather than the site's answer. The report
   *  must say "not measured" for crawler access when this is false. */
  crawlerAccessMeasured: boolean;
  crawlerAccess: { blockedAi: string[]; allowedAi: string[]; blockedClassical: string[] };
  jsDependence: {
    /** 0..1 — fraction of rendered words absent from the raw HTML, averaged over pages. */
    avgMissing: number;
    perPage: {
      url: string;
      /** 0..1 — the same fraction as avgMissing, for this one page. */
      missing: number;
    }[];
  };
  schema: { typesFound: string[]; missingExpected: string[]; invalidBlocks: number };
  meta: {
    pageCount: number;
    missingTitle: number;
    missingDescription: number;
    missingCanonical: number;
    missingSocial: number;
  };
  headings: { pagesWithoutH1: number; pagesWithLevelSkips: number };
  securityHeaders: { present: string[]; missing: string[] };
  sitemapPresent: boolean;
  llmsTxtPresent: boolean;
  viewportOk: boolean;
};

export type BuyerQuestion = {
  question: string;
  answered: "yes" | "partial" | "no";
  /** Is there a passage an AI answer could quote verbatim? */
  quotable: boolean;
  page: string | null;
  evidence: string | null;
};

export type Fix = {
  title: string;
  why: string;
  impact: "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
  tier: "crawl" | "content" | "technical";
};

export type AnalyzeResult = {
  /** The model's read of what this company does, for whom, where. */
  business: string;
  entityClarity: { score: number; missing: string[] };
  buyerQuestions: BuyerQuestion[];
  fixes: Fix[];
  narrative: { findability: string; readability: string; answers: string };
};

export type ProbeAnswer = {
  engine: string;
  query: string;
  domainCited: boolean;
  brandMentioned: boolean;
  citedDomains: string[];
  /** First ~300 chars of the engine's answer — the report's receipt. */
  snippet: string;
};

export type ProbesResult = {
  answers: ProbeAnswer[];
  /** 0..100 — fraction of answers where the prospect was cited or mentioned. */
  visibilityScore: number;
  competitorsSeen: { domain: string; count: number }[];
};

export type LighthouseScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  summary: string;
  status: AuditResult["status"];
};

export type Scores = {
  findability: number | null;
  readability: number | null;
  answers: number | null;
  aiVisibility: number | null;
};

export type ProspectAuditResult = {
  url: string;
  business: string | null;
  generatedAt: string;
  scores: Scores;
  crawl: StageResult<CrawlResult>;
  checks: StageResult<ChecksResult>;
  lighthouse: StageResult<LighthouseScores>;
  analyze: StageResult<AnalyzeResult>;
  probes: StageResult<ProbesResult>;
};
