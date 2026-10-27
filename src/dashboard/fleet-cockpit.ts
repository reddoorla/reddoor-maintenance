// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../fleet/site-row.js";
import {
  siteSlug,
  isDashboardVisible,
  isArchivedStatus,
  isUnrecognizedStatus,
} from "../fleet/site-row.js";
import type { AttentionItem } from "../alerts/attention.js";
import { isPendingApproval } from "../reports/report-fields.js";
import type { ReportRow } from "../reports/report-fields.js";
import type { ReportType } from "../reports/types.js";
import type { SubmissionRow, FormType } from "../reports/submission-row.js";
import { isLeadFormType } from "../forms/types.js";
import type { FleetEvent, FleetEventType } from "../db/fleet-events.js";
import type { NotifyBounceCounts } from "../db/submissions.js";
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
  collectDeadLetterAlerts,
  collectPrismicDriftAlerts,
  collectUrlResolveAlerts,
  collectDeployAlerts,
  prismicAckCovers,
  urlProbeFresh,
  URL_NOT_DEPLOYED_KEYS,
} from "../alerts/digest-collectors.js";
import {
  collectA11yAlerts,
  collectDepsAlerts,
  collectDomainAlerts,
  collectFunctionHealthAlerts,
  collectLinkAlerts,
  collectRenderAlerts,
  collectSearchConsoleAlerts,
  collectTitleMetaAlerts,
  collectUptimeAlerts,
  type LatestDeps,
  undated,
} from "../alerts/production-signals.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
import { markWaiting } from "../alerts/waiting.js";
import { LEVEL_RANK, levelOf, withLevels, worstLevel, type Level } from "../alerts/ladder.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { isNetlifyAppUrl } from "../util/url.js";
import { ANALYTICS_OPT_OUT_KEYS, SEARCH_CONSOLE_OPT_OUT_KEYS } from "../fleet/opt-outs.js";
import { searchConsoleMissingLabel } from "./onboarding.js";

/** P1-78b: the site's place on the severity ladder (src/alerts/ladder.ts), plus the
 *  two states that are not a level: healthy, and a launching site's calm pre-launch. */
