// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { AttentionItem } from "../reports/digest.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import type { ReportType } from "../reports/types.js";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
} from "../alerts/digest-collectors.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
import { relativeTimeFromNow } from "./relative-time.js";

export type Tier = "attention" | "watch" | "healthy";

/** Watch-tier thresholds (the soft band beneath the M5 alert floor). */
const LIGHTHOUSE_FLOOR = 75; // mirrors collectLighthouseAlerts — at/above is not an attention item
const LIGHTHOUSE_WATCH_HIGH = 85; // [75,85) = "near the floor" → watch
const AUDIT_STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WATCH_CATEGORIES: ReadonlyArray<{
  field: "pScore" | "rScore" | "bpScore" | "seoScore";
  label: string;
}> = [
  { field: "pScore", label: "Performance" },
  { field: "rScore", label: "Accessibility" },
  { field: "bpScore", label: "Best Practices" },
  { field: "seoScore", label: "SEO" },
];

/**
 * Tier a single site from its attention items + soft watch rules. PURE; `now` is
 * injected for testability. Any attention item → 🔴 attention (items already encode
 * the M5 thresholds, so a sub-75 Lighthouse score arrives here as an item and never
 * needs the watch band). Otherwise 🟡 watch when a Lighthouse category sits in
 * [75,85) or the last audit is older than 30 days (a NULL audit is NOT stale — it's
 * an onboarding gap, surfaced by the Setup score, not a regression). Else 🟢 healthy.
 *
 * `watchReasons` are the human labels for the card; `watchSignals` are the STRUCTURED
 * filter tags ("lighthouse" / "stale") the client filter keys off — derived here so
 * the renderer never has to regex-sniff a human string whose wording may change.
 */
export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): { tier: Tier; watchReasons: string[]; watchSignals: string[] } {
  if (items.length > 0) return { tier: "attention", watchReasons: [], watchSignals: [] };

  const watchReasons: string[] = [];
  const signals = new Set<string>();
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      watchReasons.push(`${cat.label} ${score}`);
      signals.add("lighthouse");
    }
  }
  if (site.lastLighthouseAuditAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastLighthouseAuditAt);
    if (Number.isFinite(ageMs) && ageMs > AUDIT_STALE_DAYS * MS_PER_DAY) {
      watchReasons.push(`audited ${relativeTimeFromNow(site.lastLighthouseAuditAt, now)}`);
      signals.add("stale");
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons, watchSignals: [...signals] }
    : { tier: "healthy", watchReasons: [], watchSignals: [] };
}

export type SiteCard = {
  site: WebsiteRow;
  tier: Tier;
  /** This site's tagged attention items (status already set), critical-first. */
  items: AttentionItem[];
  /** Why the site is on Watch — human labels (empty unless tier === "watch"). */
  watchReasons: string[];
  /** Structured watch tags ("lighthouse" / "stale") for the client filter. */
  watchSignals: string[];
};

export type PendingEntry = {
  reportId: string;
  siteName: string;
  slug: string;
  reportType: ReportType;
  period: string;
};

export type CockpitSummary = {
  attention: number;
  watch: number;
  healthy: number;
  criticalHighVulns: number;
  lighthouseBelowFloor: number;
  deliveryFailures: number;
  pending: number;
};

export type CockpitModel = {
  summary: CockpitSummary;
  /** All visible sites, ordered: attention (worst-first) → watch (A-Z) → healthy (A-Z). */
  cards: SiteCard[];
  pending: PendingEntry[];
};

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1 };
const TIER_RANK: Record<Tier, number> = { attention: 0, watch: 1, healthy: 2 };

/**
 * Assemble the render-ready cockpit model from already-fetched Airtable rows. PURE
 * (`now` injected). Filters to dashboardToken-visible sites, runs the M5 collectors
 * over them, tags NEW/WORSE via diffAttention against the prior digest snapshot
 * (READ-ONLY — the returned `next` is discarded; only the daily digest writes state),
 * tiers each site, computes the summary, and resolves the pending-approval list.
 */
export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
  now: Date,
): CockpitModel {
  const visible = websites.filter((w) => w.dashboardToken !== null);
  const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));

  const rawItems: AttentionItem[] = [
    ...collectVulnAlerts(visible, baseUrl),
    ...collectLighthouseAlerts(visible, baseUrl),
    ...collectDeliveryFailures(reports, sitesById, baseUrl),
  ];
  // Read-only diff: tag NEW/WORSE exactly as the email does; discard `next`.
  const { tagged } = diffAttention(rawItems, priorSnapshot, now.toISOString().slice(0, 10));

  // Group by siteName (the collectors set siteName from the row). This relies on the
  // fleet-wide name→slug uniqueness invariant the /s/<slug> lookup already assumes; if
  // two visible sites ever shared a name they'd share a card. Acceptable for slice 1.
  const bySite = new Map<string, AttentionItem[]>();
  for (const it of tagged) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }

  const cards: SiteCard[] = visible.map((site) => {
    const items = (bySite.get(site.name) ?? []).sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
    const { tier, watchReasons, watchSignals } = assignTier(site, items, now);
    return { site, tier, items, watchReasons, watchSignals };
  });

  cards.sort((a, b) => {
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (a.tier === "attention") {
      const sevA = a.items.some((i) => i.severity === "critical") ? 0 : 1;
      const sevB = b.items.some((i) => i.severity === "critical") ? 0 : 1;
      if (sevA !== sevB) return sevA - sevB;
      const metA = a.items.reduce((s, i) => s + i.metric, 0);
      const metB = b.items.reduce((s, i) => s + i.metric, 0);
      if (metA !== metB) return metB - metA;
    }
    return a.site.name.toLowerCase().localeCompare(b.site.name.toLowerCase());
  });

  const pending: PendingEntry[] = [];
  // Mirror listPendingApproval's predicate. Resolve against ALL websites (a pending
  // approval is never dropped just because the site is hidden from the fleet view).
  const allById = new Map<string, WebsiteRow>(websites.map((w) => [w.id, w]));
  for (const r of reports) {
    if (!(r.draftReady && !r.approvedToSend && r.sentAt === null)) continue;
    const s = allById.get(r.siteId);
    if (!s) continue; // orphan → skip rather than render a broken link
    pending.push({
      reportId: r.id,
      siteName: s.name,
      slug: siteSlug(s.name),
      reportType: r.reportType,
      period: r.period ?? "—",
    });
  }

  const summary: CockpitSummary = {
    attention: cards.filter((c) => c.tier === "attention").length,
    watch: cards.filter((c) => c.tier === "watch").length,
    healthy: cards.filter((c) => c.tier === "healthy").length,
    criticalHighVulns: tagged.filter((i) => i.kind === "vuln").reduce((s, i) => s + i.metric, 0),
    lighthouseBelowFloor: tagged.filter((i) => i.kind === "lighthouse").length,
    deliveryFailures: tagged.filter((i) => i.kind === "delivery").length,
    pending: pending.length,
  };

  return { summary, cards, pending };
}
