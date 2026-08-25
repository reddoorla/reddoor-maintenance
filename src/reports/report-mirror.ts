/** #539 Phase 5: the Turso write-through for the Reports write surface.
 *
 *  Before this, the only report mirrors were UPDATEs on the request path
 *  (approve, override, delivery status, commentary). Everything the DRAFTING
 *  path writes — the row itself, the rendered body, the queue flag, a re-run's
 *  refreshed scores — reached Turso only via the hourly sync. Two of those are
 *  visible to the operator today: a fresh draft's row does not exist, and its
 *  preview route answers "No rendered body stored" for up to an hour. At the
 *  freeze they stop being windows.
 *
 *  Deliberately UNLIKE `makeHealthMirrorBestEffort`, this never returns null.
 *  #585 is the reason: Phase 3's next-due mirror silently no-opped in production
 *  for weeks because the factory returned null without creds, and a dead
 *  dual-write then looked exactly like a healthy one — the only tell was an
 *  ABSENT log suffix nobody was watching for. Here creds-absent is a state the
 *  mirror REPORTS, so every write emits one REPORT_MIRROR line and an absent
 *  line means the wiring is gone, not that conditions were quiet.
 */
import { openDb, readDbConfig, type Db } from "../db/client.js";
import {
  mirrorReportInsert,
  mirrorReportPatch,
  storeRenderedHtml,
  type ReportMirrorPatch,
} from "../db/fleet-state.js";
import type { CreatedDraftMirror } from "./airtable/reports.js";

/** The three shapes a report write takes. Injected as ONE object rather than
 *  three parameters because they share a db handle and always travel together:
 *  a caller holding `created` but not `body` produces exactly the half-mirrored
 *  state (row present, preview 404) this module exists to prevent. */
export type ReportMirror = {
  /** A row Airtable just CREATED, as Airtable echoed it back. */
  created: CreatedDraftMirror;
  /** A freshly rendered body for an existing row. */
  body: (reportId: string, html: string) => Promise<void>;
  /** Columns just written to an existing row. */
  patch: (reportId: string, patch: ReportMirrorPatch) => Promise<void>;
};

/** Build the drafting-path mirror. Never throws and never returns null:
 *  Airtable is still authoritative through Phase 5, so a mirror problem must
 *  not cost a draft the operator is waiting on — the hourly sync converges
 *  whatever this misses. `open` is injectable for tests. */
export async function makeReportMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<ReportMirror> {
  let db: Db | null = null;
  let why = "";
  try {
    db = await open();
  } catch (e) {
    why = (e as Error).message;
  }

  const run = async (reportId: string, op: string, work: (db: Db) => Promise<void>) => {
    if (!db) {
      console.log(`REPORT_MIRROR report=${reportId} op=${op} mirrored=absent reason=${why}`);
      return;
    }
    try {
      await work(db);
      console.log(`REPORT_MIRROR report=${reportId} op=${op} mirrored=1`);
    } catch (e) {
      console.log(
        `REPORT_MIRROR report=${reportId} op=${op} mirrored=0 error=${(e as Error).message}`,
      );
    }
  };

  return {
    created: (rec) => run(rec.id, "created", (d) => mirrorReportInsert(d, rec)),
    body: (reportId, html) => run(reportId, "body", (d) => storeRenderedHtml(d, reportId, html)),
    patch: (reportId, patch) =>
      run(reportId, "patch", (d) => mirrorReportPatch(d, reportId, patch)),
  };
}
