// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import {
  siteSlug,
  isDashboardVisible,
  isArchivedStatus,
  isUnrecognizedStatus,
} from "../reports/airtable/websites.js";
import type { AttentionItem } from "../alerts/attention.js";
import { isPendingApproval } from "../reports/airtable/reports.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import type { ReportType } from "../reports/types.js";
import type { SubmissionRow, FormType } from "../reports/submission-row.js";
import { isLeadFormType } from "../forms/types.js";
import type { FleetEvent, FleetEventType } from "../db/fleet-events.js";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectPreflightBlocked,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
  collectAnalyticsFailures,
  collectTurnstileGuardrailAlerts,
  collectNotifyBounceAlerts,
} from "../alerts/digest-collectors.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { isNetlifyAppUrl } from "../util/url.js";

export type Tier = "attention" | "watch" | "healthy" | "pre-launch";

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
 * Each active watch condition is a structured candidate with a set of accept keys
 * (aliases — e.g. the Netlify/no-custom-domain condition accepts "no custom domain",
 * "netlify", "netlify.app", …); a condition the operator has marked accepted (any of
 * its keys, case-insensitive, in `site.acceptedWatchConditions`) is routed to
 * `acceptedReasons` instead of `watchReasons` — it leaves the watch band (an
 * all-accepted site becomes healthy) but stays visible as a muted chip. Acceptance is
 * keyed on the STABLE signal token, not the volatile reason text, so accepting
 * "performance" tolerates a score of 82→78 (both watch). Acceptance is watch-only: a
 * sub-floor Lighthouse score arrives as an AttentionItem above and still alarms broken,
 * so accepting "78" never hides a drop to "72".
 *
 * `watchReasons` are the human labels for the card; `watchAcceptKeys` is the primary/
 * canonical accept token per un-accepted reason (index-aligned — surfaced on the card so
 * the operator can see the exact string that would mute it); `watchSignals` are the
 * STRUCTURED filter tags ("lighthouse" / "stale") the client filter keys off.
 */
/** One detected watch condition, before acceptance is applied. `signal` is the
 *  client-filter tag; `acceptKeys` is every string the operator can type to mute it,
 *  PRIMARY FIRST — that primary is the token surfaced on the card for discoverability;
 *  `reason` is the human label. The tuple type guarantees a primary exists. */
type WatchCandidate = { signal: string; acceptKeys: [string, ...string[]]; reason: string };

/** Which attention items PIERCE the pre-launch mute. A "launch period" site mutes
 *  expected pre-launch conditions (early/absent Lighthouse, errored deploy,
 *  Renovate/analytics warnings) — but a genuine alarm must not hide behind the
 *  mute: 2026-07, a human content push left hedloc's default-branch CI red for
 *  two days and the cockpit hid it; the daily digest (which runs these same
 *  collectors over ALL sites with no pre-launch mute) was the only alarm surface.
 *  The cockpit now surfaces the genuine subset of what the digest already shows —
 *  not a third behavior. Pierces: any CRITICAL-severity item (critical/exhausted
 *  vuln, turnstile guardrail, notify-bounce, spam complaint, approved-report
 *  preflight) plus default-branch CI red (`kind === "ci"` — warning severity, but
 *  a broken repo is never expected pre-launch noise). PURE. */
export function piercesPreLaunchMute(item: AttentionItem): boolean {
  return item.severity === "critical" || item.kind === "ci";
}

