// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug, isDashboardVisible } from "../reports/airtable/websites.js";
import type { AttentionItem } from "../alerts/attention.js";
import { isPendingApproval } from "../reports/airtable/reports.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import type { ReportType } from "../reports/types.js";
import type { SubmissionRow, FormType } from "../reports/submission-row.js";
import type { FleetEvent, FleetEventType } from "../db/fleet-events.js";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
  collectAnalyticsFailures,
} from "../alerts/digest-collectors.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { isNetlifyAppUrl } from "../util/url.js";

export type Tier = "attention" | "watch" | "healthy";

/** Watch-tier thresholds (the soft band beneath the M5 alert floor). */
const LIGHTHOUSE_FLOOR = 75; // mirrors collectLighthouseAlerts — at/above is not an attention item
const LIGHTHOUSE_WATCH_HIGH = 85; // [75,85) = "near the floor" → watch
const STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Netlify deploy states the dashboard treats as a successful production build. */
const READY_DEPLOY_STATES: ReadonlySet<string> = new Set(["ready"]);
/** Netlify deploy states that mean the build actually failed (→ attention tier + red badge). */
const FAILED_DEPLOY_STATES: ReadonlySet<string> = new Set(["error", "failed", "rejected"]);

/** True when the persisted deploy status is a successful production build. PURE. */
export function isReadyDeployStatus(status: string | null): boolean {
  return status !== null && READY_DEPLOY_STATES.has(status.toLowerCase());
}
/** True when the persisted deploy status is a failed build. PURE. */
export function isFailedDeployStatus(status: string | null): boolean {
  return status !== null && FAILED_DEPLOY_STATES.has(status.toLowerCase());
}

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
 * needs the watch band). A FAILED latest production deploy (`deployStatus === "failed"`/
 * "error") is the same severity → 🔴 attention. Otherwise 🟡 watch when a Lighthouse
 * category sits in [75,85), the last commit to `main` is older than 30 days, or a
 * maintenance site is still on `*.netlify.app`. Else 🟢 healthy.
 *
 * A condition the operator has marked accepted (`site.acceptedWatchConditions`,
 * case-insensitive: a Lighthouse category label, "stale repo", or "no custom domain")
 * is routed to `acceptedReasons` instead of `watchReasons` — it leaves the watch band
 * (an all-accepted site becomes healthy) but stays visible as a muted chip. Acceptance
 * is watch-only: a sub-floor Lighthouse score arrives as an AttentionItem above and
 * still alarms broken, so accepting "78" never hides a drop to "72".
 *
 * `watchReasons` are the human labels for the card; `watchSignals` are the STRUCTURED
 * filter tags ("lighthouse" / "stale") the client filter keys off.
 */
