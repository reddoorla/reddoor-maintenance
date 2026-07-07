import type { ReportRow } from "../reports/airtable/reports.js";
import { ALL_CHECKLIST_FIELDS, isHealthGateClear } from "../reports/checklist.js";

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
 * Flip one operator-checklist checkbox on a report row (an advisory record only —
 * see below), then report whether the report is now health-gate clear (so the
 * dashboard can enable/disable the Approve button without a reload).
 *
 * SAFETY: only the known checklist columns (ALL_CHECKLIST_FIELDS) are writable.
 * An unknown `field` is rejected BEFORE any read — a hand-crafted authed POST can
 * never write an arbitrary Airtable column. `complete` is computed from the
 * already-loaded row's `autoEvidence` via {@link isHealthGateClear} — the box
 * write itself no longer drives the gate, so no re-read is needed either way.
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
  // The gate now reads HEALTH evidence, not the manual booleans — ticking a box is retired from
  // the gating path (the box is still written for the operator's record). `complete` mirrors the
  // send/approve gate so the Approve button re-enables exactly when the site is green.
  const complete = isHealthGateClear({
    reportType: report.reportType,
    autoEvidence: report.autoEvidence ?? {},
  });
  return { status: "ok", reportId, field, value, complete };
}
