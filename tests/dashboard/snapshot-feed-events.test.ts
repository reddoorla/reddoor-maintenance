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

describe("loadCockpitSnapshot — the feed's deploys are read on their own (P1-87 PR 9)", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "snapshot-deploys-"));
    db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
    // Twenty-five deploys on other sites, newer than everything else: without their own
    // read they would fill the feed's 20-row read and push the merge out of it.
    for (let i = 0; i < 25; i++)
      await recordFleetEvent(db, {
        ...ev(
          `deploy-${i}`,
          `2026-11-16T${String(i).padStart(2, "0")}:30:00.000Z`,
          "site_deployed",
        ),
        siteId: `recOTHER${i}`,
      });
    // A merge and then a deploy on the same site, 30 minutes later: the deploy is left out.
    await recordFleetEvent(db, ev("merge", "2026-11-15T10:00:00.000Z", "pr_automerged"));
    await recordFleetEvent(db, ev("merged-deploy", "2026-11-15T10:30:00.000Z", "site_deployed"));
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("feedEvents carries no deploy, and feedDeploys only the deploys left in", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(snap.feedEvents.some((e) => e.type === "site_deployed")).toBe(false);
    expect(snap.feedEvents.map((e) => e.id)).toEqual(["merge"]);
    expect(snap.feedDeploys.map((e) => e.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `deploy-${24 - i}`),
    );
    expect(snap.feedDeploys.every((e) => e.id !== "merged-deploy")).toBe(true);
    expect(snap.gaps).toEqual([]);
  });
});
