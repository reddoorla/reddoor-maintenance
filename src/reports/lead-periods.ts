import { isLeadFormType, type FormType } from "../forms/types.js";
import { isLead } from "./lead-source.js";
import { reportWindows, REPORT_WINDOW_DAYS, type GaDateRange } from "./ga/window.js";

/**
 * Leads by period (P1-127, Tim 2026-11-23: "filter leads by time vs. all time
 * ... the last 30 days ... or month over month"). PURE.
 *
 * A lead is {@link isCountedLead}: a non-signup form, not bucketed as spam, sent
 * from the site's production host by a real sender. Days are Pacific, Reddoor's own, and
 * the 30-day windows are {@link reportWindows}: the 30 complete days that
 * ended yesterday and the 30 before. They are the same windows the report's
 * analytics block compares where the GA property reports in Pacific time; a
 * property in another time zone cuts its days a few hours apart from these.
 */
export const LEADS_TIME_ZONE = "America/Los_Angeles";

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Oct 25" for `2026-10-25`; "Oct '26" for `2026-10`. The cockpit's one
 *  formatter for these dates. */
export function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return `${MONTH_ABBR[m - 1]} ${d}`;
}
export function shortMonth(ym: string): string {
  const [y, m] = ym.split("-") as [string, string];
  return `${MONTH_ABBR[Number(m) - 1]} '${y.slice(2)}`;
}

/** How many complete calendar months the month-over-month row shows. */
export const LEAD_MONTHS = 6;

export type LeadPeriods = {
  /** Leads in the current 30-day window. */
  last30: number;
  /** Leads in the 30 days before it. */
  prior30: number;
  allTime: number;
  current: GaDateRange;
  previous: GaDateRange;
  /** The last {@link LEAD_MONTHS} complete Pacific months, oldest first (`YYYY-MM`). */
  months: Array<{ month: string; count: number }>;
};

/** The one lead rule, a row at a time: not spam, a lead form (not a signup), and
 *  `isLead` (from the site's own apex/www page, not a test sender;
 *  reddoorla/reddoor-maintenance#2296). The report's LEADS block, the site page's
 *  lead panel (from Turso and from the snapshot) and the digest's 24h leads all
 *  count by it. */
export function isCountedLead(
  row: { status: string; formType: string; sourceUrl: string | null; email: string },
  siteUrl: string,
): boolean {
  return (
    row.status !== "spam" &&
    row.status !== "spam_auto" &&
    isLeadFormType(row.formType as FormType) &&
    isLead(row, siteUrl)
  );
}

const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEADS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM` of the month `back` months before `ym`. */
function monthBefore(ym: string, back: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - back;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Bucket lead timestamps (ISO instants, already filtered to leads). A value
 *  that is not a date is left out of every count. */
export function leadPeriods(submittedAt: readonly string[], now: Date): LeadPeriods {
  const { current, previous } = reportWindows(now, LEADS_TIME_ZONE, REPORT_WINDOW_DAYS);
  const thisMonth = pacificDate.format(now).slice(0, 7);
  const months = Array.from({ length: LEAD_MONTHS }, (_, i) => ({
    month: monthBefore(thisMonth, LEAD_MONTHS - i),
    count: 0,
  }));
  const byMonth = new Map(months.map((m) => [m.month, m]));
  let last30 = 0;
  let prior30 = 0;
  let allTime = 0;
  for (const at of submittedAt) {
    // A backfilled row keeps its stored text verbatim; one that is not a date is
    // skipped rather than throwing the whole site page (review round 1).
    const t = Date.parse(at);
    if (Number.isNaN(t)) continue;
    allTime++;
    const day = pacificDate.format(new Date(t));
    if (day >= current.startDate && day <= current.endDate) last30++;
    else if (day >= previous.startDate && day <= previous.endDate) prior30++;
    const bucket = byMonth.get(day.slice(0, 7));
    if (bucket) bucket.count++;
  }
  return { last30, prior30, allTime, current, previous, months };
}
