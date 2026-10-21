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
  /** ok = nothing needs you, warn = broken, watch = watch, soft = approvals only. */
  cls: "ok" | "warn" | "watch" | "soft";
  line: string;
  meta: string;
};

export type FeedRowView = { group: NeedsYouGroup; siteName: string; reasons: string; url: string };
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

export type CardView = {
  key: string;
  signals: string;
  href: string;
  name: string;
  siteHref: string;
  visibleUrl: string;
  setupTitle: string;
  setupScore: string;
  audited: string;
  perf: string;
  a11yLh: string;
  bp: string;
  seo: string;
  a11y: string;
  deps: string;
  sec: string;
  deploy: DeployView;
  tier: Tier;
  pill: string;
  chips: ChipView[];
  submissions: string | null;
  triggerUrl: string | null;
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
  browse: { total: number; filters: readonly string[]; cards: CardView[] };
  recently: RecentRowView[];
  archived: Array<{ name: string; status: string; slug: string }>;
  /** Attention items on no site card (#786). A held one (OD 87) is left out. A
   *  dead letter carrying a `url` links its site: a site with no card (archived)
   *  still has its page, while a slug that resolves to no site has none. */
  cardless: Array<{ siteName: string; title: string; href: string | null }>;
  inbox: InboxView | null;
};

/** Per-band site counts for the verdict, derived from the Needs-you feed. */
function needsYouCounts(feed: NeedsYouItem[]) {
  let broken = 0;
  let watch = 0;
  let approval = 0;
  for (const i of feed) {
    if (i.group === "broken") broken++;
    else if (i.group === "watch") watch++;
    else approval++;
  }
  return { broken, watch, approval };
}

/** The glance verdict — worst band wins. Green "✓ All clear" on an empty feed;
 *  else red (any broken), amber (watch, nothing broken), or blue (only
 *  approvals). Every lower band's count + the healthy count ride in the meta
 *  line (zero terms omitted), followed by the audit-recency suffix. */
function verdict(model: CockpitModel, feed: NeedsYouItem[], now: Date): VerdictView {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const auditedTerm = auditedIso
    ? `fleet last audited ${relativeTimeFromNow(auditedIso, now)}`
    : null;
  const total = model.cards.length;
  const { broken, watch, approval } = needsYouCounts(feed);
  // Pre-launch cards never enter the feed and are neither healthy nor broken.
  const preLaunch = model.summary.preLaunch;
  const preLaunchTerm = preLaunch > 0 ? `${preLaunch} pre-launch` : null;
  // Archived rows are not in model.cards, so they never join the healthy math.
  const archivedCount = model.archived?.length ?? 0;
  const archivedTerm = archivedCount > 0 ? `${archivedCount} archived` : null;
  // Clamp: feed counts include pending-report sites, which may not be among the
  // visible cards, so total − feed could otherwise underflow.
  const healthy = Math.max(0, total - (broken + watch + approval + preLaunch));
  const make = (cls: VerdictView["cls"], line: string, terms: Array<string | null>) => ({
    cls,
    line,
    meta: terms.filter(Boolean).join(" · "),
  });

  if (broken === 0 && watch === 0 && approval === 0) {
    const healthyWord = healthy > 0 ? `${healthy} site${healthy === 1 ? "" : "s"} healthy` : null;
    return make("ok", "✓ All clear", [healthyWord, preLaunchTerm, archivedTerm, auditedTerm]);
  }
  const watchTerm = watch > 0 ? `${watch} watching` : null;
  const approvalTerm = approval > 0 ? `${approval} waiting on you` : null;
  const healthyTerm = healthy > 0 ? `${healthy} healthy` : null;
  if (broken > 0) {
    return make("warn", `⚠ ${broken} site${broken === 1 ? "" : "s"} broken`, [
      watchTerm,
      approvalTerm,
      healthyTerm,
      preLaunchTerm,
      archivedTerm,
      auditedTerm,
    ]);
  }
  if (watch > 0) {
    return make("watch", `${watch} site${watch === 1 ? "" : "s"} to watch`, [
      approvalTerm,
      healthyTerm,
      preLaunchTerm,
      archivedTerm,
      auditedTerm,
    ]);
  }
  return make("soft", `${approval} waiting on you`, [
    healthyTerm,
    preLaunchTerm,
    archivedTerm,
    auditedTerm,
  ]);
}

const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  watch: "Watch",
  approval: "Waiting on your yes",
};

function feedGroups(feed: NeedsYouItem[]): FeedGroupView[] {
  return (["broken", "watch", "approval"] as const)
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
        })),
    }))
    .filter((g) => g.rows.length > 0);
}

// ---- the browse panel's card (fleet-browse-render.ts) ----

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
  attention: "failing",
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
    kinds.add(it.kind === "vuln" ? "vulns" : it.kind === "renovate" ? "prs" : it.kind);
  }
  if (c.items.some((it) => it.autoFixExhausted)) kinds.add("auto-fix-failed");
  for (const sig of c.watchSignals) kinds.add(sig);
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

function cardView(c: SiteCard, index: number, now: Date): CardView {
  const site = c.site;
  const slug = siteSlug(site.name);
  const onboarding = onboardingStatus(site, now);
  const missing = missingOnboarding(site, now);
  const score = (v: number | null) => (v === null ? DASH : String(v));
  return {
    key: `${index}:${site.id}`,
    signals: signals(c),
    href: `/s/${slug}`,
    name: site.name,
    siteHref: safeUrl(site.url),
    visibleUrl: site.url,
    setupTitle: missing.length === 0 ? "Setup complete" : `Missing: ${missing.join(", ")}`,
    setupScore: `${onboarding.score}/${onboarding.total}`,
    audited: relativeTimeFromNow(site.lastLighthouseAuditAt, now),
    perf: score(site.pScore),
    a11yLh: score(site.rScore),
    bp: score(site.bpScore),
    seo: score(site.seoScore),
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
    submissions: submissionsBadge(c),
    // Only repo-backed sites have anything to dispatch.
    triggerUrl: site.gitRepo?.trim() ? `/api/sites/${slug}/trigger-renovate` : null,
  };
}

/** Signal filters for the Fleet panel — card-derived tags only. */
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
    feed: feedGroups(feed),
    browse: {
      total: model.cards.length,
      filters: FLEET_FILTERS,
      cards: model.cards.map((c, i) => cardView(c, i, now)),
    },
    recently: recently(model, now),
    archived: (model.archived ?? []).map((s) => ({ name: s.name, status: s.status, slug: s.slug })),
    cardless: (model.cardless ?? [])
      .filter((i) => i.waiting !== true)
      .map((i) => ({
        siteName: i.siteName,
        title: i.title,
        href: i.kind === "deadletter" && i.url ? i.url : null,
      })),
    inbox: inbox(model, now),
  };
}
