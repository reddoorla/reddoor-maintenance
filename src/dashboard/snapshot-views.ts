import type { WebsiteRow } from "../fleet/site-row.js";
import { siteSlug } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import type { DigestSnapshot } from "../alerts/digest-state.js";
import type { CockpitRollup } from "../db/digest-state.js";
import type { FleetEvent } from "../db/fleet-events.js";
import type { ScreenOutBucket, ScreenOutTotals } from "../db/screenouts.js";
import type {
  NotifyBounceCounts,
  RawSubmissionEnums,
  SubmissionFilter,
} from "../db/submissions.js";
import type { ProspectAuditListItem } from "../db/prospect-audits.js";
import { NOTIFY_BOUNCE_WINDOW_DAYS } from "../alerts/digest-collectors.js";
import { screenOutsSince } from "../util/date.js";
import { buildCockpitModel } from "./fleet-cockpit.js";
import type { CockpitModel } from "./fleet-cockpit.js";
import { parseFleetTableQuery, buildFleetTableModel } from "./fleet-table.js";
import type { FleetTableModel } from "./fleet-table.js";
import { parseSubmissionsQuery, buildSubmissionsPageModel, PAGE_SIZE } from "./submissions-page.js";
import { buildSiteAlarm, type SiteAlarmInputs } from "./site-alarm-verdict.js";
import type { LatestDeps } from "../alerts/production-signals.js";
import type { SiteDashboardData, SubmissionsPageLoad } from "./page-data.js";

/**
 * Every cockpit page's data, derived from the one snapshot (`snapshot.ts`) instead
 * of read from Turso. Runs in the browser, so it imports no store module: only
 * types, and the pure builders the per-page loaders (`page-data.ts`) feed.
 *
 * Each function answers what its loader answers for the same database at the same
 * `now`: the SQL each loader runs is restated here over the snapshot's rows, and
 * tests/dashboard/snapshot-views.test.ts runs every page both ways and compares.
 * Windows are taken at `now`, the moment the page derives, as the loaders take
 * them at the moment they read.
 */

/** `listNewSubmissions`' default cap: the cockpit's unread strip. */
const NEW_SUBMISSIONS_MAX = 200;
/** `listSubmissionsForSite`'s default cap. */
const SITE_SUBMISSIONS_MAX = 200;
/** `listSpamReasonsFiltered`'s default cap. */
const SPAM_REASONS_CAP = 2000;
/** The cockpit's Recently lane: the last week's events, at most this many. */
export const RECENT_EVENTS_DAYS = 7;
export const RECENT_EVENTS_LIMIT = 20;
/** `/audits` lists this many: plenty for one screen of "recent" without a pager; the
 *  design deliberately has no pagination for this list (v1 non-goal). */
export const RECENT_AUDITS_LIMIT = 25;
/** The site page sums 30 days of screen-outs; the snapshot keeps one day more, so a
 *  page derived the day after the snapshot was taken still has its whole window. */
export const SNAPSHOT_SCREENOUT_DAYS = 31;
const SITE_SPAM_WINDOW_DAYS = 30;
const AUTO_SPAM_WINDOW_DAYS = 7;

export type CockpitSnapshot = {
  takenAt: string;
  /** The store's change counter when these rows were read (migration 0048), or null
   *  when that read failed (then `gaps` names it and the next navigation is a full load). */
  version: number | null;
  baseUrl: string;
  /** The reads that fell back (`snapshot.ts`); empty when every read worked. */
  gaps: string[];
  /** Mailchimp keys redacted to a marker (see `snapshot.ts`). Null when the read
   *  failed: every page but `/audits` answers 502. */
  sites: WebsiteRow[] | null;
  /** site id → the stored `sites.slug` that `/s/:slug` matches. */
  slugById: ReadonlyMap<string, string>;
  /** Null when the read failed: `/` degrades to none, `/s/:slug` answers 502. */
  reports: ReportRow[] | null;
  digest: DigestSnapshot;
  rollup: CockpitRollup | null;
  recentEvents: FleetEvent[];
  deadLetters: ReadonlyMap<string, number>;
  deadLetterOldest: ReadonlyMap<string, string>;
  /** Every submission, newest first. Null when the read failed: `/` and `/s/:slug`
   *  degrade, `/submissions` answers 502. */
  submissions: SubmissionRow[] | null;
  /** By submission id: the stored status and form type of a row whose values are
   *  not ours, which `SubmissionRow` narrows. Normally empty. */
  rawSubmissionEnums: ReadonlyMap<string, RawSubmissionEnums>;
  /** Screen-out buckets for the last `SNAPSHOT_SCREENOUT_DAYS`. */
  screenOuts: ScreenOutBucket[] | null;
  /** Null when the read failed: `/audits` answers 502. */
  audits: ProspectAuditListItem[] | null;
  /** P1-78c. The latest `fleet_daily` dependency readings; null when absent or failed. */
  deps: LatestDeps | null;
};

