import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { readOverviewNights } from "../../src/fleet-daily/read.js";

/**
 * P1-78g review round 1 (C6, C7): the overview's nights are read on `/`, which is
 * the sign-in landing, so a row missing a block (written before it existed, or by
 * hand) reads that block as unmeasured instead of throwing the page.
 */
describe("readOverviewNights guards every block it reads", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "overview-nights-"));
    db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (night: string, counts: unknown) =>
    db
      .insertInto("fleet_daily")
      .values({ night, counts: JSON.stringify(counts), written_at: `${night}T07:00:00.000Z` })
      .execute();

  it("a row with none of the blocks reads each as unmeasured, never throws", async () => {
    await put("2026-10-26", {});
    const [n] = await readOverviewNights(db);
    expect(n!.night).toBe("2026-10-26");
    expect(n!.counts.steps).toEqual({});
    // Review round 2 (C8): the run block too, which the overview reads for a step's
    // last finish.
    expect(n!.counts.run).toBeNull();
    for (const block of ["coverage", "screenouts", "events", "prsMerged", "deps"] as const)
      expect(n!.counts[block]).toEqual({ value: null, reason: "not in this row" });
  });

  it("strips the package lists and keeps a failed deps reading's reason", async () => {
    await put("2026-10-25", {
      deps: {
        value: {
          behind: 4,
          sites: {
            recA: { name: "A", packages: ["x@1"] },
            // Not read that night: not one of the sites the sum covers (round 3, O5).
            recB: { name: "B", packages: null },
          },
        },
      },
    });
    await put("2026-10-26", { deps: { value: null, reason: "deps: read failed" } });
    const nights = await readOverviewNights(db);
    expect(nights.map((n) => [n.night, n.counts.deps])).toEqual([
      ["2026-10-26", { value: null, reason: "deps: read failed" }],
      ["2026-10-25", { value: { behind: 4, sitesRead: 1 } }],
    ]);
  });
});