export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): {
  tier: Tier;
  watchReasons: string[];
  /** Primary accept token per un-accepted watch reason, index-aligned with
   *  `watchReasons` — the exact string that would mute it (discoverability). */
  watchAcceptKeys: string[];
  watchSignals: string[];
  acceptedReasons: string[];
} {
  // Lifecycle short-circuit (FIRST, before any alarm rule): a "launch period" site
  // is PRE-LIVE prep, not a live site (Status flips to "maintenance" at go-live).
  // Its expected pre-launch conditions — no GA4 property, early/absent Lighthouse,
  // an errored/absent Netlify deploy, Renovate warnings — would otherwise force it
  // to 🔴 attention and read as "broken". Mute those as a calm "pre-launch" tier
  // that never alarms and is excluded from the "needs you" feed — but a GENUINE
  // alarm (piercesPreLaunchMute: any critical item, or CI red) re-tiers the site
  // to 🔴 attention through the normal machinery. (Only "launch period" reaches
  // the cockpit — isDashboardVisible = {maintenance, launch period}.)
  if (site.status === "launch period") {
    // Genuine alarms pierce the mute; this attention return sits ABOVE the
    // accepted-watch loop, so an operator ack can never silence a pierced alarm —
    // the same invariant the live-site items short-circuit keeps. Everything else
    // (incl. a failed deploy, checked further below only for live sites) stays
    // muted as expected pre-launch conditions.
    if (items.some(piercesPreLaunchMute))
      return {
        tier: "attention",
        watchReasons: [],
        watchAcceptKeys: [],
        watchSignals: [],
        acceptedReasons: [],
      };
    return {
      tier: "pre-launch",
      watchReasons: [],
      watchAcceptKeys: [],
      watchSignals: [],
      acceptedReasons: [],
    };
  }
  if (items.length > 0)
    return {
      tier: "attention",
      watchReasons: [],
      watchAcceptKeys: [],
      watchSignals: [],
      acceptedReasons: [],
    };
  // A failed latest production deploy is an active break — tier it 🔴 attention, the
  // same severity a sub-floor Lighthouse score gets (which arrives as an item above).
  if (isFailedDeployStatus(site.deployStatus))
    return {
      tier: "attention",
      watchReasons: [],
      watchAcceptKeys: [],
      watchSignals: [],
      acceptedReasons: [],
    };

  // Conditions the operator has reviewed and accepted (case-insensitive). An accepted
  // watch reason is routed to acceptedReasons instead of raising the watch band.
  const accepted = new Set(site.acceptedWatchConditions.map((c) => c.trim().toLowerCase()));

  // Collect every active watch condition as a structured candidate; a single generic
  // matcher below routes each to acceptedReasons (muted) or watchReasons, keyed on the
  // stable signal/category token (never the volatile reason text, which carries a
  // score/age that changes daily). Adding a new watch candidate here makes it acceptable
  // AND discoverable with no new accept branch.
  const candidates: WatchCandidate[] = [];
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      candidates.push({
        signal: "lighthouse",
        acceptKeys: [cat.label.toLowerCase()],
        reason: `${cat.label} ${score}`,
      });
    }
  }
  if (site.lastCommitAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastCommitAt);
    if (Number.isFinite(ageMs) && ageMs > STALE_DAYS * MS_PER_DAY) {
      candidates.push({
        signal: "stale",
        acceptKeys: ["stale repo", "stale"],
        reason: `last commit ${relativeTimeFromNow(site.lastCommitAt, now)}`,
      });
    }
  }
  // A live (maintenance) site still served from *.netlify.app never got a custom
  // domain — a launch-completeness gap. Only for maintenance: a launch-period site on
  // netlify.app is expected (not launched yet).
  if (site.status === "maintenance" && isNetlifyAppUrl(site.url)) {
    candidates.push({
      signal: "no-domain",
      acceptKeys: ["no custom domain", "no-domain", "netlify", "netlify.app", "on netlify"],
      reason: "on *.netlify.app (no custom domain)",
    });
  }
  // Require-Turnstile guardrail, watch half: the flag hard-buckets token-less
  // submissions, so a gated site whose widget state ISN'T positively confirmed
  // deserves a nag. A fresh confirmed "fail" never reaches here — that is a CRITICAL
  // AttentionItem (collectTurnstileGuardrailAlerts) caught by the items short-circuit
  // ABOVE the accept loop, so an accept key can mute this "can't verify" watch but
  // can never silence the confirmed-missing alarm. `!== "pass"` covers both null
  // (older package /health without a forms block, or the sweep never ran) and a
  // stale "fail" the collector downgraded.
  if (site.requireTurnstile && site.turnstileWidget !== "pass") {
    candidates.push({
      signal: "turnstile-unverified",
      acceptKeys: ["turnstile-unverified", "turnstile unverified", "turnstile"],
      reason:
        site.turnstileWidget === "fail"
          ? "Require Turnstile on; widget missing per a stale health sweep"
          : "Require Turnstile on; widget not verifiable from /health",
    });
  }

  const watchReasons: string[] = [];
  const watchAcceptKeys: string[] = [];
  const acceptedReasons: string[] = [];
  const signals = new Set<string>();
  for (const cand of candidates) {
    if (cand.acceptKeys.some((k) => accepted.has(k))) {
      acceptedReasons.push(cand.reason);
    } else {
      watchReasons.push(cand.reason);
      watchAcceptKeys.push(cand.acceptKeys[0]); // primary/canonical token — surfaced on the card
      signals.add(cand.signal);
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons, watchAcceptKeys, watchSignals: [...signals], acceptedReasons }
    : {
        tier: "healthy",
        watchReasons: [],
        watchAcceptKeys: [],
        watchSignals: [],
        acceptedReasons,
      };
}

