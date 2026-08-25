import type { ReportRow } from "../reports/airtable/reports.js";

/**
 * Report review, #539 Phase 4 — the operator-written half of a client report.
 *
 * Commentary is edited in Airtable today; this is the console's write path for
 * it, shaped like `setSiteDetail`: validate before reading, write one named
 * field, return a status the caller renders rather than throwing.
 *
 * THE LOCK IS `sentAt`, NOT APPROVAL — an operator ruling, not an inference from
 * the approve flow. Approving means "this is ready to go", so a typo spotted
 * between approving and the cron's send should still be fixable. Once the email
 * is out, the stored row is the record of what the client actually read, and
 * editing it would leave the row describing an email nobody received.
 */

/** Upper bound on a commentary cell. Matches the copy-override fields in the
 *  site editor — commentary is a paragraph in a client email, not a document,
 *  and an unbounded string reaching Airtable is a hand-crafted-POST concern
 *  rather than a typo. */
export const COMMENTARY_MAX_LEN = 2000;

export type ReportCommentaryDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  updateCommentary: (id: string, text: string) => Promise<void>;
};

export type ReportCommentaryResult =
  | { status: "updated"; reportId: string }
  /** The report has already been sent — nothing was written. */
  | { status: "locked"; reportId: string }
  | { status: "invalid"; reportId: string }
  | { status: "not-found"; reportId: string };

/**
 * Set one report's commentary. Empty (after trim) is allowed and clears the
 * cell — commentary is optional, and a field that can be set but not unset traps
 * the operator in whatever they first typed.
 */
export async function setReportCommentary(
  deps: ReportCommentaryDeps,
  reportId: string,
  rawText: string,
): Promise<ReportCommentaryResult> {
  const text = rawText.trim();
  // Validate BEFORE the read, the same order `setSiteDetail` uses: an
  // over-long value is refused without costing an Airtable round-trip.
  if (text.length > COMMENTARY_MAX_LEN) return { status: "invalid", reportId };

  const report = await deps.getReportById(reportId);
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "locked", reportId };

  await deps.updateCommentary(reportId, text);
  return { status: "updated", reportId };
}
