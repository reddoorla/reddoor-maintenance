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
    /** 0..1 — fraction of rendered words absent from the raw HTML, weighted by
     *  page size (total missing words / total rendered words across every
     *  comparable page) — or null when no page produced a comparable pair.
     *  Never 0 for "nothing measured": a page whose raw fetch was blocked, or
     *  whose rendered text tokenizes to nothing, drops out of the average
     *  rather than forcing it toward a false "perfectly crawlable". */
    avgMissing: number | null;
    perPage: {
      url: string;
      /** 0..1 — this page's own missing fraction (unweighted). */
      missing: number;
      /** Token count wordSet(rendered.text) produced for this page — the
       *  weight avgMissing gives it, and why a "coming soon" stub can't swing
       *  the headline number the way a full page does. */
      renderedWords: number;
    }[];
  };
  schema: { typesFound: string[]; missingExpected: string[]; invalidBlocks: number };
  meta: {
    pageCount: number;
    missingTitle: number;
    missingDescription: number;
    missingCanonical: number;
    missingSocial: number;
    /** Pages where neither the raw nor the rendered fetch produced an extract
     *  — excluded from pageCount and every other meta denominator above, so a
     *  report reading "1 of 2 pages missing a description" doesn't silently
     *  hide the third page that produced nothing at all. */
    pagesWithoutExtract: number;
  };
  headings: { pagesWithoutH1: number; pagesWithLevelSkips: number };
  securityHeaders: { present: string[]; missing: string[] };
  /** False when the sitemap.xml fetch itself failed (crawl.sidecarErrors.sitemap
   *  !== null), so `sitemapPresent: false` would otherwise read as "confirmed
   *  absent" rather than "we never got an answer". The report must say "not
   *  measured" for sitemap presence when this is false, and computeScores must
   *  treat it as neutral rather than penalizing the technical component for a
   *  fetch we could not complete. */
  sitemapMeasured: boolean;
  sitemapPresent: boolean;
  /** Same as sitemapMeasured, for the llms.txt fetch (crawl.sidecarErrors.llms). */
  llmsTxtMeasured: boolean;
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
  /** The business's proper name, as a searchable proper noun — "Acme Roofing",
   *  not a description of it. Empty string when the site never states one,
   *  which is itself a finding. This is what the visibility probes query and
   *  brand-match against; `business` below is prose and unsearchable. */
  businessName: string;
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
  /** "branded" ("who is X" / "X reviews") always echoes the name back even when
   *  an engine knows nothing real, so it cannot be trusted as a discoverability
   *  signal. "category" is a real buyer question — the one the score is built
   *  from. "competitor" is a head-to-head comparison query. */
  kind: "branded" | "category" | "competitor";
  domainCited: boolean;
  brandMentioned: boolean;
  citedDomains: string[];
  /** First ~300 chars of the engine's answer — the report's receipt. */
  snippet: string;
  /** True when `snippet` is a truncated prefix of a longer answer — set
   *  right where the truncation happens (probes.ts's SNIPPET_CHARS), so the
   *  renderer never has to re-derive "was this cut short?" from a length
   *  check of its own against a constant it can't see. */
  truncated: boolean;
  /** ISO-8601, set when the answer came back — this stage's whole output is
   *  quotable claims about a live third party, and answer engines' answers
   *  drift, so a disputed line in a report needs a date attached. */
  askedAt: string;
};

export type ProbesResult = {
  answers: ProbeAnswer[];
  /** 0..100 — fraction of CATEGORY answers (real buyer questions) where the
   *  prospect was cited or mentioned. Null — never 0 — when no category query
   *  ran at all, e.g. the analyze stage failed and supplied no buyer questions.
   *  Deliberately excludes branded answers: "who is X"/"X reviews" echo the name
   *  back even when the engine knows nothing real, which would put a floor
   *  under the score that has nothing to do with discoverability. */
  visibilityScore: number | null;
  /** Did any branded query produce a real citation of the prospect's own
   *  domain — not merely an echo of the name in prose. Reported separately from
   *  visibilityScore because it answers a different question ("does the engine
   *  know this business exists at all") from the one the score answers ("would
   *  it surface this business to someone who didn't already name it"). */
  brandedRecognized: boolean;
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
  /** The resolved searchable proper NOUN — "Acme Roofing", not a description
   *  of it (mirrors `AnalyzeResult.businessName`, the value this is usually
   *  copied from). Distinct from `AnalyzeResult.business` (prose, nested
   *  under `analyze.data`) — the two share a root name only because they're
   *  one level apart, not because they hold the same kind of value. Null
   *  when no name was ever resolved (operator override empty, model returned
   *  none) — itself a finding, not an error. Persisted verbatim into the
   *  database's `business` COLUMN (kept as-is; a rename there would need its
   *  own migration for no benefit) — map at that one boundary, not here. */
  businessName: string | null;
  generatedAt: string;
  scores: Scores;
  /** The crawl is the one fatal stage (see pipeline.ts): a crawl failure
   *  throws before a ProspectAuditResult is ever built, so the `ok:false`
   *  branch of StageResult can never appear here. Narrowed to the success
   *  shape only, so consumers never handle the impossible branch. */
  crawl: { ok: true; data: CrawlResult };
  checks: StageResult<ChecksResult>;
  lighthouse: StageResult<LighthouseScores>;
  analyze: StageResult<AnalyzeResult>;
  probes: StageResult<ProbesResult>;
};
