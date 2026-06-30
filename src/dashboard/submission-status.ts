import type { SubmissionRow, SubmissionStatus } from "../reports/submission-row.js";
import { SUBMISSION_STATUSES } from "../reports/submission-row.js";

export type SubmissionStatusDeps = {
  getSubmissionById: (id: string) => Promise<SubmissionRow | null>;
  setSubmissionStatusRow: (id: string, status: SubmissionStatus) => Promise<void>;
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
