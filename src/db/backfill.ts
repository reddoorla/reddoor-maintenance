import type { AirtableBase } from "../reports/airtable/client.js";
import { SUBMISSIONS_TABLE, mapRow } from "../reports/airtable/submissions.js";
import { SCREENOUTS_TABLE } from "../reports/airtable/screenouts.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import type { Db } from "./client.js";
import { backfillSubmission } from "./submissions.js";
import { backfillScreenoutBucket } from "./screenouts.js";

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
