import { openDb, readDbConfig, type Db } from "../db/client.js";
import { mirrorHealthFields, mirrorScheduleFields } from "../db/fleet-state.js";

/** One site's FieldSet, written into site_health.
 *  Resolves true when a site_health row matched; false when the UPDATE touched
 *  0 rows — callers count that as mirror_missed, never as mirrored. */
export type HealthMirror = (siteId: string, fields: Record<string, unknown>) => Promise<boolean>;

/** The site_schedule twin, for the nightly next-due write-back. Same
 *  matched-row contract as {@link HealthMirror}: false = 0-row UPDATE →
 *  mirror_missed. */
export type ScheduleMirror = (
  siteId: string,
  fields: Record<string, unknown>,
  computedAt: string,
) => Promise<boolean>;

/** Build the Turso write for the nightly writers (#539 Phase 3). Throws when
 *  libSQL is unreachable: Turso is the only store, so a sweep with no mirror
 *  would discard every write with nothing to converge it. Per-site failures are
 *  the caller's to count. `open` is injectable for tests. */
export async function makeHealthMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<HealthMirror> {
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    throw new Error(`health-mirror unavailable: ${String(e)}`, { cause: e });
  }
  return (siteId, fields) => mirrorHealthFields(db, siteId, fields);
}

/** {@link makeHealthMirror}'s schedule twin, for `writeNextDueDates`'
 *  site_schedule write. */
export async function makeScheduleMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<ScheduleMirror> {
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    throw new Error(`schedule-mirror unavailable: ${String(e)}`, { cause: e });
  }
  return (siteId, fields, computedAt) => mirrorScheduleFields(db, siteId, fields, computedAt);
}
