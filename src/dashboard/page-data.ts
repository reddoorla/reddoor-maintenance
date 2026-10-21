import type { Db } from "../db/client.js";
import { listSites, listAllReports, getSiteBySlug, listReportsForSite } from "../db/fleet-state.js";
import {
  countUnreplayedDeadLettersBySlug,
  oldestUnreplayedDeadLetterBySlug,
} from "../db/deadletter.js";
import {
  listNewSubmissions,
  countAutoSpamSince,
  listSubmissionsForSite,
  listSubmissionsFiltered,
  countSubmissionsFiltered,
  listSpamReasonsFiltered,
  markFilteredAsRead,
} from "../db/submissions.js";
import { listFleetEvents } from "../db/fleet-events.js";
import { screenOutsSince, screenOutTotalsForSite } from "../db/screenouts.js";
import type { ScreenOutTotals } from "../db/screenouts.js";
import { readDigestState, readCockpitRollup } from "../db/digest-state.js";
import { listRecentProspectAudits } from "../db/prospect-audits.js";
import { siteSlug } from "../fleet/site-row.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import {
  assembleCockpitModel,
  RECENT_AUDITS_LIMIT,
  RECENT_EVENTS_DAYS,
  RECENT_EVENTS_LIMIT,
} from "./snapshot-views.js";
import type { CockpitModel, SiteAlarmContext } from "./fleet-cockpit.js";
import { parseFleetTableQuery, buildFleetTableModel } from "./fleet-table.js";
import type { FleetTableModel } from "./fleet-table.js";
import { parseSubmissionsQuery, buildSubmissionsPageModel, PAGE_SIZE } from "./submissions-page.js";
import type { SubmissionsPageModel } from "./submissions-page.js";
import { readSiteAlarmInputs, buildSiteAlarm } from "./site-alarm.js";
import { orElse } from "./or-else.js";

/**
 * What each operator page reads, one function per page, so the Netlify
 * functions and the SvelteKit cockpit (`cockpit/`, #582) load the same data
 * through the same code. Moved verbatim from the five page functions; the
 * functions keep their method, auth and env guards and their response shapes.
 *
 * Every loader takes an open client and throws on a core-read failure, which the
 * caller turns into a 502. The defensive reads inside degrade to "absent", as
 * the functions always did.
 *
 * The reads that depend on nothing but the request run together, so a load costs
 * one Turso round trip per step of its longest chain, not one per query
 * (tests/dashboard/page-data-waves.test.ts pins the waves). That needs a `Db`
 * opened with `concurrentReads`, as the cockpit's `withDb` does; on any other
 * `Db` Kysely runs them one at a time and the result is the same, only slower.
 */

/** `/`: the fleet cockpit. One wave: every read below depends only on `now`. */
export async function loadCockpitModel(db: Db, now: Date, baseUrl: string): Promise<CockpitModel> {
  // sites is the cockpit's core data, so a failure there can't degrade to an
  // empty (misleading "0 sites") page — instead the whole load throws, for a
  // clean retry-able 502. Every other read is defensive so one hiccup can't
  // blank the page.
  const [
    websites,
    reports,
    prior,
    newSubmissions,
    rollup,
    recentEvents,
    autoFilteredCount,
    deadLetters,
    deadLetterOldestRead,
  ] = await Promise.all([
    listSites(db),
    // approve strip + delivery signals simply absent — triage still renders
    orElse(() => listAllReports(db), []),
    // everything badges as not-NEW (the {} initial); never crashes the page
    orElse(() => readDigestState(db), {}),
    // submissions strip simply absent — triage still renders
    orElse(() => listNewSubmissions(db), []),
    // strip simply absent — never blank the cockpit (see the roll-up note below)
    orElse(() => readCockpitRollup(db), null),
    // Recently lane simply absent — the cockpit still renders.
    orElse(() => {
      const sinceIso = new Date(now.getTime() - RECENT_EVENTS_DAYS * 86_400_000).toISOString();
      return listFleetEvents(db, { sinceIso, limit: RECENT_EVENTS_LIMIT });
    }, []),
    // affordance simply absent — never blank the cockpit
    orElse(() => countAutoSpamSince(db, screenOutsSince(now, 7)), 0),
    // #645. Unreplayed dead-letter rows per slug — the dropped-lead alarm.
    // Defensive like every other libSQL read here: a blip drops the signal, it
    // never blanks the cockpit.
    orElse<ReadonlyMap<string, number>>(() => countUnreplayedDeadLettersBySlug(db), new Map()),
    // OD 87: the hold's clock. A blip leaves it empty, and then nothing is held
    // (every dead letter alarms). Read in the same wave as the count, and used
    // only when the count found dead letters, as when it was read after it.
    orElse<ReadonlyMap<string, string>>(() => oldestUnreplayedDeadLetterBySlug(db), new Map()),
  ]);
  return assembleCockpitModel(
    {
      websites,
      reports,
      prior,
      newSubmissions,
      rollup,
      recentEvents,
      autoFilteredCount,
      deadLetters,
      deadLetterOldestRead,
    },
    baseUrl,
    now,
  );
}

