import { sql } from "kysely";
import type { Selectable, SqlBool } from "kysely";
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
    spamScore: typeof r.spam_score === "number" ? r.spam_score : null,
    spamReason: r.spam_reason,
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
      status: input.status ?? "new",
      notify_status: "skipped",
      resend_message_id: null,
      spam_score: input.spamScore ?? null,
      spam_reason: input.spamReason ?? null,
    })
    .execute();
  const created = await getSubmissionById(db, id);
  if (!created) throw new Error("createSubmission: row vanished after insert");
  return created;
}

import type { NotifyStatus } from "../reports/submission-row.js";

export async function listNewSubmissions(db: Db, max = 200): Promise<SubmissionRow[]> {
  // Bound the fetch (matches listSubmissionsForSite's default): the cockpit loads this whole
  // array on every render. Unbounded, it deserializes every unread submission fleet-wide. The
  // badge count therefore caps at `max` — acceptable, since >200 unread fleet-wide is itself a
  // triage emergency, and the /submissions page is the unbounded, filterable view.
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where("status", "=", "new")
    .orderBy("submitted_at", "desc")
    .limit(max)
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
    // Escape LIKE metacharacters so a user's literal `%`/`_` (or the escape char `\`) match
    // literally rather than as wildcards: searching `john_doe` must not also hit `johnXdoe`,
    // and a bare `%` must not match everything. `\` is escaped first (it's the ESCAPE char).
    // Parameterized regardless (no injection) — this is a correctness fix. Uses sql`` because
    // kysely's `like` operator can't attach an ESCAPE clause.
    const term = f.search
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    const like = `%${term}%`;
    q = q.where((eb) =>
      eb.or([
        sql<SqlBool>`lower(${eb.ref("name")}) like ${like} escape '\\'`,
        sql<SqlBool>`lower(${eb.ref("email")}) like ${like} escape '\\'`,
        sql<SqlBool>`lower(${eb.ref("message")}) like ${like} escape '\\'`,
        sql<SqlBool>`lower(${eb.ref("phone")}) like ${like} escape '\\'`,
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

/** Fleet-wide count of auto-filtered spam (`status = 'spam_auto'`) submitted on/after
 *  `sinceDate` (ISO). Powers the cockpit "N auto-filtered this week — review" affordance;
 *  the caller picks the window (like `listScreenOutsSince`), keeping this query pure. */
export async function countAutoSpamSince(db: Db, sinceDate: string): Promise<number> {
  const res = await db
    .selectFrom("submissions")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("status", "=", "spam_auto")
    .where("submitted_at", ">=", sinceDate)
    .executeTakeFirstOrThrow();
  return Number(res.n);
}

/** A body shorter than this never triggers the duplicate-spray signal — short/boilerplate
 *  lines (a newsletter "subscribe", "hi") legitimately repeat across real people. */
export const MIN_DUP_BODY_LEN = 40;

/** Fleet-wide count of submissions whose message body equals `message` (trimmed +
 *  lowercased) and were submitted on/after `sinceDate` (ISO). Powers the velocity /
 *  duplicate-spray spam signal — the same pitch blasted across sites (or re-run) shows
 *  up as identical bodies. Bodies shorter than `MIN_DUP_BODY_LEN` return 0 so a short
 *  line never collides two real leads. Case/whitespace-normalized to catch trivial
 *  variation; the SQL `lower(trim())` mirrors the JS normalization for an exact match. */
export async function countRecentDuplicateMessages(
  db: Db,
  message: string,
  sinceDate: string,
): Promise<number> {
  const norm = message.trim().toLowerCase();
  if (norm.length < MIN_DUP_BODY_LEN) return 0;
  const res = await db
    .selectFrom("submissions")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("submitted_at", ">=", sinceDate)
    .where((eb) => sql<SqlBool>`lower(trim(${eb.ref("message")})) = ${norm}`)
    .executeTakeFirstOrThrow();
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
      spam_score: row.spamScore ?? null,
      spam_reason: row.spamReason ?? null,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}
