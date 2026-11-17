import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { recordFleetEvent, type FleetEvent } from "../../src/db/fleet-events.js";
import { loadCockpitSnapshot } from "../../src/dashboard/snapshot.js";

/**
 * P1-87 PR 4: the snapshot reads the Lately feed's events without the sweeps, in a
 * second read (`feedEvents`). `recentEvents`, which `/fleet` folds in, keeps them.
 * A real file database, as the cockpit has in production.
 */
const NOW = new Date("2026-11-17T18:00:00.000Z");

function ev(id: string, ts: string, type: FleetEvent["type"]): FleetEvent {
  return {
    id,
    ts,
    type,
    siteId: type === "fleet_swept" ? null : "recSITE",
    siteName: type === "fleet_swept" ? null : "Caltex",
    summary: `${type} ${id}`,
    data: null,
  };
}

describe("loadCockpitSnapshot — the Lately feed's events leave out the sweeps", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "snapshot-feed-"));
    db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
    // An older real event, then 25 sweeps newer than it: the sweeps fill the 20-row read.
    await recordFleetEvent(db, ev("merge", "2026-11-15T10:00:00.000Z", "pr_automerged"));
    for (let i = 0; i < 25; i++)
      await recordFleetEvent(
        db,
        ev(`sweep-${i}`, `2026-11-16T${String(i).padStart(2, "0")}:00:00.000Z`, "fleet_swept"),
      );
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("feedEvents holds the real event, and no sweep, though the sweeps are newer", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(snap.feedEvents.map((e) => e.id)).toEqual(["merge"]);
    expect(snap.gaps).toEqual([]);
  });

  it("recentEvents still carries the sweeps, as /fleet's Recently fold does", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(snap.recentEvents).toHaveLength(20);
    expect(snap.recentEvents.every((e) => e.type === "fleet_swept")).toBe(true);
  });
});
