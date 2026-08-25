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

/** Content words, deduped — the unit the JS-dependence delta is measured in. */
function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 3),
  );
}

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") into.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") into.add(x);
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    if (key in obj) collectTypes(obj[key], into);
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

  const perPage: { url: string; missing: number }[] = [];
  for (const p of crawl.pages) {
    if (!p.raw || !p.rendered) continue;
    const renderedWords = wordSet(p.rendered.text);
    if (renderedWords.size === 0) continue;
    const rawWords = wordSet(p.raw.text);
    let missing = 0;
    for (const w of renderedWords) if (!rawWords.has(w)) missing++;
    perPage.push({ url: p.url, missing: missing / renderedWords.size });
  }
  const avgMissing =
    perPage.length === 0 ? 0 : perPage.reduce((s, p) => s + p.missing, 0) / perPage.length;

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

  const views = crawl.pages.map(crawlerView).filter((v): v is PageExtract => v !== null);
  const meta = {
    pageCount: views.length,
    missingTitle: views.filter((v) => !v.title).length,
    missingDescription: views.filter((v) => !v.metaDescription).length,
    missingCanonical: views.filter((v) => !v.canonical).length,
    missingSocial: views.filter((v) => !v.social["og:title"] && !v.social["og:image"]).length,
  };

  const headings = {
    pagesWithoutH1: views.filter((v) => !v.headings.some((h) => h.level === 1)).length,
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
