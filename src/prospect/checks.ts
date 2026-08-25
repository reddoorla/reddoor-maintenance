import { AI_AGENTS, CLASSICAL_AGENTS } from "./crawl.js";
import type { ChecksResult, CrawlResult, PageCapture, PageExtract } from "./types.js";

/** The canonical header set the fleet's own netlify.toml template ships
 *  (src/recipes/sync-configs/templates.ts) — the same bar we hold our sites to. */
export const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

/** Schema types a business site is expected to declare, each with the concrete
 *  types that satisfy it. */
const EXPECTED_SCHEMA: { label: string; satisfiedBy: string[] }[] = [
  {
    label: "Organization",
    satisfiedBy: ["Organization", "LocalBusiness", "ProfessionalService", "Corporation"],
  },
  { label: "Service", satisfiedBy: ["Service", "Product", "Offer"] },
  { label: "FAQPage", satisfiedBy: ["FAQPage", "QAPage"] },
  { label: "Article", satisfiedBy: ["Article", "BlogPosting", "NewsArticle"] },
];

/** What a non-JS crawler sees. Falls back to the rendered DOM only when the raw
 *  fetch failed — otherwise the audit would grade the site on content its
 *  readers can't reach. */
function crawlerView(p: PageCapture): PageExtract | null {
  return p.raw ?? p.rendered;
}

/** Content words, deduped — the unit the JS-dependence delta is measured in.
 *  Unicode-aware (\p{L}/\p{N}) rather than ASCII-only: a page in Chinese,
 *  Japanese, Korean, Thai, Arabic, Hebrew or Russian must still tokenize to a
 *  non-empty set. An ASCII-only split silently emptied on those scripts, the
 *  page then dropped out of every average, and a site nobody measured read as
 *  "0% JS-dependent" — a false compliment, not a neutral non-result. Scripts
 *  written without spaces (CJK) still tokenize per \p{L} run rather than per
 *  linguistic word, so the resulting delta is directional, not precise, for
 *  those pages — a known limit, not a bug. */
function wordSet(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? []).filter((w) => w.length >= 3),
  );
}

const MAX_SCHEMA_DEPTH = 8;

/** schema.org types are sometimes written as the full URL
 *  ("https://schema.org/LocalBusiness") instead of the bare name — both are
 *  valid JSON-LD, so both must compare equal against EXPECTED_SCHEMA's plain
 *  labels. */
function normalizeSchemaType(raw: string): string {
  return raw.replace(/^https?:\/\/schema\.org\//i, "");
}

/** Recurses into every object/array value, not an allowlist of keys — a type
 *  can nest under `publisher`, `author`, `address`, or anything else the
 *  schema author chose, and an allowlist of `@graph`/`mainEntity`/
 *  `itemListElement` missed all of those, reporting schema a prospect
 *  actually has as absent. Depth-limited so a pathological document can't
 *  blow the stack. */
function collectTypes(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > MAX_SCHEMA_DEPTH) return;
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, into, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") into.add(normalizeSchemaType(t));
  else if (Array.isArray(t)) {
    for (const x of t) if (typeof x === "string") into.add(normalizeSchemaType(x));
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === "@type") continue;
    if (value && typeof value === "object") collectTypes(value, into, depth + 1);
  }
}

