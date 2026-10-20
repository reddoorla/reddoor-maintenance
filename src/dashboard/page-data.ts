import type { Db } from "../db/client.js";
import { listSites, listAllReports, getSiteBySlug, listReportsForSite } from "../db/fleet-state.js";
import { countUnreplayedDeadLettersBySlug } from "../db/deadletter.js";
import {
  listNewSubmissions,
  countAutoSpamSince,
  listSubmissionsForSite,
  listSubmissionsFiltered,
  countSubmissionsFiltered,
  listSpamReasonsFiltered,
  markFilteredAsRead,
} from "../db/submissions.js";
import type { NotifyBounceCounts } from "../db/submissions.js";
import { listFleetEvents } from "../db/fleet-events.js";
import { screenOutsSince, screenOutTotalsForSite } from "../db/screenouts.js";
import type { ScreenOutTotals } from "../db/screenouts.js";
import { readDigestState, readCockpitRollup } from "../db/digest-state.js";
import { listRecentProspectAudits } from "../db/prospect-audits.js";
import { siteSlug } from "../fleet/site-row.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import { buildCockpitModel } from "./fleet-cockpit.js";
import type { CockpitModel, SiteAlarmContext } from "./fleet-cockpit.js";
import { parseFleetTableQuery, buildFleetTableModel } from "./fleet-table.js";
import type { FleetTableModel } from "./fleet-table.js";
import { parseSubmissionsQuery, buildSubmissionsPageModel, PAGE_SIZE } from "./submissions-page.js";
import type { SubmissionsPageModel } from "./submissions-page.js";
import { loadSiteAlarmContext } from "./site-alarm.js";

/**
 * What each operator page reads, one function per page, so the Netlify
 * functions and the SvelteKit cockpit (`cockpit/`, #582) load the same data
 * through the same code. Moved verbatim from the five page functions; the
 * functions keep their method, auth and env guards and their response shapes.
 *
 * Every loader takes an open client and throws on a core-read failure, which the
 * caller turns into a 502. The defensive reads inside degrade to "absent", as
 * the functions always did.
 */

/** `/`: the fleet cockpit. */
export async function loadCockpitModel(db: Db, now: Date, baseUrl: string): Promise<CockpitModel> {
  // Fetch the three inputs once. reports + digest are each defensive so one
  // hiccup can't blank the page; sites is the cockpit's core data, so a
  // failure there can't degrade to an empty (misleading "0 sites") page —
  // instead the whole load throws, for a clean retry-able 502.
  const websites = await listSites(db);
  let reports: Awaited<ReturnType<typeof listAllReports>> = [];
  try {
    reports = await listAllReports(db);
  } catch {
    // approve strip + delivery signals simply absent — triage still renders
  }
  let prior: Awaited<ReturnType<typeof readDigestState>> = {};
  try {
    prior = await readDigestState(db);
  } catch {
    // everything badges as not-NEW (the {} initial); never crashes the page
  }
  let newSubmissions: Awaited<ReturnType<typeof listNewSubmissions>> = [];
  try {
    newSubmissions = await listNewSubmissions(db);
  } catch {
    // submissions strip simply absent — triage still renders
  }
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
  let rollup: Awaited<ReturnType<typeof readCockpitRollup>> = null;
  try {
    rollup = await readCockpitRollup(db);
  } catch {
    // strip simply absent — never blank the cockpit
  }
  const spamTotals =
    rollup !== null ? { ...rollup.spamTotals, computedAt: rollup.computedAt } : null;
  let recentEvents: Awaited<ReturnType<typeof listFleetEvents>> = [];
  try {
    const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    recentEvents = await listFleetEvents(db, { sinceIso, limit: 20 });
  } catch {
    // Recently lane simply absent — the cockpit still renders.
  }
  let autoFilteredCount = 0;
  try {
    const since = screenOutsSince(now, 7);
    autoFilteredCount = await countAutoSpamSince(db, since);
  } catch {
    // affordance simply absent — never blank the cockpit
  }
  // #783: the roll-up's per-site value is a {total, permanent} breakdown now.
  // `readCockpitRollup` normalizes an older numeric payload into it, so this
  // stays a plain Object.entries and the cockpit keeps rendering after a
  // deploy that lands before the next nightly digest run.
  const notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map(
    Object.entries(rollup?.notifyBounces ?? {}),
  );
  // #645. Unreplayed dead-letter rows per slug — the dropped-lead alarm.
  // Defensive like every other libSQL read here: a blip drops the signal, it
  // never blanks the cockpit.
  let deadLetters: ReadonlyMap<string, number> = new Map();
  try {
    deadLetters = await countUnreplayedDeadLettersBySlug(db);
  } catch {
    // alarm simply absent — never blank the cockpit
  }
  return buildCockpitModel(
    websites,
    reports,
    prior,
    baseUrl,
    now,
    newSubmissions,
    spamTotals,
    recentEvents,
    autoFilteredCount,
    notifyBounces,
    deadLetters,
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
 *  only a THROWN Turso failure becomes a 502. */
export async function loadSiteDashboard(
  db: Db,
  slug: string,
  now: Date,
  baseUrl: string,
): Promise<SiteDashboardData | null> {
  const site = await getSiteBySlug(db, slug);
  if (!site) return null;

  // The FULL report set goes to the renderer. The "recent 6" history-table
  // slice is canonical inside the renderer. Pre-slicing here would hide an OLD
  // pending report from the approve list + its button while the fleet banner
  // (which counts ALL reports) still shows it, leaving an unapprovable report
  // and a banner/page disagreement.
  const reports = await listReportsForSite(db, site.id);

  let submissions: SubmissionRow[] = [];
  try {
    submissions = await listSubmissionsForSite(db, { id: site.id, name: site.name });
  } catch {
    // submissions section simply absent — the rest of the page still renders
  }

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
  let spamTotals: ScreenOutTotals | null = null;
  try {
    const since = screenOutsSince(now, 30);
    spamTotals = await screenOutTotalsForSite(db, site.id, since);
  } catch {
    // panel simply absent — never blank the page
  }

  // Cockpit alarm verdict for the header chip strip (see loadSiteAlarmContext).
  const alarm = await loadSiteAlarmContext(db, site, slug, reports, baseUrl, now);

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

/** Plenty for one screen of "recent" without a pager; the design deliberately
 *  has no pagination for this list (v1 non-goal: no live progress, no extra UI). */
const RECENT_AUDITS_LIMIT = 25;

/** `/audits`. */
export async function loadProspectAudits(db: Db) {
  return listRecentProspectAudits(db, RECENT_AUDITS_LIMIT);
}
