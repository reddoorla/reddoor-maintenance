import type { WebsiteRow, Frequency } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import type { ReportType } from "./types.js";

export type DueItem = {
  site: WebsiteRow;
  reportType: ReportType;
  /** Inclusive: the day the next report became due. */
  dueDate: Date;
  /** ISO date of the last `Sent at` for this (site, type), or null if there's never been one. */
  lastSent: string | null;
};

const MONTHS: Record<Exclude<Frequency, "None">, number> = {
  Monthly: 1,
  Quarterly: 3,
  Yearly: 12,
};

/**
 * Add `n` calendar months in UTC, clamped to the last day of the target month.
 * Jan 31 + 1 month = Feb 28 (not Mar 3, which is what naive setMonth produces).
 * All-UTC accessors mean the result is timezone-independent.
 */
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return out;
}

/** Truncate to UTC midnight. Avoids local-TZ skew when comparing Airtable date-only fields. */
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function lastSentForType(reports: ReportRow[], siteId: string, type: ReportType): string | null {
  const candidates = reports
    .filter((r) => r.siteId === siteId && r.reportType === type && r.sentAt !== null)
    .map((r) => r.sentAt!)
    .sort();
  return candidates[candidates.length - 1] ?? null;
}

/**
 * Computes which (site, type) pairs are due as of `today`.
 *
 * Algorithm per (site, type):
 *  1. If freq === "None", skip.
 *  2. baseDate = max(last Sent at for this type, site's `maintenance/testing day` fallback).
 *  3. If no baseDate exists at all, the site is due now.
 *  4. dueDate = baseDate + frequency months.
 *  5. Due iff startOfDay(today) >= startOfDay(dueDate).
 */
export function findDueReports(
  websites: WebsiteRow[],
  reports: ReportRow[],
  today: Date,
): DueItem[] {
  const out: DueItem[] = [];
  const todayStart = startOfDay(today);

  for (const site of websites) {
    for (const type of ["Maintenance", "Testing"] as const) {
      const freq = type === "Maintenance" ? site.maintenanceFreq : site.testingFreq;
      if (freq === "None") continue;

      const lastSent = lastSentForType(reports, site.id, type);
      const fallback = type === "Maintenance" ? site.maintenanceDay : site.testingDay;
      const baseIso = lastSent ?? fallback;

      if (!baseIso) {
        out.push({ site, reportType: type, dueDate: todayStart, lastSent });
        continue;
      }

      const dueDate = addMonths(new Date(baseIso), MONTHS[freq]);
      if (todayStart.getTime() >= startOfDay(dueDate).getTime()) {
        out.push({ site, reportType: type, dueDate, lastSent });
      }
    }
  }

  return out;
}
