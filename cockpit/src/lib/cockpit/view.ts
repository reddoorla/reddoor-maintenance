import type {
  CockpitModel,
  NeedsYouGroup,
  NeedsYouItem,
  SiteCard,
  Tier,
} from "../../../../src/dashboard/fleet-cockpit.js";
import {
  buildNeedsYouFeed,
  fleetLastAuditedAt,
  isFailedDeployStatus,
  isReadyDeployStatus,
} from "../../../../src/dashboard/fleet-cockpit.js";
import { onboardingStatus, missingOnboarding } from "../../../../src/dashboard/onboarding.js";
import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
import { daysFlagged, LEVEL_RANK, levelOf, type Level } from "../../../../src/alerts/ladder.js";
import { isLeadFormType } from "../../../../src/forms/types.js";
import type { FleetEventType } from "../../../../src/db/fleet-events.js";
import type { WebsiteRow } from "../../../../src/fleet/site-row.js";
import { siteSlug } from "../../../../src/fleet/site-row.js";
import { safeUrl } from "../../../../src/util/html.js";

/**
 * The cockpit page (`/`) as render-ready data. Every string the page shows is
 * decided here, on the server, from the same helpers the string renderer
 * (`fleet-render.ts`, `fleet-browse-render.ts`) used: the components only lay
 * it out, so the client bundle carries none of the fleet modules, and the
 * hydrated page shows exactly what the server rendered. Plain data only — it
 * crosses to the browser through SvelteKit's serializer.
 */

const DASH = "—";

export type VerdictView = {
  /** ok = nothing needs you, warn = broken, attention = fix this week, watch = watch,
   *  soft = approvals only. */
  cls: "ok" | "warn" | "attention" | "watch" | "soft";
  line: string;
  meta: string;
};

export type FeedRowView = {
  group: NeedsYouGroup;
  siteName: string;
  reasons: string;
  url: string;
  /** P1-78b: how long a Broken or Attention row has stood, from the digest's
   *  `firstFlaggedAt` ("since today", "for 6 days"); null when undated. */
  age: string | null;
};
export type FeedGroupView = { group: NeedsYouGroup; label: string; rows: FeedRowView[] };

export type ChipView = {
  cls: string;
  badge: "NEW" | "WORSE" | null;
  text: string;
  title: string | null;
};

export type DeployView =
  | { kind: "unknown" }
  | { kind: "link"; cls: string; label: string; href: string }
  | { kind: "text"; cls: string; label: string };

/** One unfilled roster cell on a Setup checklist (#672 step 2): what is
 *  missing, and the exact text that marks it accepted. */
export type SetupGapView = { reason: string; acceptKey: string };

/** A site's card health, shown on its Sites row (#672 step 3). The name, URL,
 *  scores and audit date are the table's own columns, so they are not here. */
export type CardView = {
  signals: string;
  setupTitle: string;
  setupScore: string;
  a11y: string;
  deps: string;
  sec: string;
  deploy: DeployView;
  tier: Tier;
  pill: string;
  chips: ChipView[];
  /** The card's Setup checklist: roster gaps, apart from the verdict. */
  setupGaps: SetupGapView[];
  submissions: string | null;
};

export type RecentRowView = {
  type: FleetEventType;
  icon: string;
  siteName: string | null;
  summary: string;
  when: string;
  link: { href: string; text: string } | null;
};

export type InboxRowView = {
  key: string;
  siteName: string;
  what: string;
  when: string;
  href: string;
};

export type InboxView = {
  summary: string;
  rows: InboxRowView[];
  /** Null when there are no submissions (only the spam lines show). */
  more: { text: string } | null;
  spamLine: string | null;
  autoFiltered: number | null;
};

export type CockpitView = {
  total: number;
  verdict: VerdictView;
  feedCount: number;
  feed: FeedGroupView[];
  /** Sites with roster gaps, and each one's gaps (#672 step 2). Null when none. */
  setup: {
    count: number;
    rows: Array<{ name: string; href: string; gaps: SetupGapView[] }>;
  } | null;
  /** Attention items on no site card (#786). A held one (OD 87) is left out. A
   *  dead letter carrying a `url` links its site: a site with no card (archived)
   *  still has its page, while a slug that resolves to no site has none. */
  cardless: Array<{
    siteName: string;
    title: string;
    href: string | null;
    /** P1-78b: grouped by level, worst first, each row naming its level. */
    level: Level;
    levelLabel: string;
    /** P1-78b: how long it has stood ("for 6 days"); null when undated. */
    age: string | null;
  }>;
  inbox: InboxView | null;
};

