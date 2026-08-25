/** #539 Phase 5: the Turso write-through for NEWLY CREATED Reports rows.
 *
 *  Every report mirror built before this one is an UPDATE, which does nothing at
 *  all for a row that does not exist yet — so a draft created at 09:05 was
 *  invisible to the Turso-backed console until the 09:20 sync. Phase 4 moved
 *  report review onto Turso, which makes that window visible to the operator
 *  today; at the freeze it stops being a window and becomes a lost row.
 *
 *  Deliberately UNLIKE `makeHealthMirrorBestEffort`, this never returns null.
 *  #585 is the reason: Phase 3's next-due mirror silently no-opped in production
 *  for weeks because the factory returned null without creds, and a dead
 *  dual-write then looked exactly like a healthy one — the only tell was an
 *  ABSENT log suffix nobody was watching for. Here creds-absent is a state the
 *  mirror REPORTS, so every draft emits one DRAFT_MIRROR line and an absent line
 *  means the wiring is gone, not that conditions were quiet.
 */
import { openDb, readDbConfig, type Db } from "../db/client.js";
import { mirrorReportInsert } from "../db/fleet-state.js";
import type { CreatedDraftMirror } from "./airtable/reports.js";

/** Build the create-side mirror. Never throws and never returns null: Airtable
 *  is still authoritative through Phase 5, so a mirror problem must not cost a
 *  draft the operator is waiting on — the hourly sync converges whatever this
 *  misses. `open` is injectable for tests. */
export async function makeDraftMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<CreatedDraftMirror> {
  let db: Db | null = null;
  let why = "";
  try {
    db = await open();
  } catch (e) {
    why = (e as Error).message;
  }
  return async (rec) => {
    if (!db) {
      console.log(`DRAFT_MIRROR report=${rec.id} mirrored=absent reason=${why}`);
      return;
    }
    try {
      await mirrorReportInsert(db, rec);
      console.log(`DRAFT_MIRROR report=${rec.id} mirrored=1`);
    } catch (e) {
      console.log(`DRAFT_MIRROR report=${rec.id} mirrored=0 error=${(e as Error).message}`);
    }
  };
}