export function runChecks(crawl: CrawlResult): ChecksResult {
  // A failed robots.txt fetch means we never learned the real rules — reporting
  // every agent as "allowed" would turn our own transport failure into a false
  // all-clear about the prospect's site. Leave the lists empty and say so.
  const crawlerAccessMeasured = crawl.sidecarErrors.robots === null;
  const aiSet = new Set<string>(AI_AGENTS);
  const classicalSet = new Set<string>(CLASSICAL_AGENTS);
  const blockedAi: string[] = [];
  const allowedAi: string[] = [];
  const blockedClassical: string[] = [];
  if (crawlerAccessMeasured) {
    for (const a of crawl.agentAccess) {
      if (aiSet.has(a.agent)) (a.allowed ? allowedAi : blockedAi).push(a.agent);
      else if (classicalSet.has(a.agent) && !a.allowed) blockedClassical.push(a.agent);
    }
  }

  const perPage: { url: string; missing: number; renderedWords: number }[] = [];
  let totalRenderedWords = 0;
  let totalMissingWords = 0;
  for (const p of crawl.pages) {
    if (!p.raw || !p.rendered) continue;
    const renderedWords = wordSet(p.rendered.text);
    if (renderedWords.size === 0) continue;
    const rawWords = wordSet(p.raw.text);
    let missing = 0;
    for (const w of renderedWords) if (!rawWords.has(w)) missing++;
    perPage.push({
      url: p.url,
      missing: missing / renderedWords.size,
      renderedWords: renderedWords.size,
    });
    totalRenderedWords += renderedWords.size;
    totalMissingWords += missing;
  }
  // Weighted by page size (total missing words / total rendered words), not a
  // plain mean of per-page fractions — an unweighted mean lets a two-word
  // "coming soon" stub swing the headline number as hard as a 2,000-word page
  // that's fully crawlable. Null, never 0, when nothing was comparable: 0
  // reads as "measured and clean", which a page that produced no data has no
  // right to claim.
  const avgMissing = totalRenderedWords === 0 ? null : totalMissingWords / totalRenderedWords;

  const types = new Set<string>();
  let invalidBlocks = 0;
  for (const p of crawl.pages) {
    const view = crawlerView(p);
    if (!view) continue;
    for (const block of view.jsonLd) {
      try {
        collectTypes(JSON.parse(block), types);
      } catch {
        invalidBlocks++;
      }
    }
  }
  const typesFound = [...types];
  const missingExpected = EXPECTED_SCHEMA.filter(
    (e) => !e.satisfiedBy.some((t) => types.has(t)),
  ).map((e) => e.label);

  const crawlerViews = crawl.pages.map(crawlerView);
  const views = crawlerViews.filter((v): v is PageExtract => v !== null);
  // A page whose raw AND rendered fetch both failed produced no extract at
  // all — it must not just quietly drop out of pageCount and every ratio
  // below it, or a report saying "1 of 2 pages missing a description" reads
  // as a complete audit when a third page produced nothing.
  const pagesWithoutExtract = crawlerViews.filter((v) => v === null).length;
  const meta = {
    pageCount: views.length,
    missingTitle: views.filter((v) => !v.title).length,
    missingDescription: views.filter((v) => !v.metaDescription).length,
    missingCanonical: views.filter((v) => !v.canonical).length,
    // Twitter/X falls back to Open Graph tags when its own twitter:* meta is
    // absent, so og:title/og:image alone are the meaningful "social preview
    // exists" signal — checking twitter:* here would flag pages that already
    // render a correct card via OG as missing.
    missingSocial: views.filter((v) => !v.social["og:title"] && !v.social["og:image"]).length,
    pagesWithoutExtract,
  };

  const headings = {
    pagesWithoutH1: views.filter((v) => !v.headings.some((h) => h.level === 1)).length,
    // A page that starts at h3 (no h1) is already counted by pagesWithoutH1
    // above; the loop below only starts comparing once `prev` is set by a
    // FIRST heading, so a bare "no h1" page is never double-reported here as
    // a level skip too — those are two different gaps with two different
    // fixes, not one gap wearing two hats.
    pagesWithLevelSkips: views.filter((v) => {
      let prev = 0;
      for (const h of v.headings) {
        if (prev && h.level > prev + 1) return true;
        prev = h.level;
      }
      return false;
    }).length,
  };

  const present = SECURITY_HEADERS.filter((h) => h in crawl.homeHeaders);
  return {
    crawlerAccessMeasured,
    crawlerAccess: { blockedAi, allowedAi, blockedClassical },
    jsDependence: { avgMissing, perPage },
    schema: { typesFound, missingExpected, invalidBlocks },
    meta,
    headings,
    securityHeaders: { present, missing: SECURITY_HEADERS.filter((h) => !present.includes(h)) },
    sitemapPresent: crawl.sitemap.present,
    llmsTxtPresent: crawl.llmsTxt.present,
    viewportOk: views.length > 0 && views.every((v) => v.hasViewportMeta),
  };
}