/** A read the page cannot do without failed when the snapshot was taken. The page
 *  answers it as its loader's thrown read was answered: a 502. */
export class SnapshotGap extends Error {
  constructor(read: string) {
    super(`snapshot: the ${read} read failed`);
    this.name = "SnapshotGap";
  }
}

/** The cockpit model from its reads, as `loadCockpitModel` has them. Shared by the
 *  loader and the snapshot, so both assemble it the same way. */
export function assembleCockpitModel(
  i: {
    websites: WebsiteRow[];
    reports: ReportRow[];
    prior: DigestSnapshot;
    newSubmissions: SubmissionRow[];
    rollup: CockpitRollup | null;
    recentEvents: FleetEvent[];
    autoFilteredCount: number;
    deadLetters: ReadonlyMap<string, number>;
    deadLetterOldestRead: ReadonlyMap<string, string>;
    /** P1-78c. The latest `fleet_daily` dependency readings. */
    deps: LatestDeps | null;
  },
  baseUrl: string,
  now: Date,
): CockpitModel {
  const deadLetterOldest: ReadonlyMap<string, string> =
    i.deadLetters.size > 0 ? i.deadLetterOldestRead : new Map();
  // Both of the fleet-wide "since a window" numbers now come from ONE row read
  // by primary key, computed by the nightly digest (MED-16). They used to be
  // recomputed on every page load — aggregates over the whole `submissions`
  // table, which is the one unbounded-growth table in the schema, on the
  // operator's most-loaded page, against a store that meters row scans.
  //
  // They are consequently up to 24h old. `null` when the digest has not written
  // one yet, which the cockpit renders as ABSENT rather than as zeros: every
  // one of these numbers has a legitimate zero, so a confident 0 for an
  // unmeasured window is a lie the strip cannot walk back.
  const spamTotals =
    i.rollup !== null ? { ...i.rollup.spamTotals, computedAt: i.rollup.computedAt } : null;
  // #783: the roll-up's per-site value is a {total, permanent} breakdown now.
  // `readCockpitRollup` normalizes an older numeric payload into it, so this
  // stays a plain Object.entries and the cockpit keeps rendering after a
  // deploy that lands before the next nightly digest run.
  const notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map(
    Object.entries(i.rollup?.notifyBounces ?? {}),
  );
  return buildCockpitModel(
    i.websites,
    i.reports,
    i.prior,
    baseUrl,
    now,
    i.newSubmissions,
    spamTotals,
    i.recentEvents,
    i.autoFilteredCount,
    notifyBounces,
    i.deadLetters,
    deadLetterOldest,
    i.deps,
  );
}

/** What a submission's `status` and `form_type` columns hold: the SQL compares
 *  these, and a stored value that is not ours (`toStatus` reads it as "new") must
 *  not match a filter it never matched. */
function storedStatus(s: CockpitSnapshot, r: SubmissionRow): string {
  return s.rawSubmissionEnums.get(r.id)?.status ?? r.status;
}
function storedFormType(s: CockpitSnapshot, r: SubmissionRow): string {
  return s.rawSubmissionEnums.get(r.id)?.formType ?? r.formType;
}

