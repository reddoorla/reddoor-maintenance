import type { AirtableBase } from "../reports/airtable/client.js";
import { SUBMISSIONS_TABLE, mapRow } from "../reports/airtable/submissions.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import type { Db } from "./client.js";
import { backfillSubmission } from "./submissions.js";

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
