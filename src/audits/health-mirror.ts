import { openDb, readDbConfig, type Db } from "../db/client.js";
import { mirrorHealthFields, mirrorScheduleFields } from "../db/fleet-state.js";

/** One site's just-written Airtable FieldSet, mirrored into site_health.
 *  Resolves true when a site_health row matched; false when the UPDATE touched
 *  0 rows (site created in Airtable after the last hourly import) — callers
 *  count that as mirror_missed, never as mirrored. */
export type HealthMirror = (siteId: string, fields: Record<string, unknown>) => Promise<boolean>;

/** The site_schedule twin, for the nightly next-due write-back. */
export type ScheduleMirror = (
  siteId: string,
  fields: Record<string, unknown>,
  computedAt: string,
) => Promise<void>;

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

/** {@link makeHealthMirrorBestEffort}'s schedule twin — same null-without-creds
 *  contract, for `writeNextDueDates`' site_schedule write-through. */
export async function makeScheduleMirrorBestEffort(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<ScheduleMirror | null> {
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    console.error(`[schedule-mirror] mirroring disabled: no libSQL (${String(e)})`);
    return null;
  }
  return (siteId, fields, computedAt) => mirrorScheduleFields(db, siteId, fields, computedAt);
}