/** The snapshot's sites, which every page but `/audits` cannot do without. */
function sitesOf(s: CockpitSnapshot): WebsiteRow[] {
  if (s.sites === null) throw new SnapshotGap("sites");
  return s.sites;
}

/** SQLite's `lower()`: ASCII only. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** `submitted_at >= since`, which is false for a NULL column. */
function submittedSince(r: SubmissionRow, since: string): boolean {
  return typeof r.submittedAt === "string" && r.submittedAt >= since;
}

/** `applySubmissionFilter` (src/db/submissions.ts), one row at a time. The search
 *  and reason branches are its LIKEs: the column through SQLite's ASCII-only
 *  `lower()`, the term lowercased in JS first, a NULL column never matching. */
export function matchesSubmissionFilter(
  r: SubmissionRow,
  f: SubmissionFilter,
  stored: { status: string; formType: string } = r,
): boolean {
  if (f.siteId !== undefined && r.siteId !== f.siteId) return false;
  if (f.formType !== undefined && stored.formType !== f.formType) return false;
  if (f.status !== undefined && stored.status !== f.status) return false;
  if (f.from !== undefined && !(typeof r.submittedAt === "string" && r.submittedAt >= f.from))
    return false;
  if (f.to !== undefined && !(typeof r.submittedAt === "string" && r.submittedAt <= f.to))
    return false;
  if (f.search !== undefined && f.search.trim() !== "") {
    const term = f.search.trim().toLowerCase();
    const hit = [r.name, r.email, r.message, r.phone].some(
      (v) => typeof v === "string" && asciiLower(v).includes(term),
    );
    if (!hit) return false;
  }
  if (f.reason !== undefined && f.reason.trim() !== "") {
    const token = f.reason.trim().toLowerCase();
    if (typeof r.spamReason !== "string") return false;
    const list = `,${asciiLower(r.spamReason)},`;
    if (!list.includes(`,${token},`) && !list.includes(`,${token}:`)) return false;
  }
  return true;
}

/** `/`. */
export function cockpitModelFromSnapshot(s: CockpitSnapshot, now: Date): CockpitModel {
  const subs = s.submissions;
  const eventsSince = new Date(now.getTime() - RECENT_EVENTS_DAYS * 86_400_000).toISOString();
  const autoSince = screenOutsSince(now, AUTO_SPAM_WINDOW_DAYS);
  return assembleCockpitModel(
    {
      websites: sitesOf(s),
      reports: s.reports ?? [],
      prior: s.digest,
      newSubmissions:
        subs === null
          ? []
          : subs.filter((r) => storedStatus(s, r) === "new").slice(0, NEW_SUBMISSIONS_MAX),
      rollup: s.rollup,
      recentEvents: s.recentEvents.filter((e) => e.ts >= eventsSince),
      autoFilteredCount:
        subs === null
          ? 0
          : subs.filter((r) => storedStatus(s, r) === "spam_auto" && submittedSince(r, autoSince))
              .length,
      deadLetters: s.deadLetters,
      deadLetterOldestRead: s.deadLetterOldest,
      deps: s.deps,
    },
    s.baseUrl,
    now,
  );
}

/** `/fleet`'s table. */
export function fleetTableModelFromSnapshot(
  s: CockpitSnapshot,
  params: URLSearchParams,
): FleetTableModel {
  return buildFleetTableModel(sitesOf(s), parseFleetTableQuery(params));
}