export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): { tier: Tier; watchReasons: string[]; watchSignals: string[]; acceptedReasons: string[] } {
  if (items.length > 0)
    return { tier: "attention", watchReasons: [], watchSignals: [], acceptedReasons: [] };
  // A failed latest production deploy is an active break — tier it 🔴 attention, the
  // same severity a sub-floor Lighthouse score gets (which arrives as an item above).
  if (isFailedDeployStatus(site.deployStatus))
    return { tier: "attention", watchReasons: [], watchSignals: [], acceptedReasons: [] };

  // Conditions the operator has reviewed and accepted (case-insensitive). An accepted
  // watch reason is routed to acceptedReasons instead of raising the watch band.
  const accepted = new Set(site.acceptedWatchConditions.map((c) => c.trim().toLowerCase()));
  const watchReasons: string[] = [];
  const acceptedReasons: string[] = [];
  const signals = new Set<string>();
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      const reason = `${cat.label} ${score}`;
      if (accepted.has(cat.label.toLowerCase())) {
        acceptedReasons.push(reason);
      } else {
        watchReasons.push(reason);
        signals.add("lighthouse");
      }
    }
  }
  if (site.lastCommitAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastCommitAt);
    if (Number.isFinite(ageMs) && ageMs > STALE_DAYS * MS_PER_DAY) {
      const reason = `last commit ${relativeTimeFromNow(site.lastCommitAt, now)}`;
      if (accepted.has("stale repo")) {
        acceptedReasons.push(reason);
      } else {
        watchReasons.push(reason);
        signals.add("stale");
      }
    }
  }
  // A live (maintenance) site still served from *.netlify.app never got a custom
  // domain — a launch-completeness gap. Only for maintenance: a launch-period site on
  // netlify.app is expected (not launched yet).
  if (site.status === "maintenance" && isNetlifyAppUrl(site.url)) {
    const reason = "on *.netlify.app (no custom domain)";
    if (accepted.has("no custom domain")) {
      acceptedReasons.push(reason);
    } else {
      watchReasons.push(reason);
      signals.add("no-domain");
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons, watchSignals: [...signals], acceptedReasons }
    : { tier: "healthy", watchReasons: [], watchSignals: [], acceptedReasons };
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
  /** Watch reasons the operator has accepted: suppressed from the band, shown as a
   *  muted chip. Populated whenever the underlying condition is currently active. */
  acceptedReasons: string[];
  /** Count of NEW submissions for this site (optional; populated by buildCockpitModel). */
  newSubmissions?: number;
};

export type PendingEntry = {
  reportId: string;
  siteName: string;
  slug: string;
  reportType: ReportType;
  period: string;
};

export type SubmissionEntry = {
  submissionId: string;
  siteName: string;
  slug: string;
  formType: FormType;
  name: string;
  email: string;
  submittedAt: string | null;
};

export type CockpitSummary = {
  attention: number;
  watch: number;
  healthy: number;
  criticalHighVulns: number;
  lighthouseBelowFloor: number;
  deliveryFailures: number;
  renovateFailing: number;
  ciRed: number;
  /** Count of sites whose vuln has exhausted the Renovate auto-fix (manual fix needed). */
  autoFixStuck: number;
  pending: number;
  /** Count of NEW submissions across the fleet (optional for back-compat). */
  newSubmissions?: number;
};

/** A render-ready row for the cockpit "Recently" lane. `url` is an external link
 *  (PR) when present; `slug` links to `/s/<slug>` when the event names a site. */
export type RecentEntry = {
  type: FleetEventType;
  summary: string;
  siteName: string | null;
  slug: string | null;
  url: string | null;
  ts: string;
};

export type CockpitModel = {
  summary: CockpitSummary;
  /** All visible sites, ordered: attention (worst-first) → watch (A-Z) → healthy (A-Z). */
  cards: SiteCard[];
  pending: PendingEntry[];
  /** NEW submissions across the fleet, newest-first (optional for back-compat). */
  submissions?: SubmissionEntry[];
  /** Fleet spam totals over the window (optional; populated by buildCockpitModel). */
  spam?: { caught: number; through: number } | null;
  /** Recent fleet-activity events for the "Recently" lane (optional for back-compat). */
  recent?: RecentEntry[];
};

export type NeedsYouGroup = "broken" | "watch" | "approval";

/** One row of the per-site "Needs you" feed: every reason a single site needs the
 *  operator, combined. The feed is navigation-only — the row links once to the page. */
export type NeedsYouItem = {
  /** The site's worst category present — drives the dot, the group sub-label, and order. */
  group: NeedsYouGroup;
  /** Any of the site's broken items is `severity: "critical"` (within-broken ordering). */
  hasCritical: boolean;
  slug: string;
  siteName: string;
  reasons: string[];
  /** Always `/s/${slug}`. */
  url: string;
};

const NEEDS_YOU_GROUP_RANK: Record<NeedsYouGroup, number> = { broken: 0, watch: 1, approval: 2 };

