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

/** Atomically increment the "got through, marked spam" counter on the (site, date) bucket. */
export async function recordMarkedSpam(db: Db, siteId: string, date: string): Promise<void> {
  await sql`
    INSERT INTO spam_screenouts (site_id, date, marked_spam)
    VALUES (${siteId}, ${date}, 1)
    ON CONFLICT (site_id, date) DO UPDATE SET marked_spam = marked_spam + 1
  `.execute(db);
}

/** Sum each counter per site over buckets with date >= sinceDate — a single
 *  indexed GROUP BY, replacing the full-table scan + JS windowing. */
export async function listScreenOutsSince(
  db: Db,
  sinceDate: string,
): Promise<Map<string, ScreenOutTotals>> {
  const rows = await db
    .selectFrom("spam_screenouts")
    .select((eb) => [
      "site_id",
      eb.fn.sum<number>("honeypot").as("honeypot"),
      eb.fn.sum<number>("too_fast").as("too_fast"),
      eb.fn.sum<number>("marked_spam").as("marked_spam"),
    ])
    .where("date", ">=", sinceDate)
    .groupBy("site_id")
    .execute();
  const out = new Map<string, ScreenOutTotals>();
  for (const r of rows) {
    out.set(r.site_id, {
      honeypot: Number(r.honeypot) || 0,
      tooFast: Number(r.too_fast) || 0,
      markedSpam: Number(r.marked_spam) || 0,
    });
  }
  return out;
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries.
 *  Verbatim from the Airtable module so the windows match exactly. */
export function screenOutsSince(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
