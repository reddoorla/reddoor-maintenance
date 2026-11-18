/**
 * P1-87 PR 7a: the guarded read of the nightly traffic block for the first screen's two
 * traffic tiles. PURE: it takes the overview's nights and returns the series, or the reason
 * there is none. It never throws and never reads a missing number as 0.
 *
 * The series is the night that holds its `daily` (never the newest row). Every stored total
 * is checked against the windows that night implies, computed here (`windowsFor`, pinned to
 * `trafficWindows` by a test), never the stored windows, so a wrong stored window fails too.
 * Any failed check is "malformed" (#2103).
 */
import type { OverviewNight } from "../../../../src/fleet-daily/read.js";

/** Why a series is not shown; the view words each one (view.ts `TRAFFIC_WORDS`). */
export type TrafficReason =
  "not collected" | "not readable" | "not configured" | "no site read" | "malformed";

export type Reading<T> = { value: T } | { value: null; reason: TrafficReason };

export type VisitsSeries = {
  night: string;
  current: number;
  previous: number;
  sitesRead: number;
  /** Each date's engaged visits, over the 60 days (oldest first). */
  daily: Map<string, number>;
};

export type SearchSeries = {
  night: string;
  clicks: number;
  impressions: number;
  sitesRead: number;
  /** Each date's clicks and impressions, over the 28 days (oldest first). */
  daily: Map<string, { clicks: number; impressions: number }>;
};

type Win = { startDate: string; endDate: string };

const MS_PER_DAY = 86_400_000;

const shift = (night: string, offset: number): string =>
  new Date(Date.parse(`${night}T00:00:00Z`) + offset * MS_PER_DAY).toISOString().slice(0, 10);

/** The three windows a night's block covers, as the nightly writes them (the same offsets as
 *  `trafficWindows` in src/fleet-daily/traffic.ts: visits 30 days and the 30 before, search
 *  28 days ending 3 days before the night). */
export function windowsFor(night: string): { current: Win; previous: Win; search: Win } {
  const w = (from: number, to: number): Win => ({
    startDate: shift(night, from),
    endDate: shift(night, to),
  });
  return { current: w(-29, 0), previous: w(-59, -30), search: w(-30, -3) };
}

/** Every date from `start` to `end`, both inclusive, oldest first. */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += MS_PER_DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const isPlain = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** A count the nightly writes: a whole number, not negative. */
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

const sameWindow = (x: unknown, w: Win): boolean =>
  isPlain(x) && x.startDate === w.startDate && x.endDate === w.endDate;

/** The half of `key` on a night's stored traffic block, or undefined when the block or the
 *  half is not there. */
function halfOf(row: unknown, key: "visits" | "search"): unknown {
  if (!isPlain(row) || !isPlain(row.counts)) return undefined;
  const block = row.counts.traffic;
  if (!isPlain(block) || !isPlain(block.value)) return undefined;
  return block.value[key];
}

/** A half that holds its series: a value with a `daily` key, whatever its shape. */
const holdsSeries = (row: OverviewNight, key: "visits" | "search"): boolean => {
  const h = halfOf(row, key);
  return isPlain(h) && isPlain(h.value) && "daily" in h.value;
};

/** With no night holding a series, the newest night's stored reason says why. */
const WORDS: Record<string, TrafficReason> = {
  "not in this row": "not collected",
  "GA not configured": "not configured",
  "no site read": "no site read",
};

function noSeries(nights: readonly OverviewNight[], key: "visits" | "search"): TrafficReason {
  const newest = nights[0];
  if (newest === undefined) return "not collected";
  const row = newest as unknown;
  if (!isPlain(row) || !isPlain(row.counts)) return "malformed";
  const block = row.counts.traffic;
  if (!isPlain(block)) return "not collected";
  // A block that is unmeasured as a whole carries its reason on the block itself.
  if (block.value === null) {
    return typeof block.reason === "string"
      ? (WORDS[block.reason] ?? "not readable")
      : "not readable";
  }
  const h = halfOf(row, key);
  if (h === undefined) return "not collected";
  if (isPlain(h) && h.value === null && typeof h.reason === "string") {
    return WORDS[h.reason] ?? "not readable";
  }
  // A valid half with no daily series is not the shape the nightly writes.
  return "malformed";
}

