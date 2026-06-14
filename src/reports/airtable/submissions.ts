import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";

export const SUBMISSIONS_TABLE = "Submissions";

export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const NOTIFY_STATUSES = ["sent", "failed", "skipped"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

function toFormType(raw: string | undefined): FormType {
  if (raw && (SUBMISSION_FORM_TYPES as readonly string[]).includes(raw)) return raw as FormType;
  if (raw)
    console.warn(`[submissions] unknown Form type ${JSON.stringify(raw)} — treating as contact`);
  return "contact";
}

function toStatus(raw: string | undefined): SubmissionStatus {
  if (raw && (SUBMISSION_STATUSES as readonly string[]).includes(raw))
    return raw as SubmissionStatus;
  return "new";
}

function toNotifyStatus(raw: string | undefined): NotifyStatus {
  if (raw && (NOTIFY_STATUSES as readonly string[]).includes(raw)) return raw as NotifyStatus;
  return "skipped";
}

export type SubmissionRow = {
  id: string;
  submissionId: number | null;
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  /** Raw JSON string of any site-specific fields the typed columns didn't claim. */
  extraFields: string | null;
  sourceUrl: string | null;
  utm: string | null;
  submittedAt: string | null;
  status: SubmissionStatus;
  notifyStatus: NotifyStatus;
  resendMessageId: string | null;
};

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

export type SubmissionInput = {
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  extraFields?: Record<string, unknown>;
  sourceUrl?: string;
  utm?: string;
  submittedAt: Date;
};

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

export async function listRecentSubmissions(
  base: AirtableBase,
  max = 200,
): Promise<SubmissionRow[]> {
  const out: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")).slice(0, max);
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
  siteId: string,
): Promise<SubmissionRow[]> {
  const all = await listRecentSubmissions(base);
  return all.filter((s) => s.siteId === siteId);
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
