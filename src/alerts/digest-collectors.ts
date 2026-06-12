// src/alerts/digest-collectors.ts
import type { AttentionItem } from "../reports/digest.js";
import { siteSlug, type WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import type { OpenPullRequestsProbe, RenovateFailuresResult } from "./renovate.js";
import { makeGitHub } from "../github/gh.js";

/** Build the same `/s/<slug>` dashboard link the M3 ready-section uses, trailing-slash-safe. */
function dashboardUrl(baseUrl: string, siteName: string): string {
  return `${baseUrl.replace(/\/$/, "")}/s/${siteSlug(siteName)}`;
}

/**
 * One attention item per site carrying current critical+high vulns (medium/low omitted
 * per the locked threshold). PURE: takes already-fetched Websites rows. `metric` is the
 * critical+high count (so a rising count diffs as WORSE); `severity` is `critical` when
 * any critical exists, else `warning`. Null counts (never audited) read as 0 → skipped.
 */
export function collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    const metric = critical + high;
    if (metric <= 0) continue;
    items.push({
      key: `vuln:${s.id}`,
      kind: "vuln",
      siteName: s.name,
      title: `${metric} critical/high ${metric === 1 ? "vuln" : "vulns"}`,
      url: dashboardUrl(baseUrl, s.name),
      severity: critical > 0 ? "critical" : "warning",
      metric,
    });
  }
  return items;
}

/** Absolute floor below which a Lighthouse category is "Needs attention" (Tucker's call). */
const LIGHTHOUSE_FLOOR = 75;

/** The four Lighthouse categories, each mapped to its WebsiteRow score field, URL slug,
 *  and the human label rendered in the digest title. Order is the operator's reading order. */
const LIGHTHOUSE_CATEGORIES: ReadonlyArray<{
  field: "pScore" | "rScore" | "bpScore" | "seoScore";
  slug: string;
  label: string;
}> = [
  { field: "pScore", slug: "performance", label: "Performance" },
  { field: "rScore", slug: "accessibility", label: "Accessibility" },
  { field: "bpScore", slug: "best-practices", label: "Best Practices" },
  { field: "seoScore", slug: "seo", label: "SEO" },
];

/**
 * One attention item per Lighthouse category below the absolute floor (75) for each site.
 * PURE: takes already-fetched Websites rows. Categories are Performance/Accessibility/
 * Best-Practices/SEO. A null score (never audited) or a score >= 75 is skipped. The
 * `metric` is the DEFICIT (`100 - score`): a lower score → higher metric, so a category
 * that drops further diffs as WORSE and one that first crosses below 75 diffs as NEW —
 * which is how `diffAttention`'s "WORSE on increase" rule reads an inverted score. `key`
 * is `lighthouse:<siteId>:<categorySlug>`, so the four categories stay distinct per site.
 */
export function collectLighthouseAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    for (const cat of LIGHTHOUSE_CATEGORIES) {
      const score = s[cat.field];
      if (score === null || score >= LIGHTHOUSE_FLOOR) continue;
      items.push({
        key: `lighthouse:${s.id}:${cat.slug}`,
        kind: "lighthouse",
        siteName: s.name,
        title: `Lighthouse ${cat.label} ${score} (below ${LIGHTHOUSE_FLOOR})`,
        url: dashboardUrl(baseUrl, s.name),
        severity: "warning",
        metric: 100 - score,
      });
    }
  }
  return items;
}

/**
 * One attention item per report whose `deliveryStatus` is a failure (`bounced` or
 * `complained` — `delivered`/`pending` are ignored). PURE: takes already-fetched
 * Reports rows + a record-id→site map. A complaint ranks above a bounce (locked
 * threshold), so `severity` is `critical` for complained / `warning` for bounced.
 * `metric` is 1 (a binary event). Orphans (siteId not in the map) are skipped, as
 * the M3 ready-section does, so the digest never renders a broken link. The diff
 * key is the report RECORD id, so two failures on one site stay distinct.
 */
export function collectDeliveryFailures(
  reports: ReportRow[],
  sitesById: Map<string, WebsiteRow>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of reports) {
    if (r.deliveryStatus !== "bounced" && r.deliveryStatus !== "complained") continue;
    const site = sitesById.get(r.siteId);
    if (!site) continue; // orphan → skip rather than render a broken link
    const complained = r.deliveryStatus === "complained";
    items.push({
      key: `delivery:${r.id}`,
      kind: "delivery",
      siteName: site.name,
      title: complained ? "Spam complaint on a sent report" : "A sent report bounced",
      url: dashboardUrl(baseUrl, site.name),
      severity: complained ? "critical" : "warning",
      metric: 1,
    });
  }
  return items;
}

/**
 * One attention item per site carrying failing Renovate PRs, read from the
 * slice-2a-persisted `renovateFailingCis` field (NOT the live sweep — that's
 * `renovateFindingsToAttention`, used by the digest). PURE. `metric` is the
 * count (a rising count diffs WORSE); severity `warning`. Null/0 → skipped.
 */
export function collectRenovateAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const n = s.renovateFailingCis ?? 0;
    if (n <= 0) continue;
    items.push({
      key: `renovate:${s.id}`,
      kind: "renovate",
      siteName: s.name,
      title: `${n} Renovate ${n === 1 ? "PR" : "PRs"} failing CI`,
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: n,
    });
  }
  return items;
}

/**
 * One attention item per site whose persisted default-branch CI rollup is
 * `failing` (slice 2a). PURE. `metric` 1 (binary); severity `warning`. Any other
 * state (passing/pending/none) or null is skipped.
 */
export function collectCiAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (s.defaultBranchCi !== "failing") continue;
    items.push({
      key: `ci:${s.id}`,
      kind: "ci",
      siteName: s.name,
      title: "Default-branch CI failing",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}

/**
 * Map the renovate sweep result into attention items. PURE — takes the already-fetched
 * `RenovateFailuresResult` (the IO sweep lives in `collectRenovateFailures`). One item
 * per failing-CI Renovate PR (key `renovate:<repo>#<number>`, severity `warning`,
 * `metric` 1 — a binary event). When the sweep couldn't reach some repos, append ONE
 * roll-up note keyed `renovate:skipped` whose `metric` is the skipped count, so it
 * diffs as WORSE when MORE repos fail to check (a widening blind spot, not a new alert).
 */
export function renovateFindingsToAttention(result: RenovateFailuresResult): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const f of result.findings) {
    items.push({
      key: `renovate:${f.repo}#${f.pr.number}`,
      kind: "renovate",
      siteName: f.site,
      title: `Renovate update failing CI: ${f.pr.title}`,
      url: f.pr.url,
      severity: "warning",
      metric: 1,
    });
  }
  if (result.skipped.length > 0) {
    items.push({
      key: "renovate:skipped",
      kind: "renovate",
      siteName: "Fleet checks",
      title: `Couldn't check ${result.skipped.length} repo(s) for failing Renovate PRs`,
      severity: "warning",
      metric: result.skipped.length,
    });
  }
  return items;
}

/**
 * Build the live GitHub probe the renovate sweep needs, or `undefined` when no token
 * is available. Reads `RENOVATE_TOKEN` (the org secret with fleet read access),
 * falling back to `GH_TOKEN`; a local/no-token run gets `undefined` so the renovate
 * sweep is simply skipped (no error, no empty section noise).
 */
export function buildRenovateProbe(): OpenPullRequestsProbe | undefined {
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return undefined;
  return makeGitHub({ token }).openPullRequests;
}