/** The visits series from the newest night that holds one, or why there is none. */
export function readVisits(nights: readonly OverviewNight[] | null): Reading<VisitsSeries> {
  if (nights === null) return { value: null, reason: "not readable" };
  const row = nights.find((n) => holdsSeries(n, "visits"));
  if (row === undefined) return { value: null, reason: noSeries(nights, "visits") };
  const value = (halfOf(row, "visits") as { value: Record<string, unknown> }).value;
  const w = windowsFor(row.night);
  const expected = datesBetween(w.previous.startDate, w.current.endDate);
  const daily = value.daily;
  if (
    !sameWindow(value.currentWindow, w.current) ||
    !sameWindow(value.previousWindow, w.previous) ||
    !isCount(value.current) ||
    !isCount(value.previous) ||
    !isCount(value.sitesRead) ||
    !Array.isArray(daily) ||
    daily.length !== expected.length
  ) {
    return { value: null, reason: "malformed" };
  }
  const counts = new Map<string, number>();
  for (let i = 0; i < expected.length; i++) {
    const d = daily[i];
    if (!isPlain(d) || d.date !== expected[i] || !isCount(d.visits)) {
      return { value: null, reason: "malformed" };
    }
    counts.set(expected[i]!, d.visits);
  }
  const sumOf = (dates: string[]) => dates.reduce((n, x) => n + (counts.get(x) ?? 0), 0);
  if (
    sumOf(datesBetween(w.current.startDate, w.current.endDate)) !== value.current ||
    sumOf(datesBetween(w.previous.startDate, w.previous.endDate)) !== value.previous
  ) {
    return { value: null, reason: "malformed" };
  }
  return {
    value: {
      night: row.night,
      current: value.current,
      previous: value.previous,
      sitesRead: value.sitesRead,
      daily: counts,
    },
  };
}

/** The search series, read the way `readVisits` reads visits. */
export function readSearch(nights: readonly OverviewNight[] | null): Reading<SearchSeries> {
  if (nights === null) return { value: null, reason: "not readable" };
  const row = nights.find((n) => holdsSeries(n, "search"));
  if (row === undefined) return { value: null, reason: noSeries(nights, "search") };
  const value = (halfOf(row, "search") as { value: Record<string, unknown> }).value;
  const w = windowsFor(row.night);
  const expected = datesBetween(w.search.startDate, w.search.endDate);
  const daily = value.daily;
  if (
    !sameWindow(value.window, w.search) ||
    !isCount(value.clicks) ||
    !isCount(value.impressions) ||
    !isCount(value.sitesRead) ||
    !Array.isArray(daily) ||
    daily.length !== expected.length
  ) {
    return { value: null, reason: "malformed" };
  }
  const counts = new Map<string, { clicks: number; impressions: number }>();
  for (let i = 0; i < expected.length; i++) {
    const d = daily[i];
    if (!isPlain(d) || d.date !== expected[i] || !isCount(d.clicks) || !isCount(d.impressions)) {
      return { value: null, reason: "malformed" };
    }
    counts.set(expected[i]!, { clicks: d.clicks, impressions: d.impressions });
  }
  const clicks = expected.reduce((n, x) => n + (counts.get(x)?.clicks ?? 0), 0);
  const impressions = expected.reduce((n, x) => n + (counts.get(x)?.impressions ?? 0), 0);
  if (clicks !== value.clicks || impressions !== value.impressions) {
    return { value: null, reason: "malformed" };
  }
  return {
    value: {
      night: row.night,
      clicks: value.clicks,
      impressions: value.impressions,
      sitesRead: value.sitesRead,
      daily: counts,
    },
  };
}
