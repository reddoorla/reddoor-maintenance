import type { ReportRow } from "../reports/airtable/reports.js";

/** Constant operator marker stamped into the audit trail (single operator). */
export const APPROVED_BY = "dashboard";

export type ApproveResult =
  | { status: "approved"; reportId: string }
  | {
      status: "noop";
      reportId: string;
      reason: "already-approved" | "already-sent" | "not-draft-ready";
    }
  | { status: "not-found"; reportId: string };

/**
 * Injected IO. The handler is pure w.r.t. these: the `.mts` adapter binds them
 * to a live Airtable base, tests bind fakes. `now` is injected so the audit
 * timestamp is deterministic under test (matches the report-HTML/render split).
 */
export type ApproveDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  approveReportRow: (id: string, approvedAt: Date, approvedBy: string) => Promise<void>;
  now: () => Date;
};

/**
 * Approve a report for sending: the audited flag-flip half of the M3 loop.
 * Idempotent — a no-op (no write) if the row is already approved or already
 * sent; never un-approves. The daily cron's send step keys off the flag.
 */
export async function approveReport(deps: ApproveDeps, reportId: string): Promise<ApproveResult> {
  const report = await deps.getReportById(reportId);
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "noop", reportId, reason: "already-sent" };
  if (report.approvedToSend) return { status: "noop", reportId, reason: "already-approved" };
  // The spec gate is draftReady ∧ ¬approved ∧ ¬sent: a not-yet-draft-ready row
  // must never be approvable, even via a hand-crafted authed POST. Without this
  // guard such a POST would pre-approve a row before its draft was prepared.
  if (!report.draftReady) return { status: "noop", reportId, reason: "not-draft-ready" };
  await deps.approveReportRow(reportId, deps.now(), APPROVED_BY);
  return { status: "approved", reportId };
}
