import type { ReportType } from "./types.js";
import type { AirtableBase } from "./airtable/client.js";
import { listReportsForSite, isPendingApproval, setDraftReady } from "./airtable/reports.js";

/**
 * Report tiers — a higher tier is a SUPERSET of the lower ones, so only the highest-tier
 * un-sent draft is worth keeping in a site's approve queue. Maintenance ⊂ Testing ⊂
 * {Announcement, Launch}. Announcement and Launch share tier 3 (neither supersets the other).
 */
export const REPORT_TIER: Record<ReportType, number> = {
  Maintenance: 1,
  Testing: 2,
  Announcement: 3,
  Launch: 3,
};

export function reportTier(type: ReportType): number {
  return REPORT_TIER[type];
}

export type QueueOutcome = {
  /** Whether `report` was placed in (kept in) the approve queue. */
  queued: boolean;
  /** When `queued` is false, the queued report type that subsumes this one. */
  blockedBy?: ReportType;
  /** Ids of lower-tier queued reports that this one superseded (un-queued). */
  supersededIds: string[];
};

/**
 * Enforce "one report queued per site, highest tier wins" at draft time. Given a freshly
 * created/reused report, look at the OTHER reports already pending approval for the same site
 * (Draft ready ∧ ¬Approved ∧ ¬Sent) and:
 *
 * - If any is of an EQUAL-OR-HIGHER tier → the new report is subsumed: leave it un-queued
 *   (Draft ready = false) and report `blockedBy`. (Equal-tier, e.g. a queued Launch when an
 *   Announcement is drafted, keeps the existing one rather than silently replacing it.)
 * - Otherwise the new report is strictly the highest → un-queue every (strictly lower) pending
 *   report for the site (superseded, not deleted — the row is kept) and queue the new one.
 *
 * Returns what happened so the caller can surface it. PURE side effects are all `setDraftReady`.
 */
export async function queueDraft(
  base: AirtableBase,
  report: { id: string; siteId: string; reportType: ReportType },
): Promise<QueueOutcome> {
  const newTier = reportTier(report.reportType);
  const others = (await listReportsForSite(base, report.siteId))
    .filter(isPendingApproval)
    .filter((r) => r.id !== report.id);

  const blocker = others.find((r) => reportTier(r.reportType) >= newTier);
  if (blocker) {
    // A queued report already covers this one. Make sure the new draft is NOT queued (the reuse
    // path may hand us a row that was Draft-ready from a prior run) and stand down.
    await setDraftReady(base, report.id, false);
    return { queued: false, blockedBy: blocker.reportType, supersededIds: [] };
  }

  // The new report is strictly the highest-tier pending — supersede the rest (un-queue), keep it.
  const supersededIds: string[] = [];
  for (const r of others) {
    await setDraftReady(base, r.id, false);
    supersededIds.push(r.id);
  }
  await setDraftReady(base, report.id, true);
  return { queued: true, supersededIds };
}
