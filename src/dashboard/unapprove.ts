import type { ReportRow } from "../reports/report-fields.js";
import { APPROVED_BY } from "./approve.js";

export type UnapproveResult =
  | { status: "unapproved"; reportId: string }
  | {
      status: "noop";
      reportId: string;
      reason: "already-sent" | "withdrawn" | "not-approved";
    }
  | { status: "not-found"; reportId: string };

/** Injected IO, the same shape as WithdrawDeps: the `.mts` adapter binds Turso,
 *  tests bind fakes. */
export type UnapproveDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  /** Resolves `false` when the conditioned write matched no row: the row was
   *  sent, withdrawn or unapproved after it was read. */
  unapproveReportRow: (
    id: string,
    unapprovedAt: Date,
    unapprovedBy: string,
  ) => Promise<boolean | void>;
  now: () => Date;
};

/**
 * Take back an approval before the send batch delivers it (#1262). Only an
 * approved, unsent, unwithdrawn row can be unapproved; it becomes pending again,
 * so "refresh preview" re-reads its scores and evidence. Every other state is a
 * no-op with no write. A send stamped between the read and the write wins: the
 * write is conditioned on `sent_at IS NULL`, and the miss is named from a re-read.
 */
export async function unapproveReport(
  deps: UnapproveDeps,
  reportId: string,
): Promise<UnapproveResult> {
  const refusal = refuse(await deps.getReportById(reportId), reportId);
  if (refusal) return refusal;
  if ((await deps.unapproveReportRow(reportId, deps.now(), APPROVED_BY)) === false) {
    const lost = refuse(await deps.getReportById(reportId), reportId);
    if (lost) return lost;
    throw new Error(
      `unapprove ${reportId}: the write matched no row, and a re-read cannot say why`,
    );
  }
  return { status: "unapproved", reportId };
}

function refuse(report: ReportRow | null, reportId: string): UnapproveResult | null {
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "noop", reportId, reason: "already-sent" };
  if (report.withdrawnAt !== null) return { status: "noop", reportId, reason: "withdrawn" };
  if (!report.approvedToSend) return { status: "noop", reportId, reason: "not-approved" };
  return null;
}
