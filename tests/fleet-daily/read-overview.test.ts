import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { readOverviewNights } from "../../src/fleet-daily/read.js";
import { readTraffic } from "../../src/fleet-daily/traffic.js";

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

  it("the blocks the trends read are guarded too (P1-78h)", async () => {
    await put("2026-10-26", {});
    const [n] = await readOverviewNights(db);
    for (const block of ["sites", "signals", "leads"] as const)
      expect(n!.counts[block]).toEqual({ value: null, reason: "not in this row" });
  });

  it("a block with no value (hand-written as {}) reads as unmeasured too (P1-78h round 2)", async () => {
    const blocks = [
      "coverage",
      "sites",
      "signals",
      "leads",
      "screenouts",
      "events",
      "prsMerged",
      "deps",
    ];
    await put("2026-10-26", Object.fromEntries(blocks.map((b) => [b, {}])));
    const [n] = await readOverviewNights(db);
    for (const block of blocks)
      expect(n!.counts[block as "sites"], block).toEqual({
        value: null,
        reason: "not in this row",
      });
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

  it("traffic (P1-87 PR 6): an old row reads it unmeasured, and a visits half with no previous count is not in the row", async () => {
    const traffic = { value: { visits: { value: { current: 9 } } } };
    await put("2026-11-16", { traffic });
    await put("2026-11-15", {});
    const [newer, older] = await readOverviewNights(db);
    // Review round 3, Group A: a visits half with no `previous` is not a valid half, so it
    // reads as not in the row (it used to pass through whole).
    expect(newer!.counts.traffic).toEqual({
      value: {
        visits: { value: null, reason: "not in this row" },
        search: { value: null, reason: "not in this row" },
      },
    });
    expect(older!.counts.traffic).toEqual({ value: null, reason: "not in this row" });
  });

  // Review round 1, Group F: the page ships one night's per-day series and per-site array,
  // not 32 of them. The older nights keep their totals, windows and counts.
  it("the older traffic rows drop the daily series and the per-site array; the newest keeps both", async () => {
    const window = { startDate: "2026-10-18", endDate: "2026-11-16" };
    const block = (n: number) => ({
      visits: {
        value: {
          current: n,
          previous: n - 1,
          currentWindow: window,
          previousWindow: window,
          sitesRead: 2,
          sitesWithProperty: 2,
          daily: [{ date: "2026-11-16", visits: n }],
        },
      },
      search: {
        value: {
          clicks: n,
          impressions: n * 10,
          window,
          sitesRead: 1,
          sitesWithProperty: 1,
          daily: [{ date: "2026-11-14", clicks: n, impressions: n * 10 }],
        },
      },
      sites: [{ siteId: "acme", visits: { value: { current: n, previous: 1 } } }],
    });
    await put("2026-11-16", { traffic: { value: block(9) } });
    await put("2026-11-15", { traffic: { value: block(7) } });
    const [newer, older] = await readOverviewNights(db);
    const nt = newer!.counts.traffic.value!;
    expect(nt.sites).toHaveLength(1);
    expect(nt.visits.value!.daily).toHaveLength(1);
    expect(nt.search.value!.daily).toHaveLength(1);
    const ot = older!.counts.traffic.value!;
    expect(ot).not.toHaveProperty("sites");
    expect(ot.visits.value).not.toHaveProperty("daily");
    expect(ot.search.value).not.toHaveProperty("daily");
    expect(ot.visits.value).toMatchObject({ current: 7, previous: 6 });
    expect(ot.search.value).toMatchObject({ clicks: 7, impressions: 70 });
    // Review round 4, Group A (major 1): every key each half keeps is pinned, with `daily` only
    // on the newest row.
    expect(ot.visits.value).toEqual({
      current: 7,
      previous: 6,
      currentWindow: window,
      previousWindow: window,
      sitesRead: 2,
      sitesWithProperty: 2,
    });
    expect(ot.search.value).toEqual({
      clicks: 7,
      impressions: 70,
      window,
      sitesRead: 1,
      sitesWithProperty: 1,
    });
    expect(nt.visits.value).toEqual({
      current: 9,
      previous: 8,
      currentWindow: window,
      previousWindow: window,
      sitesRead: 2,
      sitesWithProperty: 2,
      daily: [{ date: "2026-11-16", visits: 9 }],
    });
    expect(nt.search.value).toEqual({
      clicks: 9,
      impressions: 90,
      window,
      sitesRead: 1,
      sitesWithProperty: 1,
      daily: [{ date: "2026-11-14", clicks: 9, impressions: 90 }],
    });
  });
});

