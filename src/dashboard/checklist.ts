import type { ReportRow } from "../reports/airtable/reports.js";
import { ALL_CHECKLIST_FIELDS, isChecklistComplete } from "../reports/checklist.js";

/**
 * Injected IO for the checklist-toggle endpoint. The `.mts` adapter binds these
 * to a live Airtable base; tests bind fakes. Mirrors approve.ts's deps shape.
 */
export type ChecklistItemDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  setReportChecklistItem: (id: string, field: string, value: boolean) => Promise<void>;
};

export type ChecklistItemResult =
  | { status: "ok"; reportId: string; field: string; value: boolean; complete: boolean }
  | { status: "bad-field"; reportId: string; field: string }
  | { status: "not-found"; reportId: string };

/**
 * Flip one operator-checklist checkbox on a report row, then report whether the
 * report's checklist is now complete (so the dashboard can enable/disable the
 * Approve button without a reload).
 *
 * SAFETY: only the 12 known checklist columns (ALL_CHECKLIST_FIELDS) are writable.
 * An unknown `field` is rejected BEFORE any read — a hand-crafted authed POST can
 * never write an arbitrary Airtable column. `complete` is computed from the
 * POST-update state: the loaded row's checklist with this one field overlaid,
 * so the response is correct without a re-read.
 */
export async function setChecklistItem(
  deps: ChecklistItemDeps,
  reportId: string,
  field: string,
  value: boolean,
): Promise<ChecklistItemResult> {
  if (!ALL_CHECKLIST_FIELDS.includes(field)) return { status: "bad-field", reportId, field };
  const report = await deps.getReportById(reportId);
  if (!report) return { status: "not-found", reportId };
  await deps.setReportChecklistItem(reportId, field, value);
  // Compute completeness from the post-update state: overlay this one change onto
  // the loaded checklist rather than re-reading (one fewer round trip, and the
  // write we just made is authoritative for this field).
  const complete = isChecklistComplete({
    reportType: report.reportType,
    checklist: { ...report.checklist, [field]: value },
  });
  return { status: "ok", reportId, field, value, complete };
}
