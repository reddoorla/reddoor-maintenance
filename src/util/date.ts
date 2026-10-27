/** UTC `YYYY-MM-DD`, the date shape every report date column stores and the
 *  GA and Search Console date ranges take. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries. */
export function screenOutsSince(now: Date, days: number): string {
  return ymd(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

/** An ISO timestamp as a long US date ("October 20, 2026"), in UTC.
 *  `toLocaleDateString` on an invalid Date returns the string "Invalid Date"
 *  rather than throwing, so this checks `getTime()` and falls back to the raw
 *  string: a corrupt timestamp then still reads as a timestamp. */
export function formatIsoDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