/** `/fleet`: the fleet table. Turso IS the page (the one `listSites` read
 *  feeds everything), so a failure throws rather than rendering an empty table
 *  that pretends the fleet vanished. */
export async function loadFleetTableModel(
  db: Db,
  params: URLSearchParams,
): Promise<FleetTableModel> {
  const query = parseFleetTableQuery(params);
  const sites = await listSites(db);
  return buildFleetTableModel(sites, query);
}

export type SiteDashboardData = {
  site: WebsiteRow;
  reports: ReportRow[];
  submissions: SubmissionRow[];
  spamTotals: ScreenOutTotals | null;
  alarm: SiteAlarmContext | null;
};

/** `/s/:slug`. Null when no site has the slug, which the caller answers 404:
 *  only a THROWN Turso failure becomes a 502. Two waves: the site, then
 *  everything else, which needs only its id and the slug. */
export async function loadSiteDashboard(
  db: Db,
  slug: string,
  now: Date,
  baseUrl: string,
): Promise<SiteDashboardData | null> {
  // First and alone: an unknown slug costs exactly this one query.
  const site = await getSiteBySlug(db, slug);
  if (!site) return null;

  // MED-11 (2026-09-02). Every read below is scoped to THIS site. All three
  // used to call the fleet-wide variant and then throw away every row but one:
  // a single `/s/:slug` load ran a GROUP BY over the whole `submissions` table
  // (unbounded, one row per fleet lead), a second full traversal for the spam
  // panel, and a third over the dead-letter queue. The per-site forms are
  // served as index SEARCHes — see tests/db/query-plans.test.ts.
  //
  // The fleet-wide functions are not gone: the nightly digest and the fleet
  // cockpit genuinely render every site and still use them. What changed is
  // that the ONE-site page no longer pays the fleet's price.
  const [reports, submissions, spamTotals, alarmInputs] = await Promise.all([
    // The FULL report set goes to the renderer. The "recent 6" history-table
    // slice is canonical inside the renderer. Pre-slicing here would hide an OLD
    // pending report from the approve list + its button while the fleet banner
    // (which counts ALL reports) still shows it, leaving an unapprovable report
    // and a banner/page disagreement. Not defensive: a failure here throws.
    listReportsForSite(db, site.id),
    // submissions section simply absent — the rest of the page still renders
    orElse<SubmissionRow[]>(() => listSubmissionsForSite(db, { id: site.id, name: site.name }), []),
    // panel simply absent — never blank the page
    orElse<ScreenOutTotals | null>(
      () => screenOutTotalsForSite(db, site.id, screenOutsSince(now, 30)),
      null,
    ),
    // The alarm's reads need only the site and the slug; its verdict needs the
    // reports too, so it is built below.
    readSiteAlarmInputs(db, site, slug, now),
  ]);

  // Cockpit alarm verdict for the header chip strip.
  const alarm = buildSiteAlarm(site, reports, baseUrl, now, alarmInputs);

  return { site, reports, submissions, spamTotals, alarm };
}

