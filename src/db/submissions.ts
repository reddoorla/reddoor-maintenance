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

/** A normalized body shorter than this never triggers the exact-duplicate signal —
 *  short/boilerplate lines (a newsletter "subscribe", "hi") legitimately repeat
 *  across real people. */
export const MIN_DUP_BODY_LEN = 40;

/** Both token sets must be at least this large before the Jaccard tier can fire —
 *  two short genuine messages ("what are your hours?" variants) share most of their
 *  few tokens and would otherwise collide. */
export const MIN_SIMILAR_TOKENS = 25;

/** Jaccard similarity (token sets) at or above this marks a near-duplicate. 0.9 is
 *  deliberately strict: a template spray with one substituted greeting/target still
 *  clears it, while two independently-written enquiries about the same business
 *  never do. */
export const SIMILARITY_THRESHOLD = 0.9;

/** Fold a message body down to its template skeleton. Full-Unicode lowercase first
 *  (JS `toLowerCase()` — SQLite's `lower()` is ASCII-only, which is why this whole
 *  comparison lives in JS, folding BOTH sides identically so byte-identical Cyrillic
 *  copies keep matching), then strip everything a spray substitutes per target —
 *  URLs, emails, bare domains, digit runs — and collapse whitespace. Over-stripping
 *  is safe: it happens symmetrically on both sides. */
function normalizeBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ") // full URLs
    .replace(/www\.\S+/gu, " ") // scheme-less www. links
    .replace(/\S+@\S+/gu, " ") // email addresses
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gu, " ") // bare domain tokens (word.tld)
    .replace(/\d+/gu, " ") // digit runs (phone numbers, prices, years)
    .replace(/\s+/gu, " ")
    .trim();
}

