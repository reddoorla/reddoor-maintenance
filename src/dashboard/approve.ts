import type { ReportRow } from "../reports/airtable/reports.js";

/** Constant operator marker stamped into the audit trail (single operator). */
export const APPROVED_BY = "dashboard";

export type ApproveResult =
  | { status: "approved"; reportId: string }
  | { status: "overridden"; reportId: string; reason: string }
  | {
      status: "noop";
      reportId: string;
      reason: "already-approved" | "already-sent" | "not-draft-ready";
    }
  | {
      status: "blocked";
      reportId: string;
      reason: "send-blocked" | "override-reason-required";
      /** Human-readable blockers ("check: message"). */
      blockers?: string[];
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
  /** Raw writer for the logged override: stamps Send override + reason/by/at + Approved to send. */
  overrideReport: (id: string, at: Date, by: string, reason: string) => Promise<void>;
  now: () => Date;
  /** Send-blocking problems for this report (empty = clear to approve). The .mts
   *  adapter binds approveBlockers() over the live Websites row; tests bind fakes.
   *  This closes the vacuous gate on Launch/Announcement (no checklist) and stops
   *  ANY type being approved into a send that is already known to throw. */
  sendBlockers: (report: ReportRow) => Promise<string[]>;
};

/**
 * Approve a report for sending: the audited flag-flip half of the M3 loop.
 * Idempotent — a no-op (no write) if the row is already approved or already
 * sent; never un-approves. The daily cron's send step keys off the flag.
 */
export async function approveReport(
  deps: ApproveDeps,
  reportId: string,
  override?: { reason: string },
): Promise<ApproveResult> {
  const report = await deps.getReportById(reportId);
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "noop", reportId, reason: "already-sent" };
  if (report.approvedToSend) return { status: "noop", reportId, reason: "already-approved" };
  // The spec gate is draftReady ∧ ¬approved ∧ ¬sent: a not-yet-draft-ready row
  // must never be approvable, even via a hand-crafted authed POST. Without this
  // guard such a POST would pre-approve a row before its draft was prepared.
  if (!report.draftReady) return { status: "noop", reportId, reason: "not-draft-ready" };

  // Logged send-anyway override: a distinct, deliberate action. An empty reason is refused. The
  // override bypasses the HEALTH gate but NOT the real send blockers (missing recipients / header
  // image / report scores) — so evaluate blockers against a synthetic report already carrying the
  // override, which makes healthBlockers self-suppress while the infra blockers remain.
  if (override) {
    const reason = override.reason.trim();
    if (reason === "") return { status: "blocked", reportId, reason: "override-reason-required" };
    const overridden: ReportRow = { ...report, sendOverride: true, overrideReason: reason };
    const blockers = await deps.sendBlockers(overridden);
    if (blockers.length > 0)
      return { status: "blocked", reportId, reason: "send-blocked", blockers };
    await deps.overrideReport(reportId, deps.now(), APPROVED_BY, reason);
    return { status: "overridden", reportId, reason };
  }

  // The send-blocker gate: approving a report whose send is already known to
  // throw (no recipients / malformed address / no header image / no report
  // scores) only schedules a red cron run — block with the reasons instead.
  const blockers = await deps.sendBlockers(report);
  if (blockers.length > 0) return { status: "blocked", reportId, reason: "send-blocked", blockers };
  await deps.approveReportRow(reportId, deps.now(), APPROVED_BY);
  return { status: "approved", reportId };
}