export type SubmissionsPageLoad =
  { kind: "ok"; model: SubmissionsPageModel } | { kind: "no-site"; slug: string };

/** Parse the submissions query and resolve its `?site=` slug. A slug that
 *  matches no site is reported, never dropped: it used to fall through and
 *  return the WHOLE fleet, which was misleading. */
async function resolveSubmissionsQuery(db: Db, params: URLSearchParams) {
  const parsed = parseSubmissionsQuery(params);
  const websites = await listSites(db);
  if (parsed.siteSlug) {
    const match = websites.find((w) => siteSlug(w.name) === parsed.siteSlug);
    if (!match) return { kind: "no-site" as const, slug: parsed.siteSlug };
    parsed.filter.siteId = match.id;
  }
  return { kind: "ok" as const, parsed, websites };
}

/** `/submissions` GET. */
export async function loadSubmissionsPage(
  db: Db,
  params: URLSearchParams,
): Promise<SubmissionsPageLoad> {
  const resolved = await resolveSubmissionsQuery(db, params);
  if (resolved.kind === "no-site") return resolved;
  const { filter, rawFilter, page } = resolved.parsed;

  // Facet reasons cover the WHOLE filtered bucket (the renderer's facet line sits
  // under the full-bucket total, so a page-scoped tally misreads a multi-page
  // bucket). Only fetched on the spam views where the facet line renders.
  const wantFacets = filter.status === "spam_auto" || filter.status === "spam";
  const [rows, total, facetReasons, newOnlyCount] = await Promise.all([
    listSubmissionsFiltered(db, filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countSubmissionsFiltered(db, filter),
    wantFacets ? listSpamReasonsFiltered(db, filter) : Promise.resolve([]),
    // Bulk mark-read button count — the still-'new' subset of the CURRENT bucket.
    // A status='new' view reuses `total`; any other explicit status can't contain
    // 'new' rows (0, button hidden); only the mixed view needs its own count.
    filter.status === undefined
      ? countSubmissionsFiltered(db, { ...filter, status: "new" })
      : Promise.resolve(0),
  ]);

  return {
    kind: "ok",
    model: buildSubmissionsPageModel({
      rows,
      total,
      sites: resolved.websites.map((w) => ({ id: w.id, name: w.name })),
      filter,
      rawFilter,
      page,
      facetReasons,
      markableNewCount: filter.status === "new" ? total : newOnlyCount,
    }),
  };
}

export type MarkReadResult =
  | { kind: "marked"; count: number; location: string }
  | { kind: "no-site"; slug: string }
  | { kind: "unknown-action" };

/** `/submissions` POST: the bulk mark-read of the bucket in view. The form
 *  carries the ACTIVE filter as fields with the GET query's names, so the same
 *  parse re-derives the identical filter server-side. `markFilteredAsRead`'s
 *  status='new' guard is the real safety: spam, archived and operator-touched
 *  rows are never flipped, whatever the posted filter says. */
export async function markSubmissionsRead(
  db: Db,
  params: URLSearchParams,
): Promise<MarkReadResult> {
  const resolved = await resolveSubmissionsQuery(db, params);
  if (resolved.kind === "no-site") return resolved;
  if (params.get("action") !== "mark-read") return { kind: "unknown-action" };
  const count = await markFilteredAsRead(db, resolved.parsed.filter);
  // The redirect re-GETs the same filtered view, so a refresh can't repost.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(resolved.parsed.rawFilter)) if (v) qs.set(k, v);
  const query = qs.toString();
  return { kind: "marked", count, location: query ? `/submissions?${query}` : "/submissions" };
}

/** `/audits`. */
export async function loadProspectAudits(db: Db) {
  return listRecentProspectAudits(db, RECENT_AUDITS_LIMIT);
}
