import { ymd } from "../../util/date.js";

const MS_PER_DAY = 86_400_000;

/** The length of every report's analytics window, and of the window it is
 *  compared against. The email says "vs the previous 30 days", so this is the
 *  number the label is built from (P1-73). */
export const REPORT_WINDOW_DAYS = 30;

/** An inclusive GA Data API date range, as calendar dates in the property's timezone. */
export type GaDateRange = { startDate: string; endDate: string };

/**
 * The report's two analytics windows: the `days` complete days that ended
 * yesterday in the property's own timezone, and the `days` before those. PURE.
 *
 * GA cuts its days in the property's reporting timezone, so a window built
 * from UTC dates (the old `ymd`) is a different set of days. Ending on
 * "yesterday" there keeps a day still in progress out of the count: the
 * 12:16am PT 2026-10-25 ERP draft queried a 16-minute-old day while 10-24 was
 * still processing, and stored 906 where the finished data gives 940. Throws
 * on a timezone `Intl` cannot read, rather than falling back to UTC.
 */
export function reportWindows(
  now: Date,
  timeZone: string,
  days: number = REPORT_WINDOW_DAYS,
): { current: GaDateRange; previous: GaDateRange } {
  if (!timeZone) throw new Error("GA property has no reporting timezone");
  // en-CA formats as YYYY-MM-DD. Throws a RangeError on an unknown zone.
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Calendar arithmetic on a date with no time of day, so a DST change in the
  // window cannot shift a boundary.
  const day = (offset: number): string =>
    ymd(new Date(Date.parse(`${localToday}T00:00:00Z`) + offset * MS_PER_DAY));
  return {
    current: { startDate: day(-days), endDate: day(-1) },
    previous: { startDate: day(-2 * days), endDate: day(-days - 1) },
  };
}
