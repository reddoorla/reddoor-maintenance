/**
 * P1-87 PR 6: the `traffic` block of a `fleet_daily` row, the nightly GA4 engaged visits
 * and Search Console clicks and impressions, per site and in total. PURE assembly: the
 * reads come in through `TrafficReaders`, so the rules here are testable with fakes.
 *
 * The rules (the plan's "Decisions taken here"):
 * - windows come from the night, not the clock, so a re-run reads the same days;
 * - an unmeasured read is `{ value: null, reason }`, never 0, and that site counts in
 *   neither the totals nor `sitesRead`;
 * - one site's failure never fails the block: each read is its own try with a timeout,
 *   and at most `concurrency` reads are in flight at once.
 */
import type { Measured, TrafficCounts, TrafficSite, TrafficWindow } from "./types.js";
import { NoPropertyForSubjectError } from "../reports/search/client.js";

/** A site as the block needs it: its id, URL, and the properties recorded for it. */
export type TrafficSiteInput = {
  id: string;
  url: string;
  ga4PropertyId: string | null;
  searchConsoleProperty: string | null;
};

/** The two reads. Each rejects on failure; it never resolves to 0 for a failed read. */
export type TrafficReaders = {
  /** GA4 engaged sessions per date, over `range` (the 60-day range). */
  visits: (site: TrafficSiteInput, range: TrafficWindow) => Promise<Map<string, number>>;
  /** Search Console clicks and impressions per date, over `range` (the 28-day range). */
  search: (
    site: TrafficSiteInput,
    range: TrafficWindow,
  ) => Promise<Map<string, { clicks: number; impressions: number }>>;
};

const MS_PER_DAY = 86_400_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const NOT_CONFIGURED = "GA not configured";
const NO_SITE_READ = "no site read";
const NO_GA_PROPERTY = "no GA4 property";
const NO_SEARCH_PROPERTY = "no Search Console property";
const REASON_MAX = 200;

/** The calendar date `offset` days from `night` (`YYYY-MM-DD`). UTC midnight of the
 *  string, so no DST change can shift a boundary. */
function shift(night: string, offset: number): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) + offset * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** The three windows the block reads, all ending from the night: 30 days of current
 *  and the 30 before it for visits, and 28 days of search ending 3 days before the
 *  night, because Search Console's data lags. */
export function trafficWindows(night: string): {
  current: TrafficWindow;
  previous: TrafficWindow;
  search: TrafficWindow;
} {
  const window = (from: number, to: number): TrafficWindow => ({
    startDate: shift(night, from),
    endDate: shift(night, to),
  });
  return {
    current: window(-29, 0),
    previous: window(-59, -30),
    search: window(-30, -3),
  };
}

