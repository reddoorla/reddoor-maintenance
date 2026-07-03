// src/alerts/digest-collectors.ts
import type { AttentionItem } from "./attention.js";
import { siteSlug, type WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { approveBlockers } from "../reports/preflight.js";

/** Build the same `/s/<slug>` dashboard link the M3 ready-section uses, trailing-slash-safe.
 *  An empty Name slugs to "" and `/s/` is a dead link — fall back to the fleet homepage,
 *  exactly like the ready-section does. */
function dashboardUrl(baseUrl: string, siteName: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const slug = siteSlug(siteName);
  return slug ? `${root}/s/${slug}` : root;
}

/**
 * A GitHub-signals sweep older than this (or never run) is no longer trustworthy:
 * a repo whose nightly probe THREW stops being re-swept, so its persisted
 * `Default Branch CI` / `Renovate Failing CIs` freeze at their last value forever
 * — a phantom 🔴 that can never clear. 3 days ≈ 3× the daily sweep interval, so a
 * single missed/flaky run doesn't drop a real signal. The CI/Renovate collectors
 * (only) skip a site whose `githubSignalsAt` is staler than this. Vuln/Lighthouse/
 * delivery signals come from other sweeps and are unaffected.
 */
const GITHUB_SIGNALS_STALE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when a site's GitHub-signals sweep is too old (or never ran) to trust the
 *  persisted CI/Renovate fields. A null `githubSignalsAt` (never swept) is stale —
 *  there's no sweep to vouch for the values. A future timestamp (now - swept < 0)
 *  is fresh. `now` is injected so the gate is testable. */
function gitHubSignalsStale(swept: string | null, now: Date): boolean {
  if (swept === null) return true;
  const ageMs = now.getTime() - Date.parse(swept);
  if (!Number.isFinite(ageMs)) return true; // unparseable timestamp → don't trust it
  return ageMs > GITHUB_SIGNALS_STALE_DAYS * MS_PER_DAY;
}

/** Renovate auto-fix dispatches for one vuln episode before it's "exhausted" (manual fix needed). */
const AUTO_FIX_EXHAUSTED_CYCLES = 3;

/**
 * One attention item per site carrying current critical+high vulns (medium/low omitted
 * per the locked threshold). PURE: takes already-fetched Websites rows. `metric` is the
 * critical+high count (so a rising count diffs as WORSE); `severity` is `critical` when
 * any critical exists, else `warning`. Null counts (never audited) read as 0 → skipped.
 * Once `securityAutoFixAttempts` reaches AUTO_FIX_EXHAUSTED_CYCLES the item is flagged
 * `autoFixExhausted` (forced-critical, escalated title) — Renovate tried and couldn't fix it.
 */
export function collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    const metric = critical + high;
    if (metric <= 0) continue;
    const attempts = s.securityAutoFixAttempts ?? 0;
    const exhausted = attempts >= AUTO_FIX_EXHAUSTED_CYCLES;
    const noun = metric === 1 ? "vuln" : "vulns";
    items.push({
      key: `vuln:${s.id}`,
      kind: "vuln",
      siteName: s.name,
      title: exhausted
        ? `${metric} critical/high ${noun} — auto-fix failed (${attempts}×)`
        : `${metric} critical/high ${noun}`,
      url: dashboardUrl(baseUrl, s.name),
      severity: exhausted || critical > 0 ? "critical" : "warning",
      metric,
      ...(exhausted ? { autoFixExhausted: true } : {}),
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
/**
 * One attention item per unsent draft whose send is ALREADY known to fail
 * (approveBlockers: recipients / header image / report scores). An APPROVED one
 * is critical — the next 09:23 UTC run will go red on it; a pending one is a
 * warning — approving it just schedules that failure. Keyed `preflight:<reportId>`.
 * PURE; same predicate the approve gate and the dashboard chip use.
 */
export function collectPreflightBlocked(
  reports: ReportRow[],
  sitesById: Map<string, WebsiteRow>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of reports) {
    if (!r.draftReady || r.sentAt !== null) continue;
    // The approved state rides the KEY so a pending→approved escalation with
    // unchanged blockers re-news as a fresh critical instead of diffing
    // "standing" against its old warning self.
    const state = r.approvedToSend ? "approved" : "pending";
    const site = sitesById.get(r.siteId);
    if (!site) {
      // A dangling/empty Site link is itself a send blocker (sendApprovedReports
      // fails with "Site row not found") — surface it; the empty-slug
      // dashboardUrl fallback yields the fleet root, not a broken /s/ link.
      items.push({
        key: `preflight:${r.id}:${state}`,
        kind: "preflight",
        siteName: "(unlinked site)",
        title: r.approvedToSend
          ? `Approved ${r.reportType} will fail at send — site-not-found`
          : `${r.reportType} draft can't be approved — site-not-found`,
        url: dashboardUrl(baseUrl, ""),
        severity: r.approvedToSend ? "critical" : "warning",
        metric: 1,
      });
      continue;
    }
    const fails = approveBlockers(site, r).filter((f) => f.level === "fail");
    if (fails.length === 0) continue;
    const first = fails[0]!;
    const more = fails.length > 1 ? ` (+${fails.length - 1} more)` : "";
    items.push({
      key: `preflight:${r.id}:${state}`,
      kind: "preflight",
      siteName: site.name,
      title: r.approvedToSend
        ? `Approved ${r.reportType} will fail at send — ${first.check}${more}`
        : `${r.reportType} draft can't be approved — ${first.check}${more}`,
      url: dashboardUrl(baseUrl, site.name),
      severity: r.approvedToSend ? "critical" : "warning",
      metric: fails.length,
    });
  }
  return items;
}

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
 * slice-2a-persisted `renovateFailingCis` field (the nightly github-signals sweep
 * populates it). PURE. Keyed `renovate:<siteId>` so the digest and the cockpit
 * share one diff key. `metric` is the count (a rising count diffs WORSE); severity
 * `warning`. Null/0 → skipped. A site whose `githubSignalsAt` is >3 days stale (or
 * null) is ALSO skipped — a repo that stopped being swept must not show a phantom
 * count forever (`now` injected, defaults to wall-clock).
 */
export function collectRenovateAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (gitHubSignalsStale(s.githubSignalsAt, now)) continue;
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
 * state (passing/pending/none) or null is skipped. A site whose `githubSignalsAt`
 * is >3 days stale (or null) is ALSO skipped — a repo that stopped being swept must
 * not show a phantom 🔴 forever (`now` injected, defaults to wall-clock).
 */
export function collectCiAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (gitHubSignalsStale(s.githubSignalsAt, now)) continue;
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
 * A soft-fail older than this is no longer a trustworthy CURRENT signal. Drafting
 * self-clears `analyticsSoftFailAt` on the next clean enrichment, so a non-null
 * value normally means "errored on the most recent draft and hasn't recovered" —
 * but a site that stopped being drafted (freq→None, deprecated) would otherwise
 * show a phantom forever. 45 days covers a monthly cadence + margin; older drops.
 */
const ANALYTICS_SOFT_FAIL_STALE_DAYS = 45;

/**
 * One attention item per site whose last draft's GA/Search enrichment ERRORED, read
 * from the `analyticsSoftFailAt` timestamp (drafting sets it on a soft-fail, clears
 * it on a clean enrichment). PURE. Keyed `analytics:<siteId>` so the digest and the
 * cockpit share one diff key; `metric` 1 (binary), severity `warning`. A null
 * timestamp (clean, or the operator-added `Analytics soft-fail at` column absent) is
 * skipped, as is one staler than {@link ANALYTICS_SOFT_FAIL_STALE_DAYS}. On a
 * FLEET-WIDE subject outage many sites surface this at once — that breadth IS the
 * signal here; the report cron additionally emails a single concise fleet-wide alert
 * (see `assessAnalyticsAlert`). `now` injected, defaults to wall-clock.
 */
export function collectAnalyticsFailures(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const at = s.analyticsSoftFailAt;
    if (at === null) continue;
    const ageMs = now.getTime() - Date.parse(at);
    // Unparseable timestamp (NaN) → keep the item (don't silently drop a real failure
    // on a parse glitch); only a parseable, beyond-window age is skipped as stale.
    if (Number.isFinite(ageMs) && ageMs > ANALYTICS_SOFT_FAIL_STALE_DAYS * MS_PER_DAY) continue;
    items.push({
      key: `analytics:${s.id}`,
      kind: "analytics",
      siteName: s.name,
      title: "GA/Search enrichment failing (analytics blank)",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}
