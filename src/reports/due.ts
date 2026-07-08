import type { WebsiteRow, Frequency, Status } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import type { ReportType } from "./types.js";

/** Statuses where recurring Maintenance/Testing reports are appropriate. Only
 * LIVE sites: "maintenance" (actively maintained) and "hosting". Pre-launch
 * stages ("in development" / "launch period") are excluded — a not-yet-live site
 * must not be drafted a recurring Maintenance/Testing report (that's what was
 * emailing/alarming pre-launch sites); it starts its report cadence when a Launch
 * report flips its Status to "maintenance". Launch reports themselves are a
 * separate manual flow (recipes/launch.ts), never scheduled here. "deprecated" /
 * "probably not our problem" are dropped too. Sites with status=null pass through
 * (partial data; better to surface than silently skip). */
export const ELIGIBLE_STATUSES: ReadonlySet<Status> = new Set<Status>(["maintenance", "hosting"]);

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
 * The next-due date for one (site, type): the date the next report of that type is
 * scheduled to draft, whether or not it's due yet. `null` when there's no schedule —
 * an ineligible status, a "None"/blank frequency, or an unrecognized frequency value.
 *
 * baseDate = the last `Sent at` for this (site, type), else the site's
 * `maintenance day`/`testing day` anchor. With no baseDate at all the next report is
 * due now (returns `today` at UTC midnight). Otherwise baseDate + frequency.
 *
 * Shared with {@link findDueReports} so the scheduler and any schedule display can't
 * drift on what "next" means. NOTE: callers wanting the LOUD unrecognized-frequency
 * warning use findDueReports; this returns null silently for that case.
 */
export function nextDueDate(
  site: WebsiteRow,
  reports: ReportRow[],
  type: ReportType,
  today: Date,
): Date | null {
  if (site.status !== null && !ELIGIBLE_STATUSES.has(site.status)) return null;
  const rawFreq = type === "Maintenance" ? site.maintenanceFreq : site.testingFreq;
  const freq = (typeof rawFreq === "string" ? rawFreq.trim() : rawFreq) as Frequency;
  if (freq === "None" || freq === ("" as Frequency)) return null;
  if (!(freq in MONTHS)) return null;
  const lastSent = lastSentForType(reports, site.id, type);
  const fallback = type === "Maintenance" ? site.maintenanceDay : site.testingDay;
  const baseIso = lastSent ?? fallback;
  if (!baseIso) return startOfDay(today);
  return addMonths(new Date(baseIso), MONTHS[freq]);
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
    // Skip explicitly-non-active statuses (deprecated, "probably not our problem").
    // Null status is treated as active for backwards compat with rows that pre-date
    // the Status convention.
    if (site.status !== null && !ELIGIBLE_STATUSES.has(site.status)) continue;

    for (const type of ["Maintenance", "Testing"] as const) {
      const rawFreq = type === "Maintenance" ? site.maintenanceFreq : site.testingFreq;
      // Normalize obvious whitespace so a trailing-space typo ("Quarterly ") still
      // schedules. The LOUD warning below is the real safety net for genuine
      // casing/spelling mistakes ("monthly", "Quaterly").
      const freq = (typeof rawFreq === "string" ? rawFreq.trim() : rawFreq) as Frequency;
      // Intentional silent skip — "None" (and the empty/blank default) means "no
      // schedule", not a mistake.
      if (freq === "None" || freq === ("" as Frequency)) continue;
      // A non-empty, non-None value that doesn't match a known schedule used to
      // silently produce no due date — the site just vanished from the loop. Warn
      // LOUDLY so a casing/typo Airtable value is fixable instead of invisible.
      if (!(freq in MONTHS)) {
        console.warn(
          `⚠ ${site.name}: unrecognized ${type === "Maintenance" ? "maintenance" : "testing"} frequency '${rawFreq}' — not scheduling; fix the Airtable value`,
        );
        continue;
      }

      const lastSent = lastSentForType(reports, site.id, type);
      // Same computation as the schedule write-back uses. The guards above already
      // proved a schedule exists, so dueDate is non-null; a no-anchor site returns
      // `today`, so the comparison below pushes it as due-now (the prior behavior).
      const dueDate = nextDueDate(site, reports, type, today);
      if (dueDate !== null && todayStart.getTime() >= startOfDay(dueDate).getTime()) {
        out.push({ site, reportType: type, dueDate, lastSent });
      }
    }
  }

  return out;
}

/**
 * The UTC `YYYY-MM` of a `dueDate` from {@link findDueReports} — the per-recurrence
 * idempotency key for drafting. Monthly recurrences land in distinct months; quarterly
 * and yearly land in distinct due-months too, so this uniquely names one draft per cycle.
 * UTC accessors keep it timezone-independent, consistent with the rest of this module.
 */
export function reportPeriodKey(dueDate: Date): string {
  if (Number.isNaN(dueDate.getTime())) throw new TypeError("reportPeriodKey: invalid Date");
  const year = dueDate.getUTCFullYear();
  const month = String(dueDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
