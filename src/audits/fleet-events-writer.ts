import { openDb, readDbConfig, type Db } from "../db/client.js";
import { recordFleetEvent, pruneFleetEvents, type FleetEvent } from "../db/fleet-events.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Persist a batch of fleet events + prune the 30-day window — best-effort.
 *  Opens its OWN libSQL connection (the producers carry only Airtable creds today).
 *  A missing TURSO_* (creds not yet added to the workflow) or any write error is
 *  swallowed with a console.error: recording fleet activity must NEVER fail the
 *  sweep that produced it. The feed ships dark until the creds are present.
 *  `open` is injectable for tests. */
export async function recordFleetEventsBestEffort(
  events: FleetEvent[],
  now: Date,
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<void> {
  if (events.length === 0) return;
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    console.error(`[fleet-events] skipped ${events.length} event(s): no libSQL (${String(e)})`);
    return;
  }
  try {
    for (const e of events) await recordFleetEvent(db, e);
    await pruneFleetEvents(db, new Date(now.getTime() - RETENTION_MS).toISOString());
  } catch (e) {
    console.error(`[fleet-events] write failed: ${String(e)}`);
  }
}
