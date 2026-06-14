import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

/** Shared SubmissionRow test factory: every field defaulted, override via `over`. */
export function makeSubmissionRow(over: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: "recSUB",
    submissionId: 1,
    siteId: "recSITE",
    formType: "contact",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: null,
    message: "Hello there",
    extraFields: null,
    sourceUrl: null,
    utm: null,
    submittedAt: "2026-06-14T12:00:00.000Z",
    status: "new",
    notifyStatus: "skipped",
    resendMessageId: null,
    ...over,
  };
}