// Review round 2, Group A: a partial older row never throws the page, and a failed newest
// night keeps the series of the newest row that holds one.
describe("readOverviewNights keeps the traffic series whole on the newest row with a value", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "overview-traffic-"));
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
  const window = { startDate: "2026-10-18", endDate: "2026-11-16" };
  const block = (n: number) => ({
    visits: {
      value: {
        current: n,
        previous: n - 1,
        currentWindow: window,
        previousWindow: window,
        sitesRead: 2,
        sitesWithProperty: 2,
        daily: [{ date: "2026-11-16", visits: n }],
      },
    },
    search: {
      value: {
        clicks: n,
        impressions: n * 10,
        window,
        sitesRead: 1,
        sitesWithProperty: 1,
        daily: [{ date: "2026-11-14", clicks: n, impressions: n * 10 }],
      },
    },
    sites: [{ siteId: "acme", visits: { value: { current: n, previous: 1 } } }],
  });

  it("an older row with a bare value and one with only visits never throw; the newest keeps its series", async () => {
    await put("2026-11-16", { traffic: { value: block(9) } });
    await put("2026-11-15", { traffic: { value: {} } });
    await put("2026-11-14", {
      traffic: { value: { visits: { value: { current: 3 } } } },
    });
    const nights = await readOverviewNights(db);
    expect(nights).toHaveLength(3);
    const [newer, bare, partial] = nights;
    expect(newer!.counts.traffic.value!.visits.value!.daily).toHaveLength(1);
    expect(newer!.counts.traffic.value!.sites).toHaveLength(1);
    expect(bare!.counts.traffic.value!.visits).toEqual({ value: null, reason: "not in this row" });
    expect(bare!.counts.traffic.value!.search).toEqual({ value: null, reason: "not in this row" });
    // Review round 3, Group A: no `previous` count, so the half is not in the row.
    expect(partial!.counts.traffic.value!.visits).toEqual({
      value: null,
      reason: "not in this row",
    });
    expect(partial!.counts.traffic.value!.search).toEqual({
      value: null,
      reason: "not in this row",
    });
  });

  it("a failed newest traffic night keeps the series of the night before that holds one", async () => {
    const failed = { value: null, reason: "GA not configured" };
    await put("2026-11-16", { traffic: failed });
    await put("2026-11-15", { traffic: { value: block(7) } });
    await put("2026-11-14", { traffic: { value: block(5) } });
    const [newer, before, twoBack] = await readOverviewNights(db);
    expect(newer!.counts.traffic).toEqual(failed);
    const bt = before!.counts.traffic.value!;
    expect(bt.visits.value!.daily).toHaveLength(1);
    expect(bt.search.value!.daily).toHaveLength(1);
    expect(bt.sites).toHaveLength(1);
    const tt = twoBack!.counts.traffic.value!;
    expect(tt).not.toHaveProperty("sites");
    expect(tt.visits.value).not.toHaveProperty("daily");
    expect(tt.search.value).not.toHaveProperty("daily");
  });
});

