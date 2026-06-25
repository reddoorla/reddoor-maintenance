import type { Selectable } from "kysely";
import type { Db } from "./client.js";
import type { FleetEventsTable } from "./schema.js";

export type FleetEventType =
  | "pr_automerged"
  | "vuln_cleared"
  | "ci_recovered"
  | "site_launched"
  | "fleet_swept"
  | "cert_renewed";

/** One recorded fleet activity event. `id` is deterministic (see the detectors)
 *  so re-runs INSERT OR IGNORE without duplicating. `siteId`/`siteName` are null
 *  for fleet-wide rollups; `data` is optional structured detail (e.g. the PR url). */
export type FleetEvent = {
  id: string;
  ts: string;
  type: FleetEventType;
  siteId: string | null;
  siteName: string | null;
  summary: string;
  data: unknown | null;
};

/** Tolerant JSON parse for the stored `data` column — a malformed value (should
 *  never happen, we wrote it) degrades to null rather than throwing the read. */
function parseData(raw: string | null): unknown | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToEvent(r: Selectable<FleetEventsTable>): FleetEvent {
  return {
    id: r.id,
    ts: r.ts,
    type: r.type as FleetEventType,
    siteId: r.site_id,
    siteName: r.site_name,
    summary: r.summary,
    data: parseData(r.data),
  };
}

/** Idempotent append: INSERT OR IGNORE on the deterministic primary key, so an
 *  overlapping/re-run sweep never duplicates an event. The first write wins. */
export async function recordFleetEvent(db: Db, e: FleetEvent): Promise<void> {
  await db
    .insertInto("fleet_events")
    .values({
      id: e.id,
      ts: e.ts,
      type: e.type,
      site_id: e.siteId,
      site_name: e.siteName,
      summary: e.summary,
      data: e.data == null ? null : JSON.stringify(e.data),
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

/** Recent events at/after `sinceIso`, newest-first, capped at `limit`. */
export async function listFleetEvents(
  db: Db,
  opts: { sinceIso: string; limit: number },
): Promise<FleetEvent[]> {
  const rows = await db
    .selectFrom("fleet_events")
    .selectAll()
    .where("ts", ">=", opts.sinceIso)
    .orderBy("ts", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map(rowToEvent);
}

/** Retention prune: delete events strictly older than `beforeIso`. */
export async function pruneFleetEvents(db: Db, beforeIso: string): Promise<void> {
  await db.deleteFrom("fleet_events").where("ts", "<", beforeIso).execute();
}