/** `/s/:slug`. Null when no site has the slug, as `loadSiteDashboard`. */
export function siteDashboardFromSnapshot(
  s: CockpitSnapshot,
  slug: string,
  now: Date,
): SiteDashboardData | null {
  const site = sitesOf(s).find((w) => s.slugById.get(w.id) === slug);
  if (!site) return null;
  // Not defensive on the site page: the full report set feeds the approve list.
  if (s.reports === null) throw new SnapshotGap("reports");
  const reports = s.reports.filter((r) => r.siteId === site.id);
  const subs = s.submissions;
  const submissions =
    subs === null ? [] : subs.filter((r) => r.siteId === site.id).slice(0, SITE_SUBMISSIONS_MAX);

  // screenOutTotalsForSite: both halves or nothing.
  let spamTotals: ScreenOutTotals | null = null;
  if (subs !== null && s.screenOuts !== null) {
    const since = screenOutsSince(now, SITE_SPAM_WINDOW_DAYS);
    const totals = { honeypot: 0, tooFast: 0, markedSpam: 0 };
    for (const b of s.screenOuts) {
      if (b.siteId !== site.id || b.date < since) continue;
      totals.honeypot += b.honeypot;
      totals.tooFast += b.tooFast;
    }
    totals.markedSpam = subs.filter(
      (r) => r.siteId === site.id && storedStatus(s, r) === "spam" && submittedSince(r, since),
    ).length;
    spamTotals = totals;
  }

  // readSiteAlarmInputs, each input from the snapshot's fleet-wide reads.
  let bounces: NotifyBounceCounts | null = null;
  if (subs !== null) {
    const since = screenOutsSince(now, NOTIFY_BOUNCE_WINDOW_DAYS);
    bounces = { total: 0, permanent: 0 };
    for (const r of subs) {
      if (r.siteId !== site.id || r.notifyStatus !== "bounced" || !submittedSince(r, since))
        continue;
      if (r.bounceAckAt !== null && r.bounceAckAt !== undefined) continue;
      bounces.total++;
      if (asciiLower(r.bounceType ?? "") === "permanent") bounces.permanent++;
    }
  }
  const deadLetterCount = s.deadLetters.get(slug) ?? 0;
  const oldest = s.deadLetterOldest.get(slug) ?? null;
  const inputs: SiteAlarmInputs = {
    notifyBounces:
      bounces !== null && bounces.total > 0 ? new Map([[site.id, bounces]]) : new Map(),
    deadLetters: deadLetterCount > 0 ? new Map([[slug, deadLetterCount]]) : new Map(),
    deadLetterOldest:
      deadLetterCount > 0 && oldest !== null ? new Map([[slug, oldest]]) : new Map(),
    prior: s.digest,
    deps: s.deps,
  };
  const alarm = buildSiteAlarm(site, reports, s.baseUrl, now, inputs);
  return { site, reports, submissions, spamTotals, alarm };
}

/** `/submissions`. */
export function submissionsPageFromSnapshot(
  s: CockpitSnapshot,
  params: URLSearchParams,
): SubmissionsPageLoad {
  const parsed = parseSubmissionsQuery(params);
  const sites = sitesOf(s);
  if (parsed.siteSlug) {
    const match = sites.find((w) => siteSlug(w.name) === parsed.siteSlug);
    if (!match) return { kind: "no-site", slug: parsed.siteSlug };
    parsed.filter.siteId = match.id;
  }
  if (s.submissions === null) throw new SnapshotGap("submissions");
  const { filter, rawFilter, page } = parsed;
  const bucket = s.submissions.filter((r) =>
    matchesSubmissionFilter(r, filter, {
      status: storedStatus(s, r),
      formType: storedFormType(s, r),
    }),
  );
  const offset = (page - 1) * PAGE_SIZE;
  const wantFacets = filter.status === "spam_auto" || filter.status === "spam";
  const facetReasons = wantFacets
    ? bucket
        .filter((r) => r.spamReason !== null && r.spamReason !== undefined)
        .slice(0, SPAM_REASONS_CAP)
        .map((r) => r.spamReason as string)
        .filter((r) => r !== "")
    : [];
  const newOnlyCount =
    filter.status === undefined ? bucket.filter((r) => storedStatus(s, r) === "new").length : 0;
  return {
    kind: "ok",
    model: buildSubmissionsPageModel({
      rows: bucket.slice(offset, offset + PAGE_SIZE),
      total: bucket.length,
      sites: sites.map((w) => ({ id: w.id, name: w.name })),
      filter,
      rawFilter,
      page,
      facetReasons,
      markableNewCount: filter.status === "new" ? bucket.length : newOnlyCount,
    }),
  };
}

/** `/audits`. */
export function auditsFromSnapshot(s: CockpitSnapshot): ProspectAuditListItem[] {
  if (s.audits === null) throw new SnapshotGap("audits");
  return s.audits;
}
