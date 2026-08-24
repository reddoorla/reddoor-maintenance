import { openDb, readDbConfig, type Db } from "../db/client.js";
import { mirrorHealthFields } from "../db/fleet-state.js";

/** One site's just-written Airtable FieldSet, mirrored into site_health. */
export type HealthMirror = (siteId: string, fields: Record<string, unknown>) => Promise<void>;

/** Build the Turso write-through for the nightly writers (#539 Phase 3
 *  dual-write), or null when libSQL creds are absent — mirroring NOT attempted
 *  is a different outcome than mirroring failed, and the caller's summary line
 *  reports mirror counts only when a mirror existed. Same contract as
 *  recordFleetEventsBestEffort: the mirror must never fail the sweep that
 *  produced the data (per-site failures are the caller's to count; Airtable
 *  stays authoritative and the hourly sync converges whatever the mirror
 *  missed). `open` is injectable for tests. */
export async function makeHealthMirrorBestEffort(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<HealthMirror | null> {
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    console.error(`[health-mirror] mirroring disabled: no libSQL (${String(e)})`);
    return null;
  }
  return (siteId, fields) => mirrorHealthFields(db, siteId, fields);
}
