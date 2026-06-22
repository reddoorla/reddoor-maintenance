import { sql } from "kysely";
import type { Selectable } from "kysely";
import type { Db } from "./client.js";
import type { SubmissionsTable } from "./schema.js";
import {
  type SubmissionRow,
  type SubmissionInput,
  toFormType,
  toStatus,
  toNotifyStatus,
} from "../reports/submission-row.js";
import type { FormType, SubmissionStatus } from "../reports/submission-row.js";

export type SubmissionFilter = {
  siteId?: string;
  formType?: FormType;
  status?: SubmissionStatus;
  /** LIKE %q% across name/email/message/phone, case-insensitive */
  search?: string;
  /** submitted_at >= from (ISO string) */
  from?: string;
  /** submitted_at <= to (ISO string) */
  to?: string;
};

/** Map a raw DB row to the canonical SubmissionRow, narrowing the enum columns
 *  with the SAME validators the Airtable mapRow uses — SQLite stores TEXT, so a
 *  bad stored value must still be defended against. */
function rowFromDb(r: Selectable<SubmissionsTable>): SubmissionRow {
  return {
    id: r.id,
    submissionId: r.submission_id,
    siteId: r.site_id,
    formType: toFormType(r.form_type),
    name: r.name,
    email: r.email,
    phone: r.phone,
    message: r.message,
    extraFields: r.extra_fields,
    sourceUrl: r.source_url,
    utm: r.utm,
    submittedAt: r.submitted_at,
    status: toStatus(r.status),
    notifyStatus: toNotifyStatus(r.notify_status),
    resendMessageId: r.resend_message_id,
  };
}

/** Opaque, collision-free id. crypto is a Node 20 global — no new dep. */
export function newSubmissionId(): string {
  return `sub_${crypto.randomUUID()}`;
}

export async function getSubmissionById(db: Db, id: string): Promise<SubmissionRow | null> {
  const r = await db.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? rowFromDb(r) : null;
}

export async function createSubmission(db: Db, input: SubmissionInput): Promise<SubmissionRow> {
  const id = newSubmissionId();
  const extra =
    input.extraFields !== undefined && Object.keys(input.extraFields).length > 0
      ? JSON.stringify(input.extraFields)
      : null;
  await db
    .insertInto("submissions")
    .values({
      id,
      // Display number: MAX+1 in a single statement. libSQL is single-writer, so
      // writes serialize and this is race-free.
      submission_id: sql<number>`(SELECT COALESCE(MAX(submission_id), 0) + 1 FROM submissions)`,
      site_id: input.siteId,
      form_type: input.formType,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      message: input.message ?? null,
      extra_fields: extra,
      source_url: input.sourceUrl ?? null,
      utm: input.utm ?? null,
      submitted_at: input.submittedAt.toISOString(),
      status: "new",
      notify_status: "skipped",
      resend_message_id: null,
    })
    .execute();
  const created = await getSubmissionById(db, id);
  if (!created) throw new Error("createSubmission: row vanished after insert");
  return created;
}

import type { NotifyStatus } from "../reports/submission-row.js";

export async function listNewSubmissions(db: Db): Promise<SubmissionRow[]> {
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where("status", "=", "new")
    .orderBy("submitted_at", "desc")
    .execute();
  return rows.map(rowFromDb);
}

/** Same signature shape as the Airtable version (takes `{ id, name }`) so the
 *  composition-root swap is import-only — but here we filter by id directly, with
 *  no linked-field/primary-field workaround and no JS-confirm pass. */
export async function listSubmissionsForSite(
  db: Db,
  site: { id: string; name: string },
  max = 200,
): Promise<SubmissionRow[]> {
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where("site_id", "=", site.id)
    .orderBy("submitted_at", "desc")
    .limit(max)
    .execute();
  return rows.map(rowFromDb);
}

export async function setSubmissionStatusRow(
  db: Db,
  id: string,
  status: SubmissionStatus,
): Promise<void> {
  await db.updateTable("submissions").set({ status }).where("id", "=", id).execute();
}

export async function stampNotified(
  db: Db,
  id: string,
  status: NotifyStatus,
  messageId: string | null,
): Promise<void> {
  const patch =
    messageId !== null
      ? { notify_status: status, resend_message_id: messageId }
      : { notify_status: status };
  await db.updateTable("submissions").set(patch).where("id", "=", id).execute();
}

// NOTE: listSubmissionsFiltered and countSubmissionsFiltered share identical filter
// logic via applySubmissionFilter — always update both through that helper.
function applySubmissionFilter<O>(
  qb: import("kysely").SelectQueryBuilder<import("./schema.js").Database, "submissions", O>,
  f: SubmissionFilter,
) {
  let q = qb;
  if (f.siteId !== undefined) q = q.where("site_id", "=", f.siteId);
  if (f.formType !== undefined) q = q.where("form_type", "=", f.formType);
  if (f.status !== undefined) q = q.where("status", "=", f.status);
  if (f.from !== undefined) q = q.where("submitted_at", ">=", f.from);
  if (f.to !== undefined) q = q.where("submitted_at", "<=", f.to);
  if (f.search !== undefined && f.search.trim() !== "") {
    const like = `%${f.search.trim().toLowerCase()}%`;
    q = q.where((eb) =>
      eb.or([
        eb(eb.fn("lower", ["name"]), "like", like),
        eb(eb.fn("lower", ["email"]), "like", like),
        eb(eb.fn("lower", ["message"]), "like", like),
        eb(eb.fn("lower", ["phone"]), "like", like),
      ]),
    );
  }
  return q;
}

export async function listSubmissionsFiltered(
  db: Db,
  filter: SubmissionFilter,
  opts: { limit: number; offset: number },
): Promise<SubmissionRow[]> {
  const base = db.selectFrom("submissions").selectAll();
  const rows = await applySubmissionFilter(base, filter)
    .orderBy("submitted_at", "desc")
    .limit(opts.limit)
    .offset(opts.offset)
    .execute();
  return rows.map(rowFromDb);
}

export async function countSubmissionsFiltered(db: Db, filter: SubmissionFilter): Promise<number> {
  const base = db.selectFrom("submissions").select((eb) => eb.fn.countAll<number>().as("n"));
  const res = await applySubmissionFilter(base, filter).executeTakeFirstOrThrow();
  return Number(res.n);
}

/** Insert a SubmissionRow verbatim, preserving its id, display number, and status.
 *  ON CONFLICT(id) DO NOTHING makes the whole backfill re-runnable. */
export async function backfillSubmission(db: Db, row: SubmissionRow): Promise<void> {
  await db
    .insertInto("submissions")
    .values({
      id: row.id,
      submission_id: row.submissionId,
      site_id: row.siteId,
      form_type: row.formType,
      name: row.name,
      email: row.email,
      phone: row.phone,
      message: row.message,
      extra_fields: row.extraFields,
      source_url: row.sourceUrl,
      utm: row.utm,
      submitted_at: row.submittedAt,
      status: row.status,
      notify_status: row.notifyStatus,
      resend_message_id: row.resendMessageId,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}