/** Per-band site counts for the verdict, derived from the Needs-you feed. */
function needsYouCounts(feed: NeedsYouItem[]) {
  const n = { broken: 0, attention: 0, watch: 0, approval: 0 };
  for (const i of feed) n[i.group]++;
  return n;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The glance verdict, on the ladder (P1-78b): "1 site broken · 2 need attention ·
 *  3 to watch · 1 waiting on your yes". Each band that has sites is named, worst
 *  first; the colour is the worst band's. Green "✓ All clear" on an empty feed. The
 *  healthy, pre-launch and archived counts and the audit recency ride in the meta
 *  line (zero terms omitted). */
function verdict(model: CockpitModel, feed: NeedsYouItem[], now: Date): VerdictView {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const auditedTerm = auditedIso
    ? `fleet last audited ${relativeTimeFromNow(auditedIso, now)}`
    : null;
  const total = model.cards.length;
  const fed = needsYouCounts(feed);
  // An item on no site card (an unknown-slug dead letter, the stale url probe) is
  // still on this page, so it counts in the verdict too: one row each, never "All clear".
  const cardless = (model.cardless ?? []).filter((i) => i.waiting !== true);
  const cardlessAt = (l: Level) =>
    cardless.filter((i) => (i.level ?? levelOf(i, undefined, now)) === l).length;
  const broken = fed.broken + cardlessAt("broken");
  const attention = fed.attention + cardlessAt("attention");
  const { watch, approval } = fed;
  // Pre-launch cards never enter the feed and are neither healthy nor broken.
  const preLaunch = model.summary.preLaunch;
  const preLaunchTerm = preLaunch > 0 ? `${preLaunch} pre-launch` : null;
  // Archived rows are not in model.cards, so they never join the healthy math.
  const archivedCount = model.archived?.length ?? 0;
  const archivedTerm = archivedCount > 0 ? `${archivedCount} archived` : null;
  // Clamp: feed counts include pending-report sites, which may not be among the
  // visible cards, so total − feed could otherwise underflow.
  const healthy = Math.max(0, total - (fed.broken + fed.attention + watch + approval + preLaunch));
  const make = (cls: VerdictView["cls"], line: string, terms: Array<string | null>) => ({
    cls,
    line,
    meta: terms.filter(Boolean).join(" · "),
  });

  if (broken + attention + watch + approval === 0) {
    const healthyWord = healthy > 0 ? `${healthy} site${healthy === 1 ? "" : "s"} healthy` : null;
    return make("ok", "✓ All clear", [healthyWord, preLaunchTerm, archivedTerm, auditedTerm]);
  }
  const line = [
    broken > 0 ? `${broken} ${plural(broken, "site", "sites")} broken` : null,
    attention > 0 ? `${attention} ${plural(attention, "needs", "need")} attention` : null,
    watch > 0 ? `${watch} to watch` : null,
    approval > 0 ? `${approval} waiting on your yes` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const healthyTerm = healthy > 0 ? `${healthy} healthy` : null;
  const cls: VerdictView["cls"] =
    broken > 0 ? "warn" : attention > 0 ? "attention" : watch > 0 ? "watch" : "soft";
  return make(cls, line, [healthyTerm, preLaunchTerm, archivedTerm, auditedTerm]);
}

const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  attention: "Attention",
  watch: "Watch",
  approval: "Waiting on your yes",
};

const LEVEL_LABEL: Record<Level, string> = {
  broken: "Broken",
  attention: "Attention",
  watch: "Watch",
};

function ageOf(since: string | null, now: Date): string | null {
  if (since === null) return null;
  const days = daysFlagged(since, now);
  return days === 0 ? "since today" : `for ${days} day${days === 1 ? "" : "s"}`;
}

function feedGroups(feed: NeedsYouItem[], now: Date): FeedGroupView[] {
  return (["broken", "attention", "watch", "approval"] as const)
    .map((g) => ({
      group: g,
      label: NEEDS_YOU_GROUP_LABEL[g],
      rows: feed
        .filter((i) => i.group === g)
        .map((i) => ({
          group: g,
          siteName: i.siteName,
          reasons: i.reasons.join(" · "),
          url: i.url,
          age: ageOf(i.since, now),
        })),
    }))
    .filter((g) => g.rows.length > 0);
}

// ---- a site's card health, shown on its Sites row (was the browse panel's card) ----

function a11yDisplay(value: number | null, scanned: number | null, total: number | null): string {
  const partial = value !== null && scanned !== null && total !== null && scanned < total;
  return value === null ? DASH : partial ? `${value} (${scanned}/${total} routes)` : String(value);
}

function depsDisplay(
  drifted: number | null,
  majorBehind: number | null,
  outdated: number | null,
  majorOutdated: number | null,
): string {
  if (drifted === null || majorBehind === null) return DASH;
  // Declared-range drift vs baseline, plus the real outdated-install count when
  // it was determined (null = not checked this run → omit, don't imply clean).
  const driftPart = drifted === 0 ? "0" : `${drifted} drifted (${majorBehind} major)`;
  const outdatedPart =
    outdated === null
      ? ""
      : ` · ${outdated} outdated${majorOutdated === null ? "" : ` (${majorOutdated} major)`}`;
  return driftPart + outdatedPart;
}

function securityDisplay(
  critical: number | null,
  high: number | null,
  moderate: number | null,
  low: number | null,
): string {
  if (critical === null || high === null || moderate === null || low === null) return DASH;
  const total = critical + high + moderate + low;
  return total === 0 ? "0" : `${critical}C/${high}H/${moderate}M/${low}L`;
}

/** Green = ready/success, red = failed, amber = anything else; grey "—" when no
 *  deploy was read. Linked only to a real http(s) deploy log: `safeUrl`
 *  allowlists the scheme, and its "#" fallback would be a dead link. */
function deployView(site: WebsiteRow, now: Date): DeployView {
  const state = site.deployStatus;
  if (state === null) return { kind: "unknown" };
  const cls = isReadyDeployStatus(state)
    ? "deploy ready"
    : isFailedDeployStatus(state)
      ? "deploy failed"
      : "deploy building";
  const when = relativeTimeFromNow(site.lastDeployAt, now);
  const label = `${state}${when !== DASH ? ` · ${when}` : ""}`;
  const url = site.deployLogUrl ? safeUrl(site.deployLogUrl) : "#";
  return url !== "#" ? { kind: "link", cls, label, href: url } : { kind: "text", cls, label };
}

const PILL_LABEL: Record<Tier, string> = {
  broken: "broken",
  attention: "attention",
  watch: "watch",
  healthy: "ok",
  "pre-launch": "pre-launch",
};

const WATCH_CHIP_TITLE =
  "Add this exact text to the site's Accepted Watch Conditions to mute this watch";

function chips(c: SiteCard): ChipView[] {
  const out: ChipView[] = c.items.map((it) => ({
    cls: it.autoFixExhausted
      ? "chip critical stuck"
      : it.severity === "critical"
        ? "chip critical"
        : "chip",
    badge: it.status === "new" ? "NEW" : it.status === "worse" ? "WORSE" : null,
    text: it.title,
    title: null,
  }));
  // The exact accept token rides beside each watch chip, so the operator can
  // discover what string mutes it.
  const acceptKeys = c.watchAcceptKeys ?? [];
  c.watchReasons.forEach((reason, i) => {
    const key = acceptKeys[i];
    out.push({
      cls: "chip",
      badge: null,
      text: `${reason}${key ? ` · accept: "${key}"` : ""}`,
      title: WATCH_CHIP_TITLE,
    });
  });
  for (const reason of c.acceptedReasons)
    out.push({ cls: "chip accepted", badge: null, text: `✓ accepted: ${reason}`, title: null });
  return out;
}

/** Space-separated signal tags for the client filter: attention-item kinds plus
 *  the structured watch signals, so a watch-band Lighthouse card still matches
 *  the "lighthouse" filter. */
function signals(c: SiteCard): string {
  const kinds = new Set<string>();
  for (const it of c.items) {
    // A `url` item tags by its key's flavour, so `url-unresolved` keeps the filter the
    // Watch candidate it replaced (P1-78b) carried.
    kinds.add(
      it.kind === "vuln"
        ? "vulns"
        : it.kind === "renovate"
          ? "prs"
          : it.kind === "url"
            ? it.key.split(":")[0]!
            : it.kind,
    );
  }
  if (c.items.some((it) => it.autoFixExhausted)) kinds.add("auto-fix-failed");
  for (const sig of c.watchSignals) kinds.add(sig);
  // Roster gaps left the Watch band (#672 step 2) but keep their filter chips.
  for (const gap of c.setup ?? []) kinds.add(gap.signal);
  return [...kinds].join(" ");
}

function submissionsBadge(c: SiteCard): string | null {
  // Legacy cards without the lead/signup split label the whole count "new".
  const leads = c.newLeads ?? c.newSubmissions ?? 0;
  const signups = c.newSignups ?? 0;
  if (leads === 0 && signups === 0) return null;
  return leads > 0 && signups > 0
    ? `📥 ${leads} new · +${signups} newsletter`
    : leads > 0
      ? `📥 ${leads} new`
      : `📥 +${signups} newsletter`;
}

function cardView(c: SiteCard, now: Date): CardView {
  const site = c.site;
  const onboarding = onboardingStatus(site, now);
  const missing = missingOnboarding(site, now);
  return {
    signals: signals(c),
    // "Complete" only when no roster gap is open either: the card's Setup
    // checklist lists those, and the two must never disagree (#672 step 2).
    setupTitle: setupTitle(missing, (c.setup ?? []).length),
    setupScore: `${onboarding.score}/${onboarding.total}`,
    a11y: a11yDisplay(site.a11yViolations, site.a11yRoutesScanned, site.a11yRoutesTotal),
    deps: depsDisplay(
      site.depsDrifted,
      site.depsMajorBehind,
      site.depsOutdated,
      site.depsMajorOutdated,
    ),
    sec: securityDisplay(
      site.securityVulnsCritical,
      site.securityVulnsHigh,
      site.securityVulnsModerate,
      site.securityVulnsLow,
    ),
    deploy: deployView(site, now),
    tier: c.tier,
    pill: PILL_LABEL[c.tier],
    chips: chips(c),
    setupGaps: setupGaps(c),
    submissions: submissionsBadge(c),
  };
}

function setupTitle(missing: string[], gaps: number): string {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Missing: ${missing.join(", ")}`);
  if (gaps > 0) parts.push(`${gaps} roster gap${gaps === 1 ? "" : "s"} open`);
  return parts.length === 0 ? "Setup complete" : parts.join("; ");
}

function setupGaps(c: SiteCard): SetupGapView[] {
  return (c.setup ?? []).map((g) => ({ reason: g.reason, acceptKey: g.acceptKey }));
}

/** The Setup lane on `/`: every card with a roster gap, in card order. Setup is
 *  not a verdict, so it is counted apart from the verdict bar. */
function setupLane(model: CockpitModel): CockpitView["setup"] {
  const rows = model.cards
    .filter((c) => (c.setup ?? []).length > 0)
    .map((c) => ({ name: c.site.name, href: `/s/${siteSlug(c.site.name)}`, gaps: setupGaps(c) }));
  return rows.length === 0 ? null : { count: rows.length, rows };
}

/** Signal filters for Sites' chips — card-derived tags only. */
export const FLEET_FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "auto-fix-failed",
  "stale",
  "no-domain",
  "no-analytics",
  "search-console-no-property",
  "no-git-repo",
  "no-netlify-id",
  "url-unresolved",
] as const;

// ---- lanes ----

const RECENT_ICON: Record<FleetEventType, string> = {
  pr_automerged: "🔧",
  vuln_cleared: "🛡",
  ci_recovered: "✅",
  site_launched: "🚀",
  cert_renewed: "🔒",
  fleet_swept: "🔄",
  report_sent_with_override: "✳️",
};

function recently(model: CockpitModel, now: Date): RecentRowView[] {
  return (model.recent ?? []).map((e) => ({
    type: e.type,
    icon: RECENT_ICON[e.type] ?? "•",
    siteName: e.siteName || null,
    summary: e.summary,
    when: relativeTimeFromNow(e.ts, now),
    link: e.url
      ? { href: e.url, text: "view ▸" }
      : e.slug
        ? { href: `/s/${e.slug}`, text: "open ▸" }
        : null,
  }));
}

/** Most submissions to render in the cockpit inbox lane. The summary still shows
 *  the true fleet total; overflow is triaged on each site's page. */
const SUBMISSIONS_STRIP_CAP = 10;

function inbox(model: CockpitModel, now: Date): InboxView | null {
  const subs = model.submissions ?? [];
  const spam = model.spam;
  const hasSpam = !!spam && (spam.caught > 0 || spam.through > 0);
  const autoFiltered = model.autoFiltered ?? 0;
  if (subs.length === 0 && !hasSpam && autoFiltered <= 0) return null;

  const shown = [...subs]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_STRIP_CAP);
  const overflow = subs.length - shown.length;
  // The spam numbers come from the nightly roll-up, up to 24h old, so the line
  // says when they were taken.
  const spamAsOf =
    spam?.computedAt !== undefined
      ? ` · as of ${spam.computedAt.slice(0, 16).replace("T", " ")} UTC`
      : "";
  // Actionable leads vs newsletter/rsvp signups: a signup backlog must not read
  // as N leads waiting. The signup term only appears when nonzero.
  const leads = subs.filter((s) => isLeadFormType(s.formType)).length;
  const signups = subs.length - leads;
  const count = signups === 0 ? `${leads} new` : `${leads} new · +${signups} newsletter/rsvp`;
  return {
    summary: `📥 Submissions (${count})${hasSpam ? " · 🛡 Spam (30d)" : ""}`,
    rows: shown.map((sub, i) => ({
      key: `${i}:${sub.submissionId}`,
      siteName: sub.siteName,
      what: `${sub.formType} — ${sub.name || sub.email}`,
      when: sub.submittedAt ? relativeTimeFromNow(sub.submittedAt, now) : "",
      href: `/s/${sub.slug}`,
    })),
    more:
      subs.length === 0
        ? null
        : {
            text:
              overflow > 0 ? `+${overflow} more — view all submissions` : "View all submissions →",
          },
    spamLine: hasSpam
      ? `🛡 Spam (30d) — caught ${spam!.caught} · through ${spam!.through}${spamAsOf}`
      : null,
    autoFiltered: autoFiltered > 0 ? autoFiltered : null,
  };
}

/** Build the whole page. `now` stands in for every "Xm ago" the renderer took
 *  from the wall clock. */
export function buildCockpitView(model: CockpitModel, now: Date): CockpitView {
  const feed = buildNeedsYouFeed(model);
  return {
    total: model.cards.length,
    verdict: verdict(model, feed, now),
    feedCount: feed.length,
    feed: feedGroups(feed, now),
    setup: setupLane(model),
    cardless: (model.cardless ?? [])
      .filter((i) => i.waiting !== true)
      .map((i) => {
        const level = i.level ?? levelOf(i, undefined, now);
        return {
          siteName: i.siteName,
          title: i.title,
          href: i.kind === "deadletter" && i.url ? i.url : null,
          level,
          levelLabel: LEVEL_LABEL[level],
          age: level === "watch" ? null : ageOf(i.firstFlaggedAt ?? null, now),
        };
      })
      .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]),
    inbox: inbox(model, now),
  };
}

/** Sites (`/fleet`), the inventory the browse panel merged into (#672 step 3):
 *  each visible site's card health keyed by its slug (the table's rows carry
 *  the slug), the signal filters, and the Recently and Archived lanes, which
 *  moved here from `/`. A table row with no card (an archived or building
 *  site) has no entry in `cards`. */
export type SitesView = {
  filters: readonly string[];
  cards: Record<string, CardView>;
  recently: RecentRowView[];
  archived: Array<{ name: string; status: string; slug: string }>;
};

export function buildSitesView(model: CockpitModel, now: Date): SitesView {
  const cards: Record<string, CardView> = {};
  for (const c of model.cards) cards[siteSlug(c.site.name)] = cardView(c, now);
  return {
    filters: FLEET_FILTERS,
    cards,
    recently: recently(model, now),
    archived: (model.archived ?? []).map((s) => ({ name: s.name, status: s.status, slug: s.slug })),
  };
}
