import { describe, it, expect } from "vitest";
import {
  parseFleetTableQuery,
  buildFleetTableModel,
  FLEET_SORT_KEYS,
} from "../../src/dashboard/fleet-table.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

describe("parseFleetTableQuery", () => {
  it("parses valid sort/dir/status/q", () => {
    const q = parseFleetTableQuery(
      new URLSearchParams("sort=perf&dir=desc&status=maintenance&q=acme"),
    );
    expect(q.sort).toBe("perf");
    expect(q.dir).toBe("desc");
    expect(q.status).toBe("maintenance");
    expect(q.q).toBe("acme");
  });
  it("falls back to name/asc on junk sort/dir instead of throwing", () => {
    const q = parseFleetTableQuery(new URLSearchParams("sort=bogus&dir=sideways"));
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
  });
  it("defaults to name/asc with empty filters on an empty query string", () => {
    const q = parseFleetTableQuery(new URLSearchParams());
    expect(q).toEqual({ sort: "name", dir: "asc", status: "", q: "" });
  });
  it("trims status and q and bounds hostile lengths", () => {
    const q = parseFleetTableQuery(
      new URLSearchParams(`status=  maintenance  &q=${"x".repeat(500)}`),
    );
    expect(q.status).toBe("maintenance");
    expect(q.q.length).toBeLessThanOrEqual(200);
  });
  it("accepts every advertised sort key", () => {
    for (const key of FLEET_SORT_KEYS) {
      expect(parseFleetTableQuery(new URLSearchParams(`sort=${key}`)).sort).toBe(key);
    }
  });
});

const DEFAULT_QUERY = { sort: "name", dir: "asc", status: "", q: "" } as const;

describe("buildFleetTableModel — inclusion", () => {
  it("includes EVERY site — maintenance, legacy, deprecated, and null-status rows", () => {
    // This table replaces eyeballing the Airtable grid: nothing may be
    // status-filtered out by default, unlike the cockpit's isDashboardVisible.
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Alpha", status: "maintenance" }),
      makeWebsiteRow({ id: "r2", name: "Bravo", status: "legacy" }),
      makeWebsiteRow({ id: "r3", name: "Charlie", status: "deprecated" }),
      makeWebsiteRow({ id: "r4", name: "Delta", status: null }),
      makeWebsiteRow({ id: "r5", name: "Echo", status: "in development" }),
    ];
    const m = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(m.rows).toHaveLength(5);
    expect(m.totalSites).toBe(5);
    expect(m.rows.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    // Status is carried RAW — a null stays null (renderer decides the dash).
    expect(m.rows.find((r) => r.name === "Delta")?.status).toBeNull();
    expect(m.rows.find((r) => r.name === "Bravo")?.status).toBe("legacy");
  });
  it("lists distinct raw statuses present in the fleet, a-z, for the filter select", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", status: "maintenance" }),
      makeWebsiteRow({ id: "r2", status: "legacy" }),
      makeWebsiteRow({ id: "r3", status: "maintenance" }),
      makeWebsiteRow({ id: "r4", status: null }),
    ];
    const m = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(m.statuses).toEqual(["legacy", "maintenance"]);
  });
  it("derives the slug the site-detail page expects", () => {
    const m = buildFleetTableModel(
      [makeWebsiteRow({ id: "r1", name: "ERP Industrials" })],
      DEFAULT_QUERY,
    );
    expect(m.rows[0]!.slug).toBe("erp-industrials");
  });
});

describe("buildFleetTableModel — filtering", () => {
  const sites = [
    makeWebsiteRow({ id: "r1", name: "Acme Co", status: "maintenance" }),
    makeWebsiteRow({ id: "r2", name: "Beachfront", status: "legacy" }),
    makeWebsiteRow({ id: "r3", name: "CalTex", status: "maintenance" }),
    makeWebsiteRow({ id: "r4", name: "Untracked", status: null }),
  ];
  it("filters by exact raw status", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, status: "maintenance" });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co", "CalTex"]);
    expect(m.totalSites).toBe(4); // pre-filter fleet size still reported
  });
  it("a status matching no site yields zero rows, not the whole fleet", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, status: "no-such-status" });
    expect(m.rows).toHaveLength(0);
  });
  it("filters by case-insensitive name substring", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, q: "acme" });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co"]);
  });
  it("matches the slug too (operator may type the hyphenated form)", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, q: "acme-co" });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co"]);
  });
  it("combines status and q filters", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, status: "maintenance", q: "cal" });
    expect(m.rows.map((r) => r.name)).toEqual(["CalTex"]);
  });
});

describe("buildFleetTableModel — sorting", () => {
  it("sorts by name case-insensitively, both directions", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", name: "beta" }),
      makeWebsiteRow({ id: "r2", name: "Alpha" }),
      makeWebsiteRow({ id: "r3", name: "Gamma" }),
    ];
    const asc = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(asc.rows.map((r) => r.name)).toEqual(["Alpha", "beta", "Gamma"]);
    const desc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, dir: "desc" });
    expect(desc.rows.map((r) => r.name)).toEqual(["Gamma", "beta", "Alpha"]);
  });
  it("sorts numerically by a lighthouse score with a stable name tiebreak in BOTH directions", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Bravo", pScore: 90 }),
      makeWebsiteRow({ id: "r2", name: "Alpha", pScore: 90 }),
      makeWebsiteRow({ id: "r3", name: "Charlie", pScore: 55 }),
    ];
    const asc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "perf" });
    expect(asc.rows.map((r) => r.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
    const desc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "perf", dir: "desc" });
    // Equal-score group keeps the SAME name-asc order under desc — the tiebreak
    // is stable, not inverted with the primary key.
    expect(desc.rows.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
  it("sorts null values LAST in both directions (an unaudited site never tops the list)", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Alpha", pScore: null }),
      makeWebsiteRow({ id: "r2", name: "Bravo", pScore: 40 }),
      makeWebsiteRow({ id: "r3", name: "Charlie", pScore: 99 }),
    ];
    const asc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "perf" });
    expect(asc.rows.map((r) => r.name)).toEqual(["Bravo", "Charlie", "Alpha"]);
    const desc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "perf", dir: "desc" });
    expect(desc.rows.map((r) => r.name)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });
  it("sorts by next-maintenance date (ISO strings compare lexicographically)", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Alpha", nextMaintenanceAt: "2026-09-15" }),
      makeWebsiteRow({ id: "r2", name: "Bravo", nextMaintenanceAt: "2026-08-30" }),
      makeWebsiteRow({ id: "r3", name: "Charlie", nextMaintenanceAt: null }),
    ];
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "nextMaintenance" });
    expect(m.rows.map((r) => r.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });
  it("sorts by raw status alphabetically, null-status rows last", () => {
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Alpha", status: "maintenance" }),
      makeWebsiteRow({ id: "r2", name: "Bravo", status: null }),
      makeWebsiteRow({ id: "r3", name: "Charlie", status: "legacy" }),
    ];
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "status" });
    expect(m.rows.map((r) => r.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });
});