/** Letter-only token set of a normalized body (punctuation/symbols are separators). */
function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(/[^\p{L}]+/u).filter((t) => t.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Fleet-wide duplicate/near-duplicate lookup for the spray spam signal — the same
 *  pitch blasted across sites shows up as identical OR near-identical bodies (the
 *  live dog-harness spray differed ONLY in greeting; SEO sprays substitute the
 *  target domain per site — exact match alone missed both). Scans rows submitted
 *  on/after `sinceDate` and compares in JS (see normalizeBody for why not SQL):
 *  - `exact`: normalized equality, only when the normalized incoming body is at
 *    least MIN_DUP_BODY_LEN chars.
 *  - `similar`: token-set Jaccard >= SIMILARITY_THRESHOLD, only when BOTH sets have
 *    at least MIN_SIMILAR_TOKENS tokens. A row matched as exact never re-appears here.
 *  Returned statuses let the caller retro-bucket still-'new' prior copies. The 2000-row
 *  LIMIT is a safety bound only — current volume is ~130/month, so a 30-day window is
 *  always a full scan. */
/** One matched prior row from the duplicate scan. Carries siteId + email so the
 *  ingest caller can exempt a GENUINE same-sender resubmission on the same site
 *  (a real visitor double-submitting / resending after silence) — only cross-site
 *  or different-sender copies are spray evidence. */
export type DuplicateMatch = { id: string; status: string; siteId: string; email: string };

export async function findRecentDuplicateSubmissions(
  db: Db,
  message: string,
  sinceDate: string,
): Promise<{
  exact: DuplicateMatch[];
  similar: DuplicateMatch[];
}> {
  const incoming = normalizeBody(message);
  const incomingTokens = tokenSet(incoming);
  const exactEligible = incoming.length >= MIN_DUP_BODY_LEN;
  const similarEligible = incomingTokens.size >= MIN_SIMILAR_TOKENS;
  // Too short for either tier — skip the scan entirely (nothing could match).
  if (!exactEligible && !similarEligible) return { exact: [], similar: [] };

  const rows = await db
    .selectFrom("submissions")
    .select(["id", "status", "message", "site_id", "email"])
    .where("message", "is not", null)
    .where("submitted_at", ">=", sinceDate)
    .orderBy("submitted_at", "desc")
    .limit(2000)
    .execute();

  const exact: DuplicateMatch[] = [];
  const similar: DuplicateMatch[] = [];
  for (const row of rows) {
    const stored = normalizeBody(row.message ?? "");
    const match: DuplicateMatch = {
      id: row.id,
      status: row.status,
      siteId: row.site_id,
      email: row.email,
    };
    if (exactEligible && stored === incoming) {
      exact.push(match);
      continue; // an exact match must not also appear in similar
    }
    if (!similarEligible) continue;
    const storedTokens = tokenSet(stored);
    if (storedTokens.size < MIN_SIMILAR_TOKENS) continue;
    if (jaccard(incomingTokens, storedTokens) >= SIMILARITY_THRESHOLD) {
      similar.push(match);
    }
  }
  return { exact, similar };
}

/** Recent non-newsletter submissions from `email` (case/whitespace-folded), on/after
 *  `sinceDate` (ISO). Powers the cross-site repeat-sender signal: the fleet's sites
 *  are UNRELATED businesses, so the same address writing to 2+ of them inside a month
 *  is a solicitation tell — the caller compares siteIds (same-site repeats are genuine
 *  follow-ups). Newsletter rows are excluded: one person subscribing on two sites is
 *  legitimate. Both sides fold in SQL (same-side folding, see the normalizeBody note). */
export async function listRecentSubmissionsForEmail(
  db: Db,
  email: string,
  sinceDate: string,
): Promise<Array<{ id: string; siteId: string; status: string }>> {
  if (email.trim() === "") return [];
  const rows = await db
    .selectFrom("submissions")
    .select(["id", "site_id", "status"])
    .where("form_type", "!=", "newsletter")
    .where("submitted_at", ">=", sinceDate)
    .where((eb) => sql<SqlBool>`lower(trim(${eb.ref("email")})) = lower(trim(${email}))`)
    .execute();
  return rows.map((r) => ({ id: r.id, siteId: r.site_id, status: r.status }));
}

/** Retroactively re-bucket prior spray copies once a later copy identifies the spray
 *  (the FIRST copy is always delivered by design — only a repeat reveals it). Appends
 *  `retroReason` to any existing spam_reason so the original classifier trail survives.
 *  The `status = 'new'` guard is load-bearing: rows the operator already read/replied/
 *  archived/marked are NEVER touched — this only cleans the unread queue. */
export async function markSubmissionsSpamRetro(
  db: Db,
  ids: string[],
  retroReason: string,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .updateTable("submissions")
    .set({
      status: "spam_auto",
      spam_reason: sql<string>`CASE WHEN spam_reason IS NULL OR spam_reason = '' THEN ${retroReason} ELSE spam_reason || ',' || ${retroReason} END`,
    })
    .where("id", "in", ids)
    .where("status", "=", "new")
    .execute();
}

/** spam_reason strings for EVERY row matching `filter` (not just one page). Powers the
 *  /submissions per-reason facet line, which must tally the WHOLE filtered bucket — the
 *  rollout runbook directs the operator to judge the canary from it, and a page-scoped
 *  tally under the full-bucket total silently misread once the bucket passed one page.
 *  Capped (default 2000) as a safety bound far above any real bucket. */
export async function listSpamReasonsFiltered(
  db: Db,
  filter: SubmissionFilter,
  cap = 2000,
): Promise<string[]> {
  const base = db.selectFrom("submissions").select(["spam_reason"]);
  const rows = await applySubmissionFilter(base, filter)
    .where("spam_reason", "is not", null)
    .limit(cap)
    .execute();
  return rows.map((r) => r.spam_reason).filter((r): r is string => r !== null && r !== "");
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

/** Re-score write for the `submissions rescore` CLI (2026-07-16): flip ONE still-'new'
 *  row to spam_auto with the CURRENT classifier's verdict. Unlike markSubmissionsSpamRetro
 *  (which appends to the old trail), this REPLACES spam_score/spam_reason — the point of a
 *  re-score is that today's verdict supersedes the stale ingest-time one; the caller bakes
 *  its provenance marker (retro-rescore) into `reason`. The status='new' guard is
 *  load-bearing: rows the operator already read/replied/archived/marked are NEVER
 *  re-bucketed. Returns true when the row was written (false = no longer 'new'). */
export async function rescoreSubmissionSpam(
  db: Db,
  id: string,
  score: number,
  reason: string,
): Promise<boolean> {
  const res = await db
    .updateTable("submissions")
    .set({ status: "spam_auto", spam_score: score, spam_reason: reason })
    .where("id", "=", id)
    .where("status", "=", "new")
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/** Bulk triage for the /submissions page (2026-07-16): flip EVERY still-'new' row
 *  matching `filter` to 'read', server-side, so a 100-row backlog is one click instead
 *  of 100. Reuses applySubmissionFilter (via an id-subquery — kysely's update builder
 *  can't take the select-only helper directly) so the POST flips exactly the bucket the
 *  GET rendered. The outer status='new' guard is load-bearing: spam/archived/read rows
 *  are never touched even when the filter matches them (bulk-"reading" a spam_auto row
 *  would resurrect it into the per-site strip). Returns the number of rows flipped. */
export async function markFilteredAsRead(db: Db, filter: SubmissionFilter): Promise<number> {
  const res = await db
    .updateTable("submissions")
    .set({ status: "read" })
    .where("status", "=", "new")
    .where("id", "in", (eb) =>
      applySubmissionFilter(eb.selectFrom("submissions").select("id"), filter),
    )
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/** Flip a submission's notify_status to 'bounced' by its Resend message id — the
 *  resend-webhook's mapping from a bounce/complaint event back onto the lead whose
 *  notification it was (2026-07-16, the Espada failure mode: 'sent' only means Resend
 *  ACCEPTED the email). Returns whether any row matched, so the webhook can tell a
 *  submission notification apart from a report email (unknown id → false → the report
 *  path handles it). Idempotent: a svix replay re-writes the same terminal value. In
 *  practice only 'sent' rows can match — stampNotified stamps the message id and the
 *  'sent' status together, and failed/skipped rows carry no id. */
export async function markNotifyBouncedByMessageId(db: Db, messageId: string): Promise<boolean> {
  if (messageId === "") return false;
  const res = await db
    .updateTable("submissions")
    .set({ notify_status: "bounced" })
    .where("resend_message_id", "=", messageId)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) > 0) return true;
  // A replayed webhook must still report "this was a submission" (200, stop svix
  // retrying) even though the terminal value is already written — matched-but-
  // unchanged rows still count in numUpdatedRows on SQLite, but don't rely on it.
  const existing = await db
    .selectFrom("submissions")
    .select("id")
    .where("resend_message_id", "=", messageId)
    .executeTakeFirst();
  return existing !== undefined;
}

/** Per-site counts of bounced lead notifications on/after `sinceDate` (ISO), keyed by
 *  the Websites record id (`site_id`). Powers the notify-bounce attention collector —
 *  the caller picks the window (like `countAutoSpamSince`), keeping this query pure.
 *  Windowed on `submitted_at`: the bounce lands minutes after the submission, and
 *  submissions carry no bounce timestamp column (append-only schema, 2026-07-16). */
export async function countNotifyBouncedBySite(
  db: Db,
  sinceDate: string,
): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("submissions")
    .select(["site_id", (eb) => eb.fn.countAll<number>().as("n")])
    .where("notify_status", "=", "bounced")
    .where("submitted_at", ">=", sinceDate)
    .groupBy("site_id")
    .execute();
  return new Map(rows.map((r) => [r.site_id, Number(r.n)]));
}
