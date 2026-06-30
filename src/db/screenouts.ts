import { sql } from "kysely";
import type { Db } from "./client.js";

export type ScreenOutReason = "honeypot" | "too-fast";
export type ScreenOutTotals = { honeypot: number; tooFast: number; markedSpam: number };

const COLUMN: Record<ScreenOutReason, "honeypot" | "too_fast"> = {
  honeypot: "honeypot",
  "too-fast": "too_fast",
};

/** Atomically increment the caught counter for a reason on the (site, date) bucket.
 *  ON CONFLICT keeps the count exact — no read-modify-write race, no duplicate
 *  buckets. A swallowed failure must never error a screened bot (caller's job). */
export async function recordScreenOut(
  db: Db,
  siteId: string,
  reason: ScreenOutReason,
  date: string,
): Promise<void> {
  const col = COLUMN[reason];
  await sql`
    INSERT INTO spam_screenouts (site_id, date, ${sql.ref(col)})
    VALUES (${siteId}, ${date}, 1)
    ON CONFLICT (site_id, date) DO UPDATE SET ${sql.ref(col)} = ${sql.ref(col)} + 1
  `.execute(db);
}

/** Per-site spam totals over the window `>= sinceDate`.
 *
 *  `honeypot`/`tooFast` are summed from the ingest-time `spam_screenouts` buckets
 *  (bots screened BEFORE storage — there's no row to count, so an atomic counter
 *  is the right source).
 *
 *  `markedSpam` is DERIVED from the submissions table — a live `COUNT(*) WHERE
 *  status = 'spam'` — NOT a mutable counter. A counter incremented on every
 *  →spam transition double-counts when an operator re-marks a submission
 *  (spam → new → spam) and can never self-correct an un-mark; counting the rows
 *  themselves is exact and idempotent. Windowed by `submitted_at` so it's
 *  arrival-dated, matching the honeypot/too-fast buckets (which key on the
 *  screen = arrival day). The legacy `marked_spam` column is no longer read. */
export async function listScreenOutsSince(
  db: Db,
  sinceDate: string,
): Promise<Map<string, ScreenOutTotals>> {
  const screenoutRows = await db
    .selectFrom("spam_screenouts")
    .select((eb) => [
      "site_id",
      eb.fn.sum<number>("honeypot").as("honeypot"),
      eb.fn.sum<number>("too_fast").as("too_fast"),
    ])
    .where("date", ">=", sinceDate)
    .groupBy("site_id")
    .execute();

  const markedSpamRows = await db
    .selectFrom("submissions")
    .select((eb) => ["site_id", eb.fn.countAll<number>().as("marked_spam")])
    .where("status", "=", "spam")
    .where("submitted_at", ">=", sinceDate)
    .groupBy("site_id")
    .execute();

  const out = new Map<string, ScreenOutTotals>();
  for (const r of screenoutRows) {
    out.set(r.site_id, {
      honeypot: Number(r.honeypot) || 0,
      tooFast: Number(r.too_fast) || 0,
      markedSpam: 0,
    });
  }
  for (const r of markedSpamRows) {
    const totals = out.get(r.site_id) ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
    totals.markedSpam = Number(r.marked_spam) || 0;
    out.set(r.site_id, totals);
  }
  return out;
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries.
 *  Verbatim from the Airtable module so the windows match exactly. */
export function screenOutsSince(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Set the (site, date) bucket to exact totals. Replace-upsert (DO UPDATE SET col
 *  = excluded.col) so re-running the backfill is idempotent. The caller pre-sums
 *  duplicate same-day Airtable buckets in JS before calling this. */
export async function backfillScreenoutBucket(
  db: Db,
  b: { siteId: string; date: string; honeypot: number; tooFast: number; markedSpam: number },
): Promise<void> {
  await sql`
    INSERT INTO spam_screenouts (site_id, date, honeypot, too_fast, marked_spam)
    VALUES (${b.siteId}, ${b.date}, ${b.honeypot}, ${b.tooFast}, ${b.markedSpam})
    ON CONFLICT (site_id, date) DO UPDATE SET
      honeypot = excluded.honeypot,
      too_fast = excluded.too_fast,
      marked_spam = excluded.marked_spam
  `.execute(db);
}
