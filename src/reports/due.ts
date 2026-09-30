import type { WebsiteRow, Frequency, Status } from "../fleet/site-row.js";
import type { ReportRow } from "./report-fields.js";
import type { ReportType } from "./types.js";

/** Statuses where recurring Maintenance/Testing reports are appropriate. Only
 * LIVE sites: "maintained" and "hosted-only". Pre-launch
 * stages ("building" / "launching") are excluded — a not-yet-live site
 * must not be drafted a recurring Maintenance/Testing report (that's what was
 * emailing/alarming pre-launch sites); it starts its report cadence when a Launch
 * report flips its Status to "maintained". Launch reports themselves are a
 * separate manual flow (recipes/launch.ts), never scheduled here. "archived" /
 * "external" are dropped too. Sites with status=null pass through
 * (partial data; better to surface than silently skip). */
export const ELIGIBLE_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "maintained",
  "hosted-only",
]);

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

/** Truncate to UTC midnight. Avoids local-TZ skew when comparing date-only fields. */
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

/** When the latest withdrawn draft of this (site, type) was made. `Completed on`
 *  is stamped with the draft day when the row is created (and re-stamped when a
 *  launch/announce re-run redrafts it); a row without one falls back to its
 *  withdrawal stamp. */
function lastWithdrawnDraftForType(
  reports: ReportRow[],
  siteId: string,
  type: ReportType,
): string | null {
  const candidates = reports
    .filter((r) => r.siteId === siteId && r.reportType === type && r.withdrawnAt !== null)
    .map((r) => r.completedOn ?? r.withdrawnAt!)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return candidates[candidates.length - 1] ?? null;
}

/**
 * The next-due date for one (site, type): the date the next report of that type is
 * scheduled to draft, whether or not it's due yet. `null` when there's no schedule —
 * an ineligible status or a "None" frequency. Unrecognized/blank raw values never
 * reach here: `toFrequency` trims, warns LOUDLY, and coerces them to "None" at the
 * read boundary.
 *
 * baseDate = the last `Sent at` for this (site, type), else the site's
 * `maintenance day`/`testing day` anchor. With no baseDate at all the next report is
 * due now (returns `today` at UTC midnight). Otherwise baseDate + frequency.
 *
 * P1-28: a withdrawn draft consumes its cycle as if it had been sent on the day it
 * was drafted, so the base is the later of the last send and that draft day. Not
 * the withdrawal click: withdrawing a September draft in October must not push the
 * next report to November. An overdue site catches up in one step.
 *
 * Shared with {@link findDueReports} so the scheduler and any schedule display can't
 * drift on what "next" means.
 */
export function nextDueDate(
  site: WebsiteRow,
  reports: ReportRow[],
  type: ReportType,
  today: Date,
): Date | null {
  if (site.status !== null && !ELIGIBLE_STATUSES.has(site.status)) return null;
  const freq = type === "Maintenance" ? site.maintenanceFreq : site.testingFreq;
  if (freq === "None") return null;
  const lastSent = lastSentForType(reports, site.id, type);
  const withdrawnDraft = lastWithdrawnDraftForType(reports, site.id, type);
  const latest =
    lastSent !== null && withdrawnDraft !== null
      ? Date.parse(lastSent) >= Date.parse(withdrawnDraft)
        ? lastSent
        : withdrawnDraft
      : (lastSent ?? withdrawnDraft);
  const fallback = type === "Maintenance" ? site.maintenanceDay : site.testingDay;
  const baseIso = latest ?? fallback;
  if (!baseIso) return startOfDay(today);
  return addMonths(new Date(baseIso), MONTHS[freq]);
}

/** Both stored next-due dates for a site, date-only (`YYYY-MM-DD`) or null when
 *  that type has no schedule — what site_schedule holds. The nightly write-back
 *  and the withdraw endpoint both write through this. */
export function nextDueDates(
  site: WebsiteRow,
  reports: ReportRow[],
  today: Date,
): { maintenanceAt: string | null; testingAt: string | null } {
  const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
  return {
    maintenanceAt: ymd(nextDueDate(site, reports, "Maintenance", today)),
    testingAt: ymd(nextDueDate(site, reports, "Testing", today)),
  };
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
    // Skip explicitly-non-active statuses ("archived", "external").
    // Null status is treated as active for backwards compat with rows that pre-date
    // the Status convention.
    if (site.status !== null && !ELIGIBLE_STATUSES.has(site.status)) continue;

    for (const type of ["Maintenance", "Testing"] as const) {
      const freq = type === "Maintenance" ? site.maintenanceFreq : site.testingFreq;
      // Intentional silent skip — "None" (also the coerced default for blank cells)
      // means "no schedule", not a mistake. A trailing-space or typo'd raw value
      // never reaches here: `toFrequency` trims (so "Quarterly " schedules) and
      // warns LOUDLY on anything still unrecognized before coercing
      // it to "None" — the guard lives at the read boundary, not in this loop.
      if (freq === "None") continue;

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
