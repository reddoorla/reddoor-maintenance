import type { ReportRow } from "../reports/report-fields.js";
import { APPROVED_BY } from "./approve.js";

export type WithdrawResult =
  | { status: "withdrawn"; reportId: string }
  | {
      status: "noop";
      reportId: string;
      reason: "already-sent" | "already-approved" | "already-withdrawn" | "not-draft-ready";
    }
  | { status: "not-found"; reportId: string };

/** Injected IO, the same shape as ApproveDeps: the `.mts` adapter binds Turso,
 *  tests bind fakes. */
export type WithdrawDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  /** Resolves `false` when the conditioned write matched no row: the row left
   *  the pending state after it was read. */
  withdrawReportRow: (
    id: string,
    withdrawnAt: Date,
    withdrawnBy: string,
  ) => Promise<boolean | void>;
  now: () => Date;
};

/**
 * "Don't send" (P1-28): take a draft the operator decided against out of the
 * approve queue for good. Only a pending draft (ready, not approved, not sent,
 * not withdrawn) can be withdrawn; every other state is a no-op with no write.
 * The row keeps `draft_ready`, because the drafting path reads a same-period
 * row that is not ready as a crashed half-draft and would re-complete it.
 */
export async function withdrawReport(
  deps: WithdrawDeps,
  reportId: string,
): Promise<WithdrawResult> {
  const refusal = refuse(await deps.getReportById(reportId), reportId);
  if (refusal) return refusal;
  if ((await deps.withdrawReportRow(reportId, deps.now(), APPROVED_BY)) === false) {
    const lost = refuse(await deps.getReportById(reportId), reportId);
    if (lost) return lost;
    throw new Error(`withdraw ${reportId}: the write matched no row, and a re-read cannot say why`);
  }
  return { status: "withdrawn", reportId };
}

function refuse(report: ReportRow | null, reportId: string): WithdrawResult | null {
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "noop", reportId, reason: "already-sent" };
  if (report.withdrawnAt !== null) return { status: "noop", reportId, reason: "already-withdrawn" };
  if (report.approvedToSend) return { status: "noop", reportId, reason: "already-approved" };
  if (!report.draftReady) return { status: "noop", reportId, reason: "not-draft-ready" };
  return null;
}
