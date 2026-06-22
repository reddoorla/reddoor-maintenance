import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import { escapeFormulaString } from "./reports.js";
import {
  SUBMISSION_FORM_TYPES,
  type FormType,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
  NOTIFY_STATUSES,
  type NotifyStatus,
  toFormType,
  toStatus,
  toNotifyStatus,
  type SubmissionRow,
  type SubmissionInput,
} from "../submission-row.js";

export const SUBMISSIONS_TABLE = "Submissions";

// Re-export the row shape + validators so existing importers (forms/ingest.ts,
// dashboard/submission-status.ts, the render code) keep importing from
// airtable/submissions.js unchanged.
export {
  SUBMISSION_FORM_TYPES,
  SUBMISSION_STATUSES,
  NOTIFY_STATUSES,
  toFormType,
  toStatus,
  toNotifyStatus,
};
export type { FormType, SubmissionStatus, NotifyStatus, SubmissionRow, SubmissionInput };

export function mapRow(rec: { id: string; fields: Record<string, unknown> }): SubmissionRow {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  return {
    id: rec.id,
    submissionId: typeof f["Submission ID"] === "number" ? (f["Submission ID"] as number) : null,
    siteId: linkSites[0] ?? "",
    formType: toFormType(f["Form type"] as string | undefined),
    name: String(f["Name"] ?? ""),
    email: String(f["Email"] ?? ""),
    phone: (f["Phone"] as string | undefined) ?? null,
    message: (f["Message"] as string | undefined) ?? null,
    extraFields: (f["Extra fields"] as string | undefined) ?? null,
    sourceUrl: (f["Source URL"] as string | undefined) ?? null,
    utm: (f["UTM"] as string | undefined) ?? null,
    submittedAt: (f["Submitted at"] as string | undefined) ?? null,
    status: toStatus(f["Status"] as string | undefined),
    notifyStatus: toNotifyStatus(f["Notify status"] as string | undefined),
    resendMessageId: (f["Resend message ID"] as string | undefined) ?? null,
  };
}

export async function createSubmission(
  base: AirtableBase,
  input: SubmissionInput,
): Promise<SubmissionRow> {
  const fields: FieldSet = {
    Site: [input.siteId],
    "Form type": input.formType,
    Name: input.name,
    Email: input.email,
    "Submitted at": input.submittedAt.toISOString(),
    Status: "new",
  };
  if (input.phone !== undefined) fields["Phone"] = input.phone;
  if (input.message !== undefined) fields["Message"] = input.message;
  if (input.extraFields !== undefined && Object.keys(input.extraFields).length > 0)
    fields["Extra fields"] = JSON.stringify(input.extraFields);
  if (input.sourceUrl !== undefined) fields["Source URL"] = input.sourceUrl;
  if (input.utm !== undefined) fields["UTM"] = input.utm;
  const created = (await base(SUBMISSIONS_TABLE).create([{ fields }])) as Records<FieldSet>;
  const rec = created[0];
  if (!rec) throw new Error("Airtable create returned no records");
  return mapRow({ id: rec.id, fields: rec.fields });
}

export async function listNewSubmissions(base: AirtableBase): Promise<SubmissionRow[]> {
  const out: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ filterByFormula: "{Status} = 'new'", pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  // Confirm in JS — the fake base ignores filterByFormula, and a stray status
  // must never slip into the "new" queue.
  return out
    .filter((s) => s.status === "new")
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
}

export async function listSubmissionsForSite(
  base: AirtableBase,
  site: { id: string; name: string },
  max = 200,
): Promise<SubmissionRow[]> {
  // Narrow server-side instead of paging the entire Submissions table on every
  // /s/:slug load — the one unbounded table at fleet scale. {Site} is a linked
  // field, so its formula value is the linked Website's primary field (Name);
  // fleet names are unique, so {Site} = "<name>" identifies this site's rows.
  // (Mirrors getWebsiteBySlug's server-side filter refactor.)
  const out: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({
      filterByFormula: `{Site} = "${escapeFormulaString(site.name)}"`,
      sort: [{ field: "Submitted at", direction: "desc" }],
      maxRecords: max,
      pageSize: 100,
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  // Confirm by the linked record id in JS: the name filter leans on the
  // uniqueness invariant, and the test fake ignores filterByFormula — this keeps
  // the result correct (and sorted newest-first) under both.
  return out
    .filter((s) => s.siteId === site.id)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
}

export async function getSubmissionById(
  base: AirtableBase,
  id: string,
): Promise<SubmissionRow | null> {
  const rows: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ filterByFormula: `RECORD_ID() = ${JSON.stringify(id)}`, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows.find((r) => r.id === id) ?? null;
}

export async function setSubmissionStatusRow(
  base: AirtableBase,
  id: string,
  status: SubmissionStatus,
): Promise<void> {
  await base(SUBMISSIONS_TABLE).update([{ id, fields: { Status: status } }]);
}

export async function stampNotified(
  base: AirtableBase,
  id: string,
  status: NotifyStatus,
  messageId: string | null,
): Promise<void> {
  const fields: Record<string, string> = { "Notify status": status };
  if (messageId !== null) fields["Resend message ID"] = messageId;
  await base(SUBMISSIONS_TABLE).update([{ id, fields }]);
}