export type Tier = "broken" | "attention" | "watch" | "healthy" | "pre-launch";

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
 * category sits in [75,85), the last commit to `main` is older than 30 days, the roster
 * url does not resolve, or the site requires Turnstile without a browser-verified widget.
 * Else 🟢 healthy.
 *
 * Roster gaps are not Watch (#672 step 2, the operator's answer of 2026-10-20): a
 * maintained site on `*.netlify.app`, or with no GA4 property, no Search Console
 * property on its last report lookup (#943), no Git repo or no Netlify ID (#889),
 * goes to `setup`, the card's Setup checklist, and never moves the tier. A site whose
 * only conditions are roster gaps is healthy.
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
 * STRUCTURED filter tags (one `WatchCandidate.signal` each) the client filter keys off.
 * `tier` says which band a site is in; `watchSignals` says which watch conditions it
 * has. They differ on an attention site: its un-accepted watch conditions are still
 * tagged (#941), but its tier and the Watch-card fields stay those of attention.
 */
/** One detected watch condition, before acceptance is applied. `signal` is the
 *  client-filter tag; `acceptKeys` is every string the operator can type to mute it,
 *  PRIMARY FIRST — that primary is the token surfaced on the card for discoverability;
 *  `reason` is the human label. The tuple type guarantees a primary exists. */
type WatchCandidate = {
  signal: string;
  acceptKeys: [string, ...string[]];
  reason: string;
  /** A roster gap (#672 step 2): it goes to the Setup list, never the Watch band. */
  setup?: true;
};

/** One unfilled roster cell on a site's Setup checklist (#672 step 2): no GA4
 *  property, no Search Console property, no git repo, no Netlify ID, or no custom
 *  domain. Setup is not a verdict: it never moves a site's tier, so a site whose
 *  only gaps are these is healthy. `acceptKey` is the primary token that marks
 *  the gap accepted, as for a watch reason. */
export type SetupItem = { signal: string; reason: string; acceptKey: string };

/** Which attention items PIERCE the pre-launch mute. A "launching" site mutes
 *  expected pre-launch conditions (early/absent Lighthouse, errored deploy,
 *  Renovate/analytics warnings) — but a genuine alarm must not hide behind the
 *  mute: 2026-07, a human content push left hedloc's default-branch CI red for
 *  two days and the cockpit hid it; the daily digest (which runs these same
 *  collectors over ALL sites with no pre-launch mute) was the only alarm surface.
 *  The cockpit now surfaces the genuine subset of what the digest already shows —
 *  not a third behavior. Pierces: any CRITICAL-severity item (turnstile guardrail,
 *  notify-bounce, spam complaint, approved-report preflight) plus default-branch
 *  CI red (`kind === "ci"` — warning severity, but a broken repo is never expected
 *  pre-launch noise). A vuln pierces ONLY once Renovate's auto-fix is exhausted —
 *  before that the fleet is still self-patching it and the operator has asked not
 *  to hear about it (a day-zero critical CVE alone must not re-alarm a pre-launch
 *  site while auto-fix is running). PURE. */
export function piercesPreLaunchMute(item: AttentionItem): boolean {
  if (item.kind === "vuln") return item.autoFixExhausted === true;
  // P1-78b (batch 3 Q4): any Broken item pierces, but a launching site's failed
  // deploy stays muted (a site still being built often has one; the collector emits
  // `deploy:` for maintained sites only, and this keeps the rule if that changes).
  if (item.kind === "deploy") return false;
  return itemLevel(item) === "broken" || item.severity === "critical" || item.kind === "ci";
}

/** An item's level: the one `withLevels` set, or, for a hand-built item that never
 *  went through the diff, its level with no date (only Renovate reads the date). */
export function itemLevel(item: AttentionItem): Level {
  return item.level ?? levelOf(item, undefined, new Date(0));
}

export function assignTier(
  site: WebsiteRow,
  allItems: AttentionItem[],
  now: Date,
): {
  tier: Tier;
  watchReasons: string[];
  /** Primary accept token per un-accepted watch reason, index-aligned with
   *  `watchReasons` — the exact string that would mute it (discoverability). */
  watchAcceptKeys: string[];
  watchSignals: string[];
  acceptedReasons: string[];
  /** Un-accepted roster gaps, whatever the tier. Never part of the verdict. */
  setup: SetupItem[];
} {
  // A waiting item is information, never a tier: a scheduled job is still fixing it.
  const items = allItems.filter((it) => it.waiting !== true);
  // Lifecycle short-circuit (FIRST, before any alarm rule): a "launching" site
  // is PRE-LIVE prep, not a live site (Status flips to "maintained" at go-live).
  // Its expected pre-launch conditions — no GA4 property, early/absent Lighthouse,
  // an errored/absent Netlify deploy, Renovate warnings — would otherwise force it
  // to an alarm tier and read as "broken". Mute those as a calm "pre-launch" tier
  // that never alarms and is excluded from the "needs you" feed — but a GENUINE
  // alarm (piercesPreLaunchMute: any Broken item but a deploy, any critical item,
  // or CI red) re-tiers the site to that alarm's level through the normal machinery. (Only "launching" reaches
  // the cockpit — isDashboardVisible = {maintained, launching}.)
  if (site.status === "launching") {
    // Genuine alarms pierce the mute; this attention verdict is decided before the
    // accepted-watch loop, so an operator ack can never silence a pierced alarm —
    // the same invariant the live-site `broken` flag below keeps. Everything else
    // (incl. a failed deploy, checked further below only for live sites) stays
    // muted as expected pre-launch conditions, and a pre-launch site carries no
    // watch tags either: muted means muted.
    if (items.some(piercesPreLaunchMute))
      return {
        tier: worstLevel(
          items.filter(piercesPreLaunchMute).map((it) => ({ level: itemLevel(it) })),
        )!,
        watchReasons: [],
        watchAcceptKeys: [],
        watchSignals: [],
        acceptedReasons: [],
        setup: [],
      };
    return {
      tier: "pre-launch",
      watchReasons: [],
      watchAcceptKeys: [],
      watchSignals: [],
      acceptedReasons: [],
      setup: [],
    };
  }
  // P1-78b: the worst level among the site's items is its verdict; a failed latest
  // production deploy arrives as a Broken `deploy:` item, no longer a flag of its own.
  // The tier is fixed HERE, before acceptance is read, so no accept key can ever move
  // a Broken or Attention site; the watch conditions below are still collected for
  // it, but only as filter tags (#941).
  const level = worstLevel(items.map((it) => ({ level: itemLevel(it) })));

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
  if (site.status === "maintained" && isNetlifyAppUrl(site.url)) {
    candidates.push({
      signal: "no-domain",
      setup: true,
      acceptKeys: ["no custom domain", "no-domain", "netlify", "netlify.app", "on netlify"],
      reason: "on *.netlify.app (no custom domain)",
    });
  }
  if (site.status === "maintained" && !site.ga4PropertyId?.trim()) {
    candidates.push({
      signal: "no-analytics",
      setup: true,
      acceptKeys: ANALYTICS_OPT_OUT_KEYS,
      reason: "GA4 property not recorded (reports carry no analytics)",
    });
  }
  // #943: a Setup gap only when a draft's lookup ran and matched no property. A blank
  // record is not evidence either way, and a soft-fail is unknown, not a finding.
  if (
    site.status === "maintained" &&
    site.searchConsoleOutcome === "no-property" &&
    Number.isFinite(Date.parse(site.searchConsoleCheckedAt ?? ""))
  ) {
    candidates.push({
      signal: "search-console-no-property",
      setup: true,
      acceptKeys: SEARCH_CONSOLE_OPT_OUT_KEYS,
      reason: searchConsoleMissingLabel(site, {
        state: "no-property",
        checkedAt: site.searchConsoleCheckedAt ?? "",
      }),
    });
  }
  // #889. The roster identities the nightly sweeps need. A `maintained` site is
  // exactly the set `selectFleetSites` sweeps, and every sweep that lacks the
  // identity it needs SKIPS the site while the run still concludes success: the
  // checkout sweeps (smoke / security / prismic-drift) cannot clone without
  // `gitRepo`, and `netlify-deploy` skips "no netlify id". The site's report then
  // blocks on checklist items nothing will ever measure (29 Navy, 2026-09-17;
  // beachfront-dentistry, 2026-09-29). Only `maintained`: `hosted-only` is
  // report-eligible but no sweep covers it and the cockpit shows no card for it,
  // so filling these cells would not get it measured. A Setup gap (#672 step 2), not an attention
  // item, because "not on Netlify" is a legitimate state the operator must be
  // able to accept. The Netlify keys deliberately avoid the no-custom-domain
  // keys ("netlify", "on netlify", …), which would otherwise mute both at once.
  // The reasons say what cannot happen, not which code path runs: a blank repo
  // skips at prepare ("no repoUrl or gitRepo"), a whitespace one throws there
  // ("unsafe gitRepo") — both unmeasured. Both readers trim `netlify_id` to null,
  // so the deploy audit skips; were a raw " " ever to reach it, the API read
  // would fail and write nothing, which "cannot read" still describes.
  if (site.status === "maintained" && !site.gitRepo?.trim()) {
    candidates.push({
      signal: "no-git-repo",
      setup: true,
      acceptKeys: ["no git repo", "no-git-repo", "no repo", "git repo"],
      reason: "Git repo not recorded (checkout sweeps cannot clone this site)",
    });
  }
  if (site.status === "maintained" && !site.netlifyId?.trim()) {
    candidates.push({
      signal: "no-netlify-id",
      setup: true,
      acceptKeys: ["no netlify id", "no-netlify-id", "not on netlify", "netlify id"],
      reason: "Netlify ID not recorded (the deploy check cannot read this site)",
    });
  }
  // Require-Turnstile guardrail, watch half: the flag hard-buckets token-less
  // submissions, so a gated site whose widget state ISN'T positively confirmed
  // deserves a nag. A fresh confirmed "fail" is a CRITICAL AttentionItem
  // (collectTurnstileGuardrailAlerts) that sets `broken` BEFORE the accept loop, so it
  // reaches here only to tag its 🔴 card `turnstile-unverified` (#941): an accept key
  // mutes this "can't verify" watch, never the confirmed-missing alarm. `!== "pass"`
  // covers both null (older package /health without a forms block, or the sweep never
  // ran) and a stale "fail" the collector downgraded.
  if (site.requireTurnstile && site.turnstileWidget !== "pass") {
    candidates.push({
      signal: "turnstile-unverified",
      acceptKeys: ["turnstile-unverified", "turnstile unverified", "turnstile"],
      reason:
        site.turnstileWidget === "fail"
          ? "Require Turnstile on; widget broken per a stale browser check"
          : "Require Turnstile on; widget not verified by a browser",
    });
  }

  const watchReasons: string[] = [];
  const watchAcceptKeys: string[] = [];
  const acceptedReasons: string[] = [];
  const setup: SetupItem[] = [];
  const signals = new Set<string>();
  for (const cand of candidates) {
    if (cand.acceptKeys.some((k) => accepted.has(k))) {
      acceptedReasons.push(cand.reason);
    } else if (cand.setup) {
      setup.push({ signal: cand.signal, reason: cand.reason, acceptKey: cand.acceptKeys[0] });
    } else {
      watchReasons.push(cand.reason);
      watchAcceptKeys.push(cand.acceptKeys[0]); // primary/canonical token — surfaced on the card
      signals.add(cand.signal);
    }
  }
  // A broken site keeps its tier and stays out of the watch band: watchReasons,
  // watchAcceptKeys and acceptedReasons are Watch-card content (the Needs-you feed,
  // the verdict and the chips all read them), so they stay empty here. Only the
  // un-accepted watch TAGS ride along, so the card still answers the watch filter
  // chips (`stale`, `url-unresolved`, …) it belongs under. Its Setup gaps ride
  // along too, in `setup`. Before #941 this was an
  // early return with no tags, and every such chip undercounted exactly the sites
  // that were also broken.
  // An Attention item outranks Watch exactly as a Broken one does: accept keys mute
  // Watch reasons, never a level above it.
  if (level === "broken" || level === "attention")
    return {
      tier: level,
      watchReasons: [],
      watchAcceptKeys: [],
      watchSignals: [...signals],
      acceptedReasons: [],
      setup,
    };
  // An accepted dead roster url stays VISIBLE, as a muted chip: the collector drops
  // the Broken item for "url not deployed", and the acceptance would vanish with it.
  if (
    site.status === "maintained" &&
    site.urlResolves === "fail" &&
    urlProbeFresh(site.urlCheckedAt, now) &&
    URL_NOT_DEPLOYED_KEYS.some((k) => accepted.has(k))
  )
    acceptedReasons.push(
      `roster url ${site.url.trim()} does not resolve (${site.urlStatus ?? "no status"})`,
    );
  // A Prismic divergence the operator accepted stays VISIBLE, as a muted chip. The
  // item itself was suppressed upstream (`collectPrismicDriftAlerts`), so without
  // this the site would read as plainly healthy and the acceptance would be
  // invisible — an accepted finding is still a finding, and the expiry date is the
  // part the operator most needs on the card. Not a WatchCandidate: this is already
  // acked by its own column, and routing it through `accepted` would let a stray
  // "prismic" string in Accepted Watch Conditions mute it with no expiry. The rule
  // is the digest's own, `prismicAckCovers`: an ack accepts the report the operator
  // reviewed, so a later finding on the same site gets no chip (#1679).
  if (site.prismicModels === "fail" && prismicAckCovers(site, now)) {
    const until = new Date(Date.parse(site.prismicAckUntil!)).toISOString().slice(0, 10);
    acceptedReasons.push(`Prismic drift accepted until ${until}`);
  }

  // A Watch-level item (a Renovate PR under 7 days, a Prismic check that could not
  // run) puts the site on Watch like a watch condition. It stays an item, shown as
  // its own chip; it is not a watch reason, because no accept key mutes it.
  const hasWatchItem = items.some((it) => itemLevel(it) === "watch");
  return watchReasons.length > 0 || hasWatchItem
    ? {
        tier: "watch",
        watchReasons,
        watchAcceptKeys,
        watchSignals: [...signals],
        acceptedReasons,
        setup,
      }
    : {
        tier: "healthy",
        watchReasons: [],
        watchAcceptKeys: [],
        watchSignals: [],
        acceptedReasons,
        setup,
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
  /** Structured watch tags (`WatchCandidate.signal` values) for the client filter.
   *  Tag membership, not tier membership: an attention card carries them too (#941),
   *  so never count Watch-tier sites by this field — use `tier`. */
  watchSignals: string[];
  /** Watch reasons the operator has accepted: suppressed from the band, shown as a
   *  muted chip. Populated whenever the underlying condition is currently active. */
  acceptedReasons: string[];
  /** Un-accepted roster gaps, the card's Setup checklist (#672 step 2). Not a
   *  verdict: a card's tier never depends on it. Optional for back-compat with
   *  hand-built card fixtures; buildCockpitModel always sets it. */
  setup?: SetupItem[];
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
  broken: number;
  /** P1-78b: sites whose worst item is Attention (fix this week). */
  attention: number;
  watch: number;
  healthy: number;
  /** Count of pre-live "launching" sites still muted as expected pre-launch
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
 *  or holding an unrecognized Status cell.
 *
 *  `status` is the RAW stored cell, not the canonical status (#539 Phase 4).
 *  These two lanes exist to mirror what the store holds so a row can never
 *  silently vanish, and both of them survive on the distinction the canonical
 *  vocabulary erases: `legacy` and `deprecated` both canonicalize to `archived`,
 *  so labelling the lane canonically would render 12 live rows identically and
 *  disagree with the cell the operator is looking at. Everything else about
 *  these rows — which lane they land in — is decided canonically. */
export type OffFleetSiteEntry = { name: string; slug: string; status: string };

export type CockpitModel = {
  summary: CockpitSummary;
  /** All visible sites, ordered: attention (worst-first) → watch (A-Z) → healthy (A-Z). */
  cards: SiteCard[];
  pending: PendingEntry[];
  /** NEW submissions across the fleet, newest-first (optional for back-compat). */
  submissions?: SubmissionEntry[];
  /** Fleet spam totals over the window (optional; populated by buildCockpitModel). */
  /** `computedAt` present ⇒ these came from the nightly roll-up and are up to
   *  24h old; the strip labels them so a stale number is never read as live. */
  spam?: { caught: number; through: number; computedAt?: string } | null;
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
  /** #786. Attention items that belong to NO site card. The grid is built from
   *  the visible sites and items are grouped onto it by `siteName`, so an item
   *  naming a site the fleet does not have matched nothing and was dropped —
   *  silently, on the one surface the operator actually watches.
   *
   *  The collector that produces them is the one whose entire point is that the
   *  site is missing: a dead letter for a slug resolving to no fleet row means
   *  leads are being dropped RIGHT NOW. Kept general rather than
   *  dead-letter-specific, so a future card-less item lands here instead of
   *  vanishing the same way. Optional for back-compat with hand-built models. */
  cardless?: AttentionItem[];
};

export type NeedsYouGroup = "broken" | "attention" | "watch" | "approval";

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
  /** P1-78b. The oldest `firstFlaggedAt` among the site's items at the row's own
   *  level (`YYYY-MM-DD`): the row's age. Null on a Watch or approval row, or when no
   *  item at that level is dated. */
  since: string | null;
};

const NEEDS_YOU_GROUP_RANK: Record<NeedsYouGroup, number> = {
  broken: 0,
  attention: 1,
  watch: 2,
  approval: 3,
};

/**
 * Collapse the cockpit model into a per-site "Needs you" feed — ONE row per site,
 * with every reason combined. PURE. A `waiting` item never enters (markWaiting: the
 * fleet is still fixing it on schedule). P1-78b: a site's group is its level on the
 * ladder: Broken, Attention (fix this week) or Watch. Its items are named worst
 * first; a Watch card names its watch reasons. A vulnerability that reaches the card
 * has failed its wait (or could not be dated), so it is Attention, never a red card
 * in the watch group. Order: broken → attention → watch → approval; within broken,
 * critical-first; then site name.
 */
export function buildNeedsYouFeed(model: CockpitModel): NeedsYouItem[] {
  type Acc = {
    slug: string;
    siteName: string;
    reasons: string[];
    hasCritical: boolean;
    group: NeedsYouGroup | null;
    approval: boolean;
    since: { broken?: string; attention?: string };
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
        group: null,
        approval: false,
        since: {},
      };
      bySlug.set(slug, a);
    }
    return a;
  };
  const raise = (a: Acc, g: NeedsYouGroup): void => {
    if (a.group === null || NEEDS_YOU_GROUP_RANK[g] < NEEDS_YOU_GROUP_RANK[a.group]) a.group = g;
  };

  for (const card of model.cards) {
    // A "pre-launch" card is pre-live prep and never surfaces here. (A launching site
    // with a PIERCING alarm arrives with that alarm's level — assignTier re-tiers it.)
    if (card.tier === "broken" || card.tier === "attention") {
      const a = get(card.site.name);
      const worstFirst = [...card.items].sort(
        (x, y) => LEVEL_RANK[itemLevel(x)] - LEVEL_RANK[itemLevel(y)],
      );
      for (const it of worstFirst) {
        a.reasons.push(it.title);
        if (it.severity === "critical") a.hasCritical = true;
      }
      raise(a, card.tier);
      // The age of each level's oldest item: a Broken row is as old as its oldest
      // Broken item, never an older Attention one beside it.
      for (const it of card.items) {
        const l = itemLevel(it);
        if (l === "watch" || it.firstFlaggedAt === undefined) continue;
        const was = a.since[l];
        if (was === undefined || it.firstFlaggedAt < was) a.since[l] = it.firstFlaggedAt;
      }
    } else if (card.tier === "watch") {
      // Watch-level items first (they are named by title), then the watch reasons.
      const named = [
        ...card.items.filter((it) => itemLevel(it) === "watch").map((it) => it.title),
        ...card.watchReasons,
      ];
      if (named.length > 0) {
        const a = get(card.site.name);
        for (const r of named) a.reasons.push(r);
        raise(a, "watch");
      }
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
      `Status "${u.status}" is not a recognized value — fix it in the site's details (site is invisible to fleet ops)`,
    );
    raise(a, "watch");
  }

  const items: NeedsYouItem[] = [];
  for (const a of bySlug.values()) {
    if (a.reasons.length === 0) continue;
    const group: NeedsYouGroup = a.group ?? "approval";
    items.push({
      group,
      hasCritical: a.hasCritical,
      slug: a.slug,
      siteName: a.siteName,
      reasons: a.reasons,
      url: `/s/${a.slug}`,
      since: group === "broken" || group === "attention" ? (a.since[group] ?? null) : null,
    });
  }

  items.sort((x, y) => {
    if (NEEDS_YOU_GROUP_RANK[x.group] !== NEEDS_YOU_GROUP_RANK[y.group])
      return NEEDS_YOU_GROUP_RANK[x.group] - NEEDS_YOU_GROUP_RANK[y.group];
    if (x.group === "broken" && x.hasCritical !== y.hasCritical) return x.hasCritical ? -1 : 1;
    // Then by age, oldest first: a dated row before an undated one.
    if (x.since !== y.since) {
      if (x.since === null) return 1;
      if (y.since === null) return -1;
      return x.since < y.since ? -1 : 1;
    }
    return x.siteName.toLowerCase().localeCompare(y.siteName.toLowerCase());
  });

  return items;
}

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1 };
const TIER_RANK: Record<Tier, number> = {
  broken: 0,
  attention: 1,
  watch: 2,
  healthy: 3,
  "pre-launch": 4,
};

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
  notifyBounces: ReadonlyMap<string, NotifyBounceCounts>,
  // #645. Unreplayed dead-letter rows per SLUG (countUnreplayedDeadLettersBySlug).
  // Optional like every other libSQL input: a Turso blip drops the signal, never
  // the cockpit.
  deadLetters: ReadonlyMap<string, number> = new Map(),
  // OD 87. The oldest unreplayed row's received_at per slug
  // (oldestUnreplayedDeadLetterBySlug): a known site's dead letter waits two replay
  // cycles from it. Empty on a blip, and then nothing waits.
  deadLetterOldest: ReadonlyMap<string, string> = new Map(),
  // The rows a dead-letter slug resolves against. The cockpit passes the WHOLE
  // roster, as the digest does: ingest and replay place a lead by `getSiteBySlug`,
  // which ignores status, so an archived site's slug is known, not "NO fleet site",
  // and OD 87 holds it on both surfaces alike.
  deadLetterSites: WebsiteRow[] = sites,
  // P1-78c. The latest `fleet_daily` row's per-site dependency readings, from which
  // a package's age is read. Null on a blip or before the first night: no deps items.
  deps: LatestDeps | null = null,
): AttentionItem[] {
  const depsItems = collectDepsAlerts(sites, deps, baseUrl, now);
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
    ...collectDeadLetterAlerts(deadLetterSites, deadLetters, baseUrl, deadLetterOldest),
    // Reads the nightly-persisted `Prismic Models` verdict columns — no live
    // Prismic/GitHub call, so this stays safe on the request path (the cockpit is
    // request-path; a collector that shelled out would 502 in Lambda).
    ...collectPrismicDriftAlerts(sites, baseUrl, now),
    // P1-78b. The roster url probe joins the cockpit: `url-unresolved:<id>` is Broken
    // on its site's card (it replaced the Watch candidate), and the fleet-wide
    // `url-probe-stale` matches no card, so it lands among the cardless items.
    // The probe's own staleness is counted over the whole roster, as the digest does,
    // so its metric and key agree with the snapshot; a dead url only on a visible card.
    ...collectUrlResolveAlerts(deadLetterSites, baseUrl, now).filter(
      (it) => it.key === "url-probe-stale" || sitesById.has(it.key.slice("url-unresolved:".length)),
    ),
    // P1-78b. A maintained site's failed production deploy, as a dated Broken item.
    ...collectDeployAlerts(sites, baseUrl),
    // P1-78c. The production signals the nightly audits store (production-signals.ts).
    // Broken and Attention are also in the digest's collectAttention; Watch
    // (dependencies behind, Search Console) is the cockpit's only. The live form test
    // and smoke are built but NOT registered: every failure on 2026-10-26 was false
    // (#1736, #1737, #1777), and the operator chose to wire each once its probe is
    // fixed (workspace decisions/2026-10-27-0131-p1-78c-form-and-smoke-wiring.md).
    ...collectUptimeAlerts(sites, baseUrl, now),
    ...collectDomainAlerts(sites, baseUrl, now),
    ...collectFunctionHealthAlerts(sites, baseUrl, now),
    ...collectRenderAlerts(sites, baseUrl, now),
    ...collectLinkAlerts(sites, baseUrl, now),
    ...collectTitleMetaAlerts(sites, baseUrl, now),
    ...collectA11yAlerts(sites, baseUrl, now),
    ...depsItems.far,
    ...depsItems.behind,
    ...collectSearchConsoleAlerts(sites, baseUrl, now),
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
  /** Un-accepted roster gaps (#672 step 2), shown apart from the verdict. */
  setup: SetupItem[];
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
  notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map(),
  deadLetters: ReadonlyMap<string, number> = new Map(),
  // The digest snapshot, read only for each key's `firstFlaggedAt`, so a waiting
  // item escalates here on the same day it does on the cockpit. Absent or empty,
  // nothing waits (markWaiting: missing data never mutes).
  priorSnapshot: DigestSnapshot = {},
  // OD 87, as in collectFleetAttentionItems. A held dead letter shows here as a
  // `waiting:` chip, the precedent #1199 set for a vuln Renovate is still fixing.
  deadLetterOldest: ReadonlyMap<string, string> = new Map(),
  // P1-78c, as in collectFleetAttentionItems.
  deps: LatestDeps | null = null,
): SiteAlarmContext {
  const sites = [site];
  const sitesById = new Map([[site.id, site]]);
  // The fleet-wide `url-probe-stale` is about the probe, not this site: it belongs to
  // no site's page, as it belongs to no card on the cockpit.
  const raw = collectFleetAttentionItems(
    sites,
    sitesById,
    reports,
    baseUrl,
    now,
    notifyBounces,
    deadLetters,
    deadLetterOldest,
    sites,
    deps,
  ).filter((it) => it.key !== "url-probe-stale");
  const { next } = diffAttention(raw, priorSnapshot, now.toISOString().slice(0, 10));
  const items = withLevels(
    markWaiting(raw, next, now, Object.keys(priorSnapshot).length > 0),
    next,
    now,
  )
    .map(undated)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const {
    tier,
    watchReasons,
    watchAcceptKeys,
    watchSignals: _ws,
    acceptedReasons,
    setup,
  } = assignTier(site, items, now);
  return { tier, items, watchReasons, watchAcceptKeys, acceptedReasons, setup };
}

