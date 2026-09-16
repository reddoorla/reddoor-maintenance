import type { SubmissionRow, SubmissionStatus } from "../reports/submission-row.js";
import { SUBMISSION_STATUSES } from "../reports/submission-row.js";

export type SubmissionStatusDeps = {
  getSubmissionById: (id: string) => Promise<SubmissionRow | null>;
  setSubmissionStatusRow: (id: string, status: SubmissionStatus) => Promise<void>;
  /** #783. Stamp this bounce as acknowledged; false when it already was. */
  ackNotifyBounce: (id: string) => Promise<boolean>;
};

export type SubmissionStatusResult =
  | { status: "updated"; submissionId: string; newStatus: SubmissionStatus }
  | { status: "noop"; submissionId: string; reason: "already-set" }
  | { status: "invalid"; requested: string }
  | { status: "not-found"; submissionId: string };

function isStatus(v: unknown): v is SubmissionStatus {
  return typeof v === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(v);
}

/**
 * Operator status transition. Idempotent: a request for the row's current status
 * is a no-op (no write). Rejects an unknown status before any read.
 */
export async function setSubmissionStatus(
  deps: SubmissionStatusDeps,
  submissionId: string,
  requested: unknown,
): Promise<SubmissionStatusResult> {
  if (!isStatus(requested)) return { status: "invalid", requested: String(requested) };
  const row = await deps.getSubmissionById(submissionId);
  if (!row) return { status: "not-found", submissionId };
  if (row.status === requested) return { status: "noop", submissionId, reason: "already-set" };
  await deps.setSubmissionStatusRow(submissionId, requested);
  // The "got through, marked spam" metric is DERIVED from the rows (a live
  // COUNT(*) WHERE status = 'spam' in listScreenOutsSince), not incremented here —
  // so re-marking a submission can't double-count it and un-marking self-corrects.
  return { status: "updated", submissionId, newStatus: requested };
}

/** #783. Outcome of acknowledging a bounced lead notification. */
export type SubmissionAckResult =
  | { status: "acked"; submissionId: string }
  | { status: "noop"; submissionId: string; reason: "not-bounced" | "already-acked" }
  | { status: "not-found"; submissionId: string };

/**
 * Acknowledge a bounced notification as NOT a dead point-of-contact address.
 *
 * The row keeps its bounce record and stops counting toward the notify-bounce
 * alarm. Before this the only exits were fourteen days of aging or a hand-run
 * UPDATE against the production `submissions` table — which is what happened for
 * Espada on 2026-09-14, and which destroyed the bounce evidence along with the
 * alarm.
 *
 * Refuses a row that never bounced, so the gesture cannot drift into a
 * general-purpose "hide this submission". A PERMANENT bounce IS ackable: the ack
 * means "I have looked at this", and the case most worth closing is the one
 * where the operator has just fixed the mailbox.
 */
export async function acknowledgeNotifyBounce(
  deps: SubmissionStatusDeps,
  submissionId: string,
): Promise<SubmissionAckResult> {
  const row = await deps.getSubmissionById(submissionId);
  if (!row) return { status: "not-found", submissionId };
  if (row.notifyStatus !== "bounced") {
    return { status: "noop", submissionId, reason: "not-bounced" };
  }
  const wrote = await deps.ackNotifyBounce(submissionId);
  return wrote
    ? { status: "acked", submissionId }
    : { status: "noop", submissionId, reason: "already-acked" };
}