/**
 * Collapse the cockpit model into a per-site "Needs you" feed — ONE row per site,
 * with every reason combined. PURE. A non-exhausted vuln is amber `watch` (the fleet
 * is auto-patching it); an exhausted vuln (`item.autoFixExhausted`) is a hard `broken`
 * break, as is any non-vuln attention item. The whole watch tier folds into `watch`.
 * Order: broken → watch → approval; within broken, critical-first; then site name.
 */
export function buildNeedsYouFeed(model: CockpitModel): NeedsYouItem[] {
  type Acc = {
    slug: string;
    siteName: string;
    reasons: string[];
    hasCritical: boolean;
    broken: boolean;
    watch: boolean;
    approval: boolean;
  };
  const bySlug = new Map<string, Acc>();
  const get = (siteName: string): Acc => {
    const slug = siteSlug(siteName);
    let a = bySlug.get(slug);
    if (!a) {
      a = {
        slug,
        siteName,
        reasons: [],
        hasCritical: false,
        broken: false,
        watch: false,
        approval: false,
      };
      bySlug.set(slug, a);
    }
    return a;
  };

  for (const card of model.cards) {
    if (card.tier === "attention") {
      // A self-patching vuln (present but not yet exhausted) is amber WATCH — the fleet
      // is auto-patching it. Every other item, INCLUDING an exhausted vuln, is a hard
      // break. A site with any hard break is broken and its self-patching vulns are not
      // separately listed (it is already red). Single-source the predicate so the two
      // partitions can never drift out of lockstep.
      const isSelfPatchingVuln = (it: AttentionItem): boolean =>
        it.kind === "vuln" && it.autoFixExhausted !== true;
      const hardBroken = card.items.filter((it) => !isSelfPatchingVuln(it));
      const selfPatchingVulns = card.items.filter(isSelfPatchingVuln);
      if (hardBroken.length > 0) {
        const a = get(card.site.name);
        for (const it of hardBroken) {
          a.reasons.push(it.title);
          if (it.severity === "critical") a.hasCritical = true;
        }
        a.broken = true;
      } else if (selfPatchingVulns.length > 0) {
        const a = get(card.site.name);
        for (const it of selfPatchingVulns) a.reasons.push(it.title);
        a.watch = true;
      }
    } else if (card.tier === "watch" && card.watchReasons.length > 0) {
      const a = get(card.site.name);
      for (const r of card.watchReasons) a.reasons.push(r);
      a.watch = true;
    }
  }

  for (const p of model.pending) {
    const a = get(p.siteName);
    a.reasons.push(`${p.reportType} ${p.period} ready`);
    a.approval = true;
  }

  const items: NeedsYouItem[] = [];
  for (const a of bySlug.values()) {
    if (a.reasons.length === 0) continue;
    const group: NeedsYouGroup = a.broken ? "broken" : a.watch ? "watch" : "approval";
    items.push({
      group,
      hasCritical: a.hasCritical,
      slug: a.slug,
      siteName: a.siteName,
      reasons: a.reasons,
      url: `/s/${a.slug}`,
    });
  }

  items.sort((x, y) => {
    if (NEEDS_YOU_GROUP_RANK[x.group] !== NEEDS_YOU_GROUP_RANK[y.group])
      return NEEDS_YOU_GROUP_RANK[x.group] - NEEDS_YOU_GROUP_RANK[y.group];
    if (x.group === "broken" && x.hasCritical !== y.hasCritical) return x.hasCritical ? -1 : 1;
    return x.siteName.toLowerCase().localeCompare(y.siteName.toLowerCase());
  });

  return items;
}

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1 };
const TIER_RANK: Record<Tier, number> = { attention: 0, watch: 1, healthy: 2 };