/** Every date in the window, oldest first, both ends inclusive. */
function datesOf(w: TrafficWindow): string[] {
  const out: string[] = [];
  const end = Date.parse(`${w.endDate}T00:00:00Z`);
  for (let t = Date.parse(`${w.startDate}T00:00:00Z`); t <= end; t += MS_PER_DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The reason a failed read stores: its message, with any address masked (a subject's
 *  address can reach a message, and the row is stored), capped. */
function reasonOf(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return (msg.trim().replace(/\S+@\S+/g, "<account>") || "read failed").slice(0, REASON_MAX);
}

/** Reject if `p` has not settled within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`read timed out after ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Run `run` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The sum of a per-date map over the dates of a window; a missing date is 0. */
function sumOver(map: Map<string, number>, w: TrafficWindow): number {
  return datesOf(w).reduce((n, d) => n + (map.get(d) ?? 0), 0);
}

function searchSumOver(
  map: Map<string, { clicks: number; impressions: number }>,
  w: TrafficWindow,
): { clicks: number; impressions: number } {
  let clicks = 0;
  let impressions = 0;
  for (const d of datesOf(w)) {
    const day = map.get(d);
    if (day) {
      clicks += day.clicks;
      impressions += day.impressions;
    }
  }
  return { clicks, impressions };
}

/**
 * The `traffic` block for one night. `readers === null` means GA is not configured:
 * both halves are unmeasured with that reason. A site with no GA4 property, or no
 * Search Console property and no URL to resolve one from, is unmeasured for that half
 * and never read. Totals and each day's count sum only the sites that were read.
 */
export async function readTraffic(
  sites: TrafficSiteInput[],
  night: string,
  readers: TrafficReaders | null,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<TrafficCounts> {
  const windows = trafficWindows(night);
  const visitRange: TrafficWindow = {
    startDate: windows.previous.startDate,
    endDate: windows.current.endDate,
  };

  if (readers === null) {
    const unmeasured = { value: null, reason: NOT_CONFIGURED } as const;
    return {
      visits: unmeasured,
      search: unmeasured,
      sites: sites.map((s) => ({ siteId: s.id, visits: unmeasured, search: unmeasured })),
    };
  }

  const visitsRead = new Map<string, Measured<Map<string, number>>>();
  const searchRead = new Map<
    string,
    Measured<Map<string, { clicks: number; impressions: number }>>
  >();
  const hasGa = (s: TrafficSiteInput): boolean => (s.ga4PropertyId ?? "").trim() !== "";
  const hasSearch = (s: TrafficSiteInput): boolean =>
    (s.searchConsoleProperty ?? "").trim() !== "" || s.url.trim() !== "";
  // Sites whose search read found no property for any subject: "no property", counted in
  // neither sitesRead nor sitesWithProperty (P1-87, PR 6 review round 1).
  const noSearchProperty = new Set<string>();

  type Task = () => Promise<void>;
  const tasks: Task[] = [];
  for (const s of sites) {
    if (hasGa(s)) {
      tasks.push(async () => {
        try {
          const map = await withTimeout(
            Promise.resolve().then(() => readers.visits(s, visitRange)),
            opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          );
          visitsRead.set(s.id, { value: map });
        } catch (e) {
          visitsRead.set(s.id, { value: null, reason: reasonOf(e) });
        }
      });
    } else {
      visitsRead.set(s.id, { value: null, reason: NO_GA_PROPERTY });
    }
    if (hasSearch(s)) {
      tasks.push(async () => {
        try {
          const map = await withTimeout(
            Promise.resolve().then(() => readers.search(s, windows.search)),
            opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          );
          searchRead.set(s.id, { value: map });
        } catch (e) {
          if (e instanceof NoPropertyForSubjectError) {
            noSearchProperty.add(s.id);
            searchRead.set(s.id, { value: null, reason: NO_SEARCH_PROPERTY });
          } else {
            searchRead.set(s.id, { value: null, reason: reasonOf(e) });
          }
        }
      });
    } else {
      searchRead.set(s.id, { value: null, reason: NO_SEARCH_PROPERTY });
    }
  }
  // A concurrency below 1 would start no reads at all, so it is read as 1.
  await pool(tasks, Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY), (t) => t());

  // Each site's entry, from its own reads.
  const siteRows: TrafficSite[] = sites.map((s) => {
    const v = visitsRead.get(s.id)!;
    const q = searchRead.get(s.id)!;
    return {
      siteId: s.id,
      visits:
        v.value === null
          ? { value: null, reason: v.reason }
          : {
              value: {
                current: sumOver(v.value, windows.current),
                previous: sumOver(v.value, windows.previous),
              },
            },
      search:
        q.value === null
          ? { value: null, reason: q.reason }
          : { value: searchSumOver(q.value, windows.search) },
    };
  });

  // The totals: the sites that were read, and nothing else.
  const readVisits = sites
    .map((s) => visitsRead.get(s.id)!.value)
    .filter((m): m is Map<string, number> => m !== null);
  const readSearch = sites
    .map((s) => searchRead.get(s.id)!.value)
    .filter((m): m is Map<string, { clicks: number; impressions: number }> => m !== null);

  const visits: TrafficCounts["visits"] =
    readVisits.length === 0
      ? { value: null, reason: NO_SITE_READ }
      : {
          value: {
            current: siteRows.reduce((n, r) => n + (r.visits.value?.current ?? 0), 0),
            previous: siteRows.reduce((n, r) => n + (r.visits.value?.previous ?? 0), 0),
            currentWindow: windows.current,
            previousWindow: windows.previous,
            sitesRead: readVisits.length,
            sitesWithProperty: sites.filter(hasGa).length,
            daily: datesOf(visitRange).map((date) => ({
              date,
              visits: readVisits.reduce((n, m) => n + (m.get(date) ?? 0), 0),
            })),
          },
        };

  const search: TrafficCounts["search"] =
    readSearch.length === 0
      ? { value: null, reason: NO_SITE_READ }
      : {
          value: {
            clicks: siteRows.reduce((n, r) => n + (r.search.value?.clicks ?? 0), 0),
            impressions: siteRows.reduce((n, r) => n + (r.search.value?.impressions ?? 0), 0),
            window: windows.search,
            sitesRead: readSearch.length,
            sitesWithProperty: sites.filter((s) => hasSearch(s) && !noSearchProperty.has(s.id))
              .length,
            daily: datesOf(windows.search).map((date) => ({
              date,
              clicks: readSearch.reduce((n, m) => n + (m.get(date)?.clicks ?? 0), 0),
              impressions: readSearch.reduce((n, m) => n + (m.get(date)?.impressions ?? 0), 0),
            })),
          },
        };

  return { visits, search, sites: siteRows };
}