// Review round 3, Group A: each half is normalised on its own, and each half's series sits on
// the newest night that read that half. A row is never taken whole, so a failed newest night
// (or a malformed one) cannot blank a series an older night still holds.
describe("readOverviewNights normalises each half, and places each series on the night that read it", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "overview-halves-"));
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
  const NOT_IN_ROW = { value: null, reason: "not in this row" };
  const window = { startDate: "2026-10-18", endDate: "2026-11-16" };
  const block = (n: number) => ({
    visits: {
      value: {
        current: n,
        previous: n - 1,
        currentWindow: window,
        previousWindow: window,
        sitesRead: 2,
        sitesWithProperty: 2,
        daily: [{ date: "2026-11-16", visits: n }],
      },
    },
    search: {
      value: {
        clicks: n,
        impressions: n * 10,
        window,
        sitesRead: 1,
        sitesWithProperty: 1,
        daily: [{ date: "2026-11-14", clicks: n, impressions: n * 10 }],
      },
    },
    sites: [{ siteId: "acme", visits: { value: { current: n, previous: 1 } } }],
  });
  const acme = {
    id: "acme",
    url: "https://acme.example/",
    ga4PropertyId: "100001",
    searchConsoleProperty: null,
  };

  // The writer's own failure shapes, built by the writer (not by hand).
  it("a newest row the writer stores with GA not configured keeps the night before's series", async () => {
    const unconfigured = await readTraffic([acme], "2026-11-16", null);
    await put("2026-11-16", { traffic: { value: unconfigured } });
    await put("2026-11-15", { traffic: { value: block(7) } });
    const [newer, before] = await readOverviewNights(db);
    const nt = newer!.counts.traffic.value!;
    expect(nt.visits).toEqual(unconfigured.visits);
    expect(nt.search).toEqual(unconfigured.search);
    expect(nt).not.toHaveProperty("sites");
    const bt = before!.counts.traffic.value!;
    expect(bt.visits.value!.daily).toHaveLength(1);
    expect(bt.search.value!.daily).toHaveLength(1);
    expect(bt.sites).toHaveLength(1);
  });

  it("a newest row where every read threw keeps the night before's series", async () => {
    const failing = {
      visits: async () => {
        throw new Error("invalid_grant");
      },
      search: async () => {
        throw new Error("invalid_grant");
      },
    };
    const failed = await readTraffic([acme], "2026-11-16", failing);
    await put("2026-11-16", { traffic: { value: failed } });
    await put("2026-11-15", { traffic: { value: block(7) } });
    const [newer, before] = await readOverviewNights(db);
    const nt = newer!.counts.traffic.value!;
    expect(nt.visits).toEqual(failed.visits);
    expect(nt.search).toEqual(failed.search);
    expect(nt.visits.value).toBeNull();
    expect(nt.search.value).toBeNull();
    expect(before!.counts.traffic.value!.visits.value!.daily).toHaveLength(1);
    expect(before!.counts.traffic.value!.search.value!.daily).toHaveLength(1);
    expect(before!.counts.traffic.value!.sites).toHaveLength(1);
  });

  it("each half's series is on the newest night that read that half", async () => {
    const failedSearch = { value: null, reason: "search read failed" };
    // Review round 4, Group A (major 3): both rows carry sites, of different lengths.
    const twoSites = [
      { siteId: "acme", visits: { value: { current: 9, previous: 1 } } },
      { siteId: "beta", visits: { value: { current: 4, previous: 0 } } },
    ];
    await put("2026-11-16", {
      traffic: { value: { visits: block(9).visits, search: failedSearch, sites: twoSites } },
    });
    await put("2026-11-15", { traffic: { value: block(7) } });
    const [newer, before] = await readOverviewNights(db);
    const nt = newer!.counts.traffic.value!;
    expect(nt.visits.value!.daily).toHaveLength(1);
    expect(nt.search).toEqual(failedSearch);
    expect(nt.sites).toHaveLength(2);
    const bt = before!.counts.traffic.value!;
    expect(bt.visits.value).not.toHaveProperty("daily");
    expect(bt.search.value!.daily).toHaveLength(1);
    expect(bt).not.toHaveProperty("sites");
  });

  // Review round 4, Group A (major 3), the mirror: the newest night read search and failed visits,
  // so the sites are on it. The night before keeps the visits series, and loses the sites and search series.
  it("a newest night that read search and failed visits holds the sites, and the night before does not", async () => {
    const failedVisits = { value: null, reason: "GA not configured" };
    const newestSites = [
      { siteId: "acme", search: { value: { clicks: 3, impressions: 30 } } },
      { siteId: "beta", search: { value: { clicks: 1, impressions: 5 } } },
    ];
    await put("2026-11-16", {
      traffic: { value: { visits: failedVisits, search: block(9).search, sites: newestSites } },
    });
    await put("2026-11-15", { traffic: { value: block(7) } });
    const [newer, before] = await readOverviewNights(db);
    const nt = newer!.counts.traffic.value!;
    expect(nt.visits).toEqual(failedVisits);
    expect(nt.search.value!.daily).toHaveLength(1);
    expect(nt.sites).toHaveLength(2);
    const bt = before!.counts.traffic.value!;
    expect(bt.visits.value!.daily).toHaveLength(1);
    expect(bt.search.value).not.toHaveProperty("daily");
    expect(bt).not.toHaveProperty("sites");
  });

  // Malformed newest blocks: each reads as not in the row, and the night before keeps both
  // series. None of them throws the page.
  it.each([
    ["{}", {}],
    ["[]", []],
    ['"x"', "x"],
    ["5", 5],
    ["{visits: null}", { visits: null }],
    ['{visits: {value: "x"}}', { visits: { value: "x" } }],
  ])(
    "a newest block of %s reads as not in the row, and the night before keeps both series",
    async (_name, value) => {
      await put("2026-11-16", { traffic: { value } });
      await put("2026-11-15", { traffic: { value: block(7) } });
      const [newer, before] = await readOverviewNights(db);
      const t = newer!.counts.traffic;
      if (t.value === null) expect(t).toEqual(NOT_IN_ROW);
      else {
        expect(t.value.visits).toEqual(NOT_IN_ROW);
        expect(t.value.search).toEqual(NOT_IN_ROW);
      }
      const bt = before!.counts.traffic.value!;
      expect(bt.visits.value!.daily).toHaveLength(1);
      expect(bt.search.value!.daily).toHaveLength(1);
    },
  );

  // Review round 4, Group A (major 2): the search half's required counts and the visits half's
  // `current` are each checked. The half that lacks one is not in the row, and the night before
  // keeps both series.
  it.each([
    ["search {}", { search: { value: {} } }, "search"],
    ["search with only clicks", { search: { value: { clicks: 1 } } }, "search"],
    ["search with only impressions", { search: { value: { impressions: 1 } } }, "search"],
    ["visits with only previous", { visits: { value: { previous: 1 } } }, "visits"],
  ] as const)(
    "a newest row whose %s is not in the row, and the night before keeps both series",
    async (_name, halves, bad) => {
      await put("2026-11-16", { traffic: { value: halves } });
      await put("2026-11-15", { traffic: { value: block(7) } });
      const [newer, before] = await readOverviewNights(db);
      expect(newer!.counts.traffic.value![bad]).toEqual(NOT_IN_ROW);
      const bt = before!.counts.traffic.value!;
      expect(bt.visits.value!.daily).toHaveLength(1);
      expect(bt.search.value!.daily).toHaveLength(1);
    },
  );

  // A stored failed half keeps its reason, on the newest row and on an older one.
  it("an older row's failed visits half keeps its stored reason", async () => {
    await put("2026-11-16", { traffic: { value: block(9) } });
    await put("2026-11-15", {
      traffic: {
        value: { visits: { value: null, reason: "no site read" }, search: NOT_IN_ROW },
      },
    });
    const [, older] = await readOverviewNights(db);
    expect(older!.counts.traffic.value!.visits).toEqual({
      value: null,
      reason: "no site read",
    });
  });

  it("an older row's failed search half keeps its stored reason", async () => {
    await put("2026-11-16", { traffic: { value: block(9) } });
    await put("2026-11-15", {
      traffic: {
        value: {
          visits: NOT_IN_ROW,
          search: { value: null, reason: "no Search Console property" },
        },
      },
    });
    const [, older] = await readOverviewNights(db);
    expect(older!.counts.traffic.value!.search).toEqual({
      value: null,
      reason: "no Search Console property",
    });
  });

  it("a newest row's failed half keeps its stored reason", async () => {
    await put("2026-11-16", {
      traffic: {
        value: { visits: { value: null, reason: "GA not configured" }, search: NOT_IN_ROW },
      },
    });
    const [newer] = await readOverviewNights(db);
    expect(newer!.counts.traffic.value!.visits).toEqual({
      value: null,
      reason: "GA not configured",
    });
  });

  // The string value: spreading a string copied its characters as keys ("0", "1", ...).
  it("an older row whose block value is a string reads as not in the row, with no character keys", async () => {
    await put("2026-11-16", { traffic: { value: block(9) } });
    await put("2026-11-15", { traffic: { value: "x" } });
    const [, older] = await readOverviewNights(db);
    expect(older!.counts.traffic).toEqual(NOT_IN_ROW);
    expect(JSON.stringify(older!.counts.traffic)).not.toContain('"0"');
  });
});
