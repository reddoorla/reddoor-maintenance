import { sql } from "kysely";
import type { AirtableBase } from "../reports/airtable/client.js";
import { SUBMISSIONS_TABLE, mapRow } from "../reports/airtable/submissions.js";
import {
  SCREENOUTS_TABLE,
  listScreenOutsSince as airtableListScreenOutsSince,
} from "../reports/airtable/screenouts.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import type { Db } from "./client.js";
import { backfillSubmission } from "./submissions.js";
import { backfillScreenoutBucket, listScreenOutsSince } from "./screenouts.js";

/** Page the entire Airtable Submissions table and insert each row into libSQL,
 *  preserving ids/numbers/status. Re-runnable (backfillSubmission is idempotent).
 *  Returns the number of source rows processed. */
export async function backfillSubmissions(base: AirtableBase, db: Db): Promise<number> {
  const rows: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  for (const row of rows) await backfillSubmission(db, row);
  return rows.length;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read every Airtable Spam Screenouts bucket, pre-sum duplicate (site, date)
 *  buckets in JS, then replace-upsert each aggregated bucket into libSQL. Returns
 *  the number of aggregated (site, date) buckets written. */
export async function backfillScreenouts(base: AirtableBase, db: Db): Promise<number> {
  const agg = new Map<
    string,
    { siteId: string; date: string; honeypot: number; tooFast: number; markedSpam: number }
  >();
  await base(SCREENOUTS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        const f = rec.fields;
        const siteId = (f["Site"] as string[] | undefined)?.[0] ?? "";
        const date = typeof f["Date"] === "string" ? (f["Date"] as string) : "";
        if (!siteId || !date) continue;
        const key = `${siteId} ${date}`;
        const cur = agg.get(key) ?? { siteId, date, honeypot: 0, tooFast: 0, markedSpam: 0 };
        cur.honeypot += num(f["Honeypot"]);
        cur.tooFast += num(f["Too-fast"]);
        cur.markedSpam += num(f["Marked spam"]);
        agg.set(key, cur);
      }
      fetchNextPage();
    });
  for (const bucket of agg.values()) await backfillScreenoutBucket(db, bucket);
  return agg.size;
}

export type ReconcileReport = {
  ok: boolean;
  submissions: { airtable: number; libsql: number };
  screenouts: {
    airtable: { honeypot: number; tooFast: number; markedSpam: number };
    libsql: { honeypot: number; tooFast: number; markedSpam: number };
  };
};

/** Count submissions on both sides and sum the all-time screen-out totals on both
 *  sides; ok only when both match. A mismatch must ABORT the cutover. This is a
 *  count/sum parity gate, NOT a per-row content checksum — it catches a dropped,
 *  extra, or mis-counted row, but not a same-count row whose fields were mangled.
 *  Backfill before reconciling, and freeze Airtable writes first so the snapshot
 *  is stable (backfillSubmission is first-write-wins and won't refresh edited rows). */
export async function reconcile(base: AirtableBase, db: Db): Promise<ReconcileReport> {
  // Submissions: count Airtable by paging, count libSQL with COUNT(*).
  let airtableSubs = 0;
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100, fields: [] })
    .eachPage((records, fetchNextPage) => {
      airtableSubs += records.length;
      fetchNextPage();
    });
  const libCountRow = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM submissions`.execute(db);
  const libsqlSubs = Number(libCountRow.rows[0]?.n ?? 0);

  // Screen-outs: sum all-time fleet totals on each side (since "0001-01-01").
  const aMap = await airtableListScreenOutsSince(base, "0001-01-01");
  const lMap = await listScreenOutsSince(db, "0001-01-01");
  const sumOf = (m: Map<string, { honeypot: number; tooFast: number; markedSpam: number }>) => {
    const t = { honeypot: 0, tooFast: 0, markedSpam: 0 };
    for (const v of m.values()) {
      t.honeypot += v.honeypot;
      t.tooFast += v.tooFast;
      t.markedSpam += v.markedSpam;
    }
    return t;
  };
  const aScreen = sumOf(aMap);
  const lScreen = sumOf(lMap);

  const ok =
    airtableSubs === libsqlSubs &&
    aScreen.honeypot === lScreen.honeypot &&
    aScreen.tooFast === lScreen.tooFast &&
    aScreen.markedSpam === lScreen.markedSpam;

  return {
    ok,
    submissions: { airtable: airtableSubs, libsql: libsqlSubs },
    screenouts: { airtable: aScreen, libsql: lScreen },
  };
}