export type SiteCard = {
  site: WebsiteRow;
  tier: Tier;
  /** This site's tagged attention items (status already set), critical-first. */
  items: AttentionItem[];
  /** Why the site is on Watch — human labels (empty unless tier === "watch"). */
  watchReasons: string[];
  /** Primary accept token per watch reason, index-aligned with `watchReasons` — the
   *  exact string the operator can add to Accepted Watch Conditions to mute it. Optional
   *  for back-compat with hand-built card fixtures; the renderer falls back to no hint. */
  watchAcceptKeys?: string[];
  /** Structured watch tags ("lighthouse" / "stale") for the client filter. */
  watchSignals: string[];
  /** Watch reasons the operator has accepted: suppressed from the band, shown as a
   *  muted chip. Populated whenever the underlying condition is currently active. */
  acceptedReasons: string[];
  /** Count of NEW submissions for this site (optional; populated by buildCockpitModel). */
  newSubmissions?: number;
  /** Split of newSubmissions: actionable leads vs newsletter/rsvp signups (2026-07-16).
   *  Optional for back-compat with hand-built card fixtures. */
  newLeads?: number;
  newSignups?: number;
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
  /** Count of pre-live "launch period" sites still muted as expected pre-launch
   *  conditions. A piercing alarm (piercesPreLaunchMute) re-tiers such a site to
   *  attention, so it counts there instead — muted never means "hidden if broken". */
  preLaunch: number;
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
  /** Split of newSubmissions: actionable leads vs newsletter/rsvp signups
   *  (optional for back-compat, 2026-07-16). */
  newLeads?: number;
  newSignups?: number;
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

/** A Websites row surfaced OUTSIDE the fleet cards: archived (legacy/deprecated)
 *  or holding an unrecognized Status cell. `status` is the raw cell value. */
export type OffFleetSiteEntry = { name: string; slug: string; status: string };

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
  /** Fleet-wide count of submissions auto-filtered as spam in the affordance window
   *  (optional for back-compat). Drives the cockpit "N auto-filtered this week" line. */
  autoFiltered?: number;
  /** Archived (legacy/deprecated) rows — excluded from every fleet op, listed on a
   *  neutral collapsed lane so a row can never silently vanish (optional for back-compat). */
  archived?: OffFleetSiteEntry[];
  /** Rows whose Status cell is outside the code's union (typo / renamed option) —
   *  invisible to every fleet op, so the Needs-you feed surfaces them as amber watch
   *  rows (optional for back-compat). */
  unrecognizedStatus?: OffFleetSiteEntry[];
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
    // Only "attention" (broken) and "watch" cards enter the feed; a "pre-launch"
    // card is pre-live prep and intentionally never surfaces here as needing you.
    // (A launch-period site with a PIERCING alarm arrives as tier "attention" —
    // assignTier re-tiers it — so genuine pre-launch breaks do reach the feed.)
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

  // A Websites row whose Status is outside the union is invisible to every fleet
  // op — surface it amber so a typo can never silently vanish a site.
  for (const u of model.unrecognizedStatus ?? []) {
    const a = get(u.name);
    a.reasons.push(
      `Status "${u.status}" is not a recognized value — fix it in Airtable (site is invisible to fleet ops)`,
    );
    a.watch = true;
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
const TIER_RANK: Record<Tier, number> = { attention: 0, watch: 1, healthy: 2, "pre-launch": 3 };

/** The fleet attention-item collector run — the SINGLE source of truth for which
 *  signals the cockpit surfaces. buildCockpitModel (over all visible sites) and
 *  buildSiteAlarmContext (over one site) both call this, so the two can never
 *  drift: a signal added here shows up in both the fleet cockpit and every
 *  /s/<slug> page at once. Returns items UNSORTED — callers apply their own
 *  ordering (cockpit groups by site; the site page severity-sorts). PURE. */
function collectFleetAttentionItems(
  sites: WebsiteRow[],
  sitesById: Map<string, WebsiteRow>,
  reports: ReportRow[],
  baseUrl: string,
  now: Date,
  notifyBounces: ReadonlyMap<string, number>,
): AttentionItem[] {
  return [
    ...collectVulnAlerts(sites, baseUrl),
    ...collectLighthouseAlerts(sites, baseUrl),
    ...collectDeliveryFailures(reports, sitesById, baseUrl),
    ...collectPreflightBlocked(reports, sitesById, baseUrl),
    ...collectRenovateAlerts(sites, baseUrl, now),
    ...collectCiAlerts(sites, baseUrl, now),
    ...collectAnalyticsFailures(sites, baseUrl, now),
    ...collectTurnstileGuardrailAlerts(sites, baseUrl, now),
    ...collectNotifyBounceAlerts(sites, notifyBounces, baseUrl),
  ];
}

/** The cockpit's alarm verdict for ONE site, for the /s/<slug> page header. */
export type SiteAlarmContext = {
  tier: Tier;
  /** This site's attention items, severity-sorted, status UNTAGGED (no diffAttention). */
  items: AttentionItem[];
  watchReasons: string[];
  watchAcceptKeys: string[];
  acceptedReasons: string[];
};

/**
 * The cockpit's alarm verdict for ONE site, for the /s/<slug> page header. Runs
 * the SAME collector list buildCockpitModel runs — both call the shared
 * collectFleetAttentionItems (the single source of truth), so the two structurally
 * cannot drift — and the same assignTier. A parity test (site-alarm-context.test.ts)
 * additionally asserts this function's item keys match buildCockpitModel's for the
 * same site. No diffAttention: the site page never writes digest state and shows no
 * NEW/WORSE badges (the digest alone writes the snapshot; the cockpit reads it
 * read-only).
 *
 * `reports` is expected to be site-scoped (listReportsForSite) — the delivery/
 * preflight collectors resolve report.siteId against a one-entry sitesById, so an
 * orphan report in the array would surface as an "(unlinked site)" preflight row.
 * Acceptable: the real caller only ever passes this site's reports.
 */
export function buildSiteAlarmContext(
  site: WebsiteRow,
  reports: ReportRow[],
  baseUrl: string,
  now: Date,
  notifyBounces: ReadonlyMap<string, number> = new Map(),
): SiteAlarmContext {
  const sites = [site];
  const sitesById = new Map([[site.id, site]]);
  const items = collectFleetAttentionItems(
    sites,
    sitesById,
    reports,
    baseUrl,
    now,
    notifyBounces,
  ).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const {
    tier,
    watchReasons,
    watchAcceptKeys,
    watchSignals: _ws,
    acceptedReasons,
  } = assignTier(site, items, now);
  return { tier, items, watchReasons, watchAcceptKeys, acceptedReasons };
}

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
  autoFilteredCount = 0,
  // Per-site bounced-lead-notification counts (countNotifyBouncedBySite, last
  // NOTIFY_BOUNCE_WINDOW_DAYS). Optional like the other libSQL inputs: a Turso
  // blip drops the signal, never the cockpit (2026-07-16).
  notifyBounces: ReadonlyMap<string, number> = new Map(),
): CockpitModel {
  const visible = websites.filter(isDashboardVisible);
  const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));

  // Off-fleet visibility: archived rows get a neutral roster lane; a typo'd Status
  // (outside the union) gets an amber watch row in the Needs-you feed. Both are
  // read-only surfacing — neither joins `visible`, so no fleet op gains a site.
  const archived: OffFleetSiteEntry[] = websites
    .filter((w) => isArchivedStatus(w.status))
    .map((w) => ({ name: w.name, slug: siteSlug(w.name), status: w.status as string }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const unrecognizedStatus: OffFleetSiteEntry[] = websites
    .filter((w) => isUnrecognizedStatus(w.status))
    .map((w) => ({ name: w.name, slug: siteSlug(w.name), status: w.status as string }));

  // Per-site NEW-submission counts, keyed by Websites record id, split into
  // actionable leads vs newsletter/rsvp signups (2026-07-16). Used for the
  // per-card badge below; the strip resolves entries against ALL sites.
  const subCountBySite = new Map<string, { leads: number; signups: number }>();
  for (const sub of newSubmissions) {
    let c = subCountBySite.get(sub.siteId);
    if (!c) {
      c = { leads: 0, signups: 0 };
      subCountBySite.set(sub.siteId, c);
    }
    if (isLeadFormType(sub.formType)) c.leads++;
    else c.signups++;
  }

  const rawItems = collectFleetAttentionItems(
    visible,
    sitesById,
    reports,
    baseUrl,
    now,
    notifyBounces,
  );
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
    const collected = (bySite.get(site.name) ?? []).sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
    // A launch-period card carries only the piercing alarms: muted pre-launch noise
    // must not ride into the chips or the needs-you feed when a genuine alarm flips
    // the tier (and a still-muted card shows no alarm chips at all).
    const items =
      site.status === "launch period" ? collected.filter(piercesPreLaunchMute) : collected;
    const { tier, watchReasons, watchAcceptKeys, watchSignals, acceptedReasons } = assignTier(
      site,
      items,
      now,
    );
    const c = subCountBySite.get(site.id) ?? { leads: 0, signups: 0 };
    return {
      site,
      tier,
      items,
      watchReasons,
      watchAcceptKeys,
      watchSignals,
      acceptedReasons,
      newSubmissions: c.leads + c.signups,
      newLeads: c.leads,
      newSignups: c.signups,
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
    preLaunch: cards.filter((c) => c.tier === "pre-launch").length,
    criticalHighVulns: tagged.filter((i) => i.kind === "vuln").reduce((s, i) => s + i.metric, 0),
    lighthouseBelowFloor: tagged.filter((i) => i.kind === "lighthouse").length,
    deliveryFailures: tagged.filter((i) => i.kind === "delivery").length,
    renovateFailing: tagged.filter((i) => i.kind === "renovate").reduce((s, i) => s + i.metric, 0),
    ciRed: tagged.filter((i) => i.kind === "ci").length,
    autoFixStuck: tagged.filter((i) => i.autoFixExhausted).length,
    pending: pending.length,
    newSubmissions: submissions.length,
    // Same population as newSubmissions (resolved entries — orphans excluded).
    newLeads: submissions.filter((s) => isLeadFormType(s.formType)).length,
    newSignups: submissions.filter((s) => !isLeadFormType(s.formType)).length,
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
    autoFiltered: autoFilteredCount,
    archived,
    unrecognizedStatus,
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
