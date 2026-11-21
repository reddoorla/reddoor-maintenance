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
    // Hourly from 2026-11-16T00:30Z (the 24th lands on the 17th, still before the merge below).
    for (let i = 0; i < 25; i++)
      await recordFleetEvent(db, {
        ...ev(
          `deploy-${i}`,
          new Date(Date.UTC(2026, 10, 16, 0, 30) + i * 3_600_000).toISOString(),
          "site_deployed",
        ),
        siteId: `recOTHER${i}`,
      });
    // A merge and then a deploy on the same site, 30 minutes later: the deploy is left out.
    // Both are newer than every filler deploy, so the 20-row cap cannot be what hides it.
    await recordFleetEvent(db, ev("merge", "2026-11-17T10:00:00.000Z", "pr_automerged"));
    await recordFleetEvent(db, ev("merged-deploy", "2026-11-17T10:30:00.000Z", "site_deployed"));
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

  // P1-87 PR 9, review C1: /fleet's Recently lane reads `recentEvents`, so the deploys leave
  // that read too, and reach the lane through `feedDeploys` under the same rule.
  it("recentEvents carries no deploy, so the 25 newer deploys cannot fill it (C1)", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(snap.recentEvents.some((e) => e.type === "site_deployed")).toBe(false);
    expect(snap.recentEvents.map((e) => e.id)).toEqual(["merge"]);
  });
});

// #2193: the week's start is NOW - 7 days. A merge exactly an hour before it hides the
// same site's deploy exactly at it (DEPLOY_AFTER_MERGE_MS apart; both ends inclusive), so
// the merges must be read the whole hour early, to the millisecond; a deploy before the
// start is never listed.
describe("loadCockpitSnapshot — a merge just before the week still hides the deploy after it", () => {
  let dir: string;
  let db: Db;
  const START = NOW.getTime() - 7 * 86_400_000;
  const iso = (ms: number): string => new Date(START + ms).toISOString();
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "snapshot-deploy-edge-"));
    db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
    await recordFleetEvent(db, ev("early-merge", iso(-60 * 60_000), "pr_automerged"));
    await recordFleetEvent(db, ev("edge-deploy", iso(0), "site_deployed"));
    await recordFleetEvent(db, {
      ...ev("old-deploy", iso(-5 * 60_000), "site_deployed"),
      siteId: "recOTHER",
    });
    await recordFleetEvent(db, {
      ...ev("kept-deploy", iso(30 * 60_000), "site_deployed"),
      siteId: "recOTHER",
    });
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("feedDeploys holds only the other site's deploy inside the week", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(snap.feedDeploys.map((e) => e.id)).toEqual(["kept-deploy"]);
    expect(snap.gaps).toEqual([]);
  });
});