/**
 * Assemble the render-ready cockpit model from already-fetched Airtable rows. PURE
 * (`now` injected). Filters to dashboard-visible sites (maintenance or launch period),
 * runs the M5 collectors
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
  newSubmissions: SubmissionRow[] = [],
  spamTotals: { honeypot: number; tooFast: number; markedSpam: number } | null = null,
  recentEvents: FleetEvent[] = [],
): CockpitModel {
  const visible = websites.filter(isDashboardVisible);
  const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));

  // Per-site NEW-submission counts, keyed by Websites record id. Used for the
  // per-card badge below; the strip resolves entries against ALL sites.
  const subCountBySite = new Map<string, number>();
  for (const sub of newSubmissions) {
    subCountBySite.set(sub.siteId, (subCountBySite.get(sub.siteId) ?? 0) + 1);
  }

  const rawItems: AttentionItem[] = [
    ...collectVulnAlerts(visible, baseUrl),
    ...collectLighthouseAlerts(visible, baseUrl),
    ...collectDeliveryFailures(reports, sitesById, baseUrl),
    ...collectRenovateAlerts(visible, baseUrl, now),
    ...collectCiAlerts(visible, baseUrl, now),
    ...collectAnalyticsFailures(visible, baseUrl, now),
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
    const { tier, watchReasons, watchSignals, acceptedReasons } = assignTier(site, items, now);
    return {
      site,
      tier,
      items,
      watchReasons,
      watchSignals,
      acceptedReasons,
      newSubmissions: subCountBySite.get(site.id) ?? 0,
    };
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
    if (!isPendingApproval(r)) continue;
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

  const submissions: SubmissionEntry[] = [];
  for (const sub of newSubmissions) {
    const s = allById.get(sub.siteId);
    if (!s) continue; // orphan submission → skip rather than render a broken link
    submissions.push({
      submissionId: sub.id,
      siteName: s.name,
      slug: siteSlug(s.name),
      formType: sub.formType,
      name: sub.name,
      email: sub.email,
      submittedAt: sub.submittedAt,
    });
  }

  const summary: CockpitSummary = {
    attention: cards.filter((c) => c.tier === "attention").length,
    watch: cards.filter((c) => c.tier === "watch").length,
    healthy: cards.filter((c) => c.tier === "healthy").length,
    criticalHighVulns: tagged.filter((i) => i.kind === "vuln").reduce((s, i) => s + i.metric, 0),
    lighthouseBelowFloor: tagged.filter((i) => i.kind === "lighthouse").length,
    deliveryFailures: tagged.filter((i) => i.kind === "delivery").length,
    renovateFailing: tagged.filter((i) => i.kind === "renovate").reduce((s, i) => s + i.metric, 0),
    ciRed: tagged.filter((i) => i.kind === "ci").length,
    autoFixStuck: tagged.filter((i) => i.autoFixExhausted).length,
    pending: pending.length,
    newSubmissions: submissions.length,
  };

  const recent: RecentEntry[] = recentEvents.map((e) => {
    const url =
      e.type === "pr_automerged" &&
      e.data !== null &&
      typeof e.data === "object" &&
      "url" in e.data &&
      typeof (e.data as { url: unknown }).url === "string"
        ? (e.data as { url: string }).url
        : null;
    return {
      type: e.type,
      summary: e.summary,
      siteName: e.siteName,
      slug: e.siteName ? siteSlug(e.siteName) : null,
      url,
      ts: e.ts,
    };
  });

  return {
    summary,
    cards,
    pending,
    submissions,
    spam: spamTotals
      ? { caught: spamTotals.honeypot + spamTotals.tooFast, through: spamTotals.markedSpam }
      : null,
    recent,
  };
}

/** Most recent `lastLighthouseAuditAt` across the cards, or null if none recorded.
 *  Drives the cockpit verdict's "fleet last audited Xh ago" line. PURE. */
export function fleetLastAuditedAt(cards: SiteCard[]): string | null {
  let latestIso: string | null = null;
  let latestMs = -Infinity;
  for (const c of cards) {
    const iso = c.site.lastLighthouseAuditAt;
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = iso;
    }
  }
  return latestIso;
}