/**
 * Assemble the render-ready cockpit model from already-fetched fleet rows. PURE
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
  spamTotals: {
    honeypot: number;
    tooFast: number;
    markedSpam: number;
    /** When the nightly digest computed these. The figures are up to 24h
     *  old by construction, so the strip says so rather than reading live. */
    computedAt?: string;
  } | null = null,
  recentEvents: FleetEvent[] = [],
  autoFilteredCount = 0,
  // Per-site bounced-lead-notification counts (countNotifyBouncedBySite, last
  // NOTIFY_BOUNCE_WINDOW_DAYS). Optional like the other libSQL inputs: a Turso
  // blip drops the signal, never the cockpit (2026-07-16).
  notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map(),
  // #645. Unreplayed dead-letter rows per slug. A slug with no matching visible
  // card still produces an item (siteName `(unknown site: …)`) — see
  // `collectDeadLetterAlerts`; the cockpit's card grid has nowhere to hang it,
  // so the DIGEST is the surface that carries that flavour. A dead letter on a
  // site the fleet does know lands on that site's card like any other item.
  deadLetters: ReadonlyMap<string, number> = new Map(),
  // OD 87, as in collectFleetAttentionItems: a held dead letter leaves the card and
  // the Needs-you feed until two replay cycles after its oldest row.
  deadLetterOldest: ReadonlyMap<string, string> = new Map(),
  // P1-78c, as in collectFleetAttentionItems.
  deps: LatestDeps | null = null,
): CockpitModel {
  const visible = websites.filter(isDashboardVisible);
  const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));

  // Off-fleet visibility: archived rows get a neutral roster lane; a typo'd Status
  // (outside the union) gets an amber watch row in the Needs-you feed. Both are
  // read-only surfacing — neither joins `visible`, so no fleet op gains a site.
  //
  // Membership is decided on the CANONICAL status; the label is the RAW cell.
  // These lanes are the fleet's mirror of the store, and `legacy`/`deprecated` are
  // the one pair the canonical vocabulary merges — labelling them `archived`
  // would collapse 12 distinguishable live rows into one indistinguishable
  // label and disagree with the cell it mirrors.
  //
  // The typo lane reads `statusRaw` for the same REASON, though not for the same
  // effect: canonicalization passes an unrecognized value through verbatim, so a
  // row in that lane always has `statusRaw === status`. Writing it this way is
  // consistency, not a fix — and it stays correct if that ever stops being true.
  const archived: OffFleetSiteEntry[] = websites
    .filter((w) => isArchivedStatus(w.status))
    .map((w) => ({
      name: w.name,
      slug: siteSlug(w.name),
      status: w.statusRaw ?? (w.status as string),
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const unrecognizedStatus: OffFleetSiteEntry[] = websites
    .filter((w) => isUnrecognizedStatus(w.status))
    .map((w) => ({
      name: w.name,
      slug: siteSlug(w.name),
      status: w.statusRaw ?? (w.status as string),
    }));

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
    deadLetters,
    deadLetterOldest,
    // Visible rows LAST, so where two rows' names give one slug the visible site
    // (the card the operator watches) wins it, not an archived namesake.
    [...websites.filter((w) => !isDashboardVisible(w)), ...visible],
    deps,
  );
  // Read-only diff: tag NEW/WORSE exactly as the email does. `next` is never written;
  // it only carries each key's `firstFlaggedAt` into markWaiting. A waiting item leaves
  // the cards (tiers, chips, the Needs-you feed) and stays on the site's own page.
  const diffed = diffAttention(rawItems, priorSnapshot, now.toISOString().slice(0, 10));
  const tagged = withLevels(
    markWaiting(diffed.tagged, diffed.next, now, Object.keys(priorSnapshot).length > 0),
    diffed.next,
    now,
  ).map(undated);

  // Group by siteName (the collectors set siteName from the row). This relies on the
  // fleet-wide name→slug uniqueness invariant the /s/<slug> lookup already assumes; if
  // two visible sites ever shared a name they'd share a card. Acceptable for slice 1.
  const bySite = new Map<string, AttentionItem[]>();
  for (const it of tagged) {
    if (it.waiting === true) continue;
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
    const items = site.status === "launching" ? collected.filter(piercesPreLaunchMute) : collected;
    const { tier, watchReasons, watchAcceptKeys, watchSignals, acceptedReasons, setup } =
      assignTier(site, items, now);
    const c = subCountBySite.get(site.id) ?? { leads: 0, signups: 0 };
    return {
      site,
      tier,
      items,
      watchReasons,
      watchAcceptKeys,
      watchSignals,
      acceptedReasons,
      setup,
      newSubmissions: c.leads + c.signups,
      newLeads: c.leads,
      newSignups: c.signups,
    };
  });

  cards.sort((a, b) => {
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (a.tier === "broken" || a.tier === "attention") {
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
  // Mirror isPendingApproval's predicate. Resolve against ALL websites (a pending
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

  // #786. Anything that found no card. `cards` is built from the visible sites,
  // so this is exactly the set that the siteName grouping above dropped on the
  // floor — today, the `(unknown site: <slug>)` dead letters.
  const cardedNames = new Set(cards.map((c) => c.site.name));
  const cardless = tagged.filter((it) => !cardedNames.has(it.siteName));

  const summary: CockpitSummary = {
    broken: cards.filter((c) => c.tier === "broken").length,
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
    cardless,
    pending,
    submissions,
    spam: spamTotals
      ? {
          caught: spamTotals.honeypot + spamTotals.tooFast,
          through: spamTotals.markedSpam,
          ...(spamTotals.computedAt !== undefined ? { computedAt: spamTotals.computedAt } : {}),
        }
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
