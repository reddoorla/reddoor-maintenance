import { describe, it, expect } from "vitest";
import {
  parseFleetTableQuery,
  buildFleetTableModel,
  FLEET_SORT_KEYS,
  NO_STATUS_FILTER,
} from "../../src/dashboard/fleet-table.js";
import type { FleetSortKey } from "../../src/dashboard/fleet-table.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/** The `Status` union is a CLAIM about the store, not a guard — fleet-state reads
 *  it as `str(r.status) as Status | null`, and websites.ts ships an
 *  `isUnrecognizedStatus` for the values that fall outside it. This page derives
 *  its filter vocabulary from the DATA for exactly that reason, so its tests must
 *  be able to store a value the union does not name. */
function storedStatus(raw: string): WebsiteRow["status"] {
  return raw as WebsiteRow["status"];
}

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
    // toBe, not toBeLessThanOrEqual: a cap that truncated to 5 would satisfy an
    // upper bound while silently eating the operator's search.
    expect(q.q).toHaveLength(200);
  });
  it("caps a hostile status at 64 chars exactly", () => {
    const q = parseFleetTableQuery(new URLSearchParams(`status=${"s".repeat(500)}`));
    expect(q.status).toHaveLength(64);
  });
  it("accepts every advertised sort key", () => {
    for (const key of FLEET_SORT_KEYS) {
      expect(parseFleetTableQuery(new URLSearchParams(`sort=${key}`)).sort).toBe(key);
    }
  });
  it("matches sort and dir case-insensitively (a hand-typed URL is not junk)", () => {
    const q = parseFleetTableQuery(new URLSearchParams("sort=NextMaintenance&dir=DESC"));
    expect(q.sort).toBe("nextMaintenance");
    expect(q.dir).toBe("desc");
  });
  it("takes the FIRST value when a param repeats", () => {
    const q = parseFleetTableQuery(new URLSearchParams("sort=perf&sort=name&q=one&q=two"));
    expect(q.sort).toBe("perf");
    expect(q.q).toBe("one");
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
  it("orders the filter options by the SAME collation the rows use (codepoint, not locale)", () => {
    // One page must not hold two collations. `localeCompare` would fold "é" to
    // "e" and list élan BEFORE zenith, while the rows — codepoint, like SQLite's
    // BINARY ORDER BY behind listSites — put it after. Non-ASCII is the only
    // input where the two disagree, so it is the only input that can pin this.
    const sites = [
      makeWebsiteRow({ id: "r1", name: "Alpha", status: storedStatus("élan") }),
      makeWebsiteRow({ id: "r2", name: "Bravo", status: storedStatus("zenith") }),
    ];
    const m = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(m.statuses).toEqual(["zenith", "élan"]);
    // …and the rows agree, which is the whole point.
    const bySt = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: "status" });
    expect(bySt.rows.map((r) => r.status)).toEqual(m.statuses);
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
  it("matches a spaced query against the NAME, which the slug can never contain", () => {
    // "acme co" is the natural thing to type, and the slug ("acme-co") does not
    // contain it — so only the name branch of the filter can answer this.
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, q: "acme co" });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co"]);
  });
  it("matches the status EXACTLY, never as a substring", () => {
    // "maintenance" is a prefix of "maintenance hold": a substring match would
    // quietly widen every status filter as the vocabulary grows.
    const overlapping = [
      makeWebsiteRow({ id: "r1", name: "Acme Co", status: "maintenance" }),
      makeWebsiteRow({ id: "r2", name: "Beachfront", status: storedStatus("maintenance hold") }),
    ];
    const m = buildFleetTableModel(overlapping, { ...DEFAULT_QUERY, status: "maintenance" });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co"]);
  });
  it("combines status and q filters", () => {
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, status: "maintenance", q: "cal" });
    expect(m.rows.map((r) => r.name)).toEqual(["CalTex"]);
  });
});

describe("buildFleetTableModel — the no-status filter", () => {
  const sites = [
    makeWebsiteRow({ id: "r1", name: "Acme Co", status: "maintenance" }),
    makeWebsiteRow({ id: "r2", name: "Beachfront", status: null }),
    makeWebsiteRow({ id: "r3", name: "CalTex", status: null }),
  ];
  it("returns exactly the null-status rows for the sentinel", () => {
    // "Which sites have no Status set?" is the hygiene question this page
    // replaces the Airtable grid for — sorting nulls-last and scrolling does not
    // survive the 200-site direction.
    const m = buildFleetTableModel(sites, { ...DEFAULT_QUERY, status: NO_STATUS_FILTER });
    expect(m.rows.map((r) => r.name)).toEqual(["Beachfront", "CalTex"]);
    expect(m.totalSites).toBe(3);
  });
  it("combines with q like any other status filter", () => {
    const m = buildFleetTableModel(sites, {
      ...DEFAULT_QUERY,
      status: NO_STATUS_FILTER,
      q: "cal",
    });
    expect(m.rows.map((r) => r.name)).toEqual(["CalTex"]);
  });
  it("round-trips through the query parser untouched", () => {
    const q = parseFleetTableQuery(new URLSearchParams(`status=${NO_STATUS_FILTER}`));
    expect(q.status).toBe(NO_STATUS_FILTER);
  });
  it("never appears as a fleet status, so the dropdown lists it separately", () => {
    const m = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(m.statuses).toEqual(["maintenance"]);
  });
  it("does NOT swallow a site whose stored status is literally the sentinel — data wins", () => {
    // Status is free text upstream, so the sentinel COULD collide. When it does,
    // the stored value owns the query param: a real row must never become
    // unreachable because of a UI affordance. Null-status rows keep their
    // default-view and sort-order reachability, which is the pre-sentinel state.
    const colliding = [
      makeWebsiteRow({ id: "r1", name: "Acme Co", status: storedStatus(NO_STATUS_FILTER) }),
      makeWebsiteRow({ id: "r2", name: "Beachfront", status: null }),
    ];
    const m = buildFleetTableModel(colliding, { ...DEFAULT_QUERY, status: NO_STATUS_FILTER });
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co"]);
    expect(m.statuses).toEqual([NO_STATUS_FILTER]);
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
  it("sorts null STRING and DATE values last in DESC too, not just null numbers", () => {
    // A comparator with NO null handling already lands numeric nulls last under
    // desc (null coerces to 0), so the pScore case cannot discriminate. String
    // and date nulls fall through to the name tiebreak instead — only they can
    // catch a null branch that is direction-sensitive.
    //
    // FIVE rows with TWO nulls, not three-with-one: a single-branch flip makes
    // the comparator asymmetric, and V8's binary-insertion path for tiny arrays
    // asks the surviving branch first, hiding the flip entirely. Measured: this
    // shape surfaces it from 108 of the 120 input orders, the natural one
    // included; the three-row shape surfaced it from none.
    const byStatus = [
      makeWebsiteRow({ id: "r1", name: "Alpha", status: null }),
      makeWebsiteRow({ id: "r2", name: "Bravo", status: "legacy" }),
      makeWebsiteRow({ id: "r3", name: "Charlie", status: "maintenance" }),
      makeWebsiteRow({ id: "r4", name: "Delta", status: null }),
      makeWebsiteRow({ id: "r5", name: "Echo", status: storedStatus("archived") }),
    ];
    const st = buildFleetTableModel(byStatus, {
      ...DEFAULT_QUERY,
      sort: "status",
      dir: "desc",
    });
    expect(st.rows.map((r) => r.name)).toEqual(["Charlie", "Bravo", "Echo", "Alpha", "Delta"]);

    const byDate = [
      makeWebsiteRow({ id: "r1", name: "Alpha", nextMaintenanceAt: null }),
      makeWebsiteRow({ id: "r2", name: "Bravo", nextMaintenanceAt: "2026-08-30" }),
      makeWebsiteRow({ id: "r3", name: "Charlie", nextMaintenanceAt: "2026-09-15" }),
      makeWebsiteRow({ id: "r4", name: "Delta", nextMaintenanceAt: null }),
      makeWebsiteRow({ id: "r5", name: "Echo", nextMaintenanceAt: "2026-07-01" }),
    ];
    const dt = buildFleetTableModel(byDate, {
      ...DEFAULT_QUERY,
      sort: "nextMaintenance",
      dir: "desc",
    });
    expect(dt.rows.map((r) => r.name)).toEqual(["Charlie", "Bravo", "Echo", "Alpha", "Delta"]);
  });
  it("breaks a same-name tie on id so equal names never shuffle between requests", () => {
    // Same lowercased name, listed id-descending: only the id tiebreak can
    // reorder them (a `return 0` leaves V8's stable sort holding input order).
    const sites = [
      makeWebsiteRow({ id: "r2", name: "acme co" }),
      makeWebsiteRow({ id: "r1", name: "Acme Co" }),
    ];
    const m = buildFleetTableModel(sites, DEFAULT_QUERY);
    expect(m.rows.map((r) => r.name)).toEqual(["Acme Co", "acme co"]);
  });
});

describe("buildFleetTableModel — every advertised sort key actually sorts", () => {
  // Four sites whose ten column orderings are ten DISTINCT permutations, so a
  // sort key reading the WRONG field (Access reading Performance, "next test"
  // reading next-maintenance) reorders the rows visibly. Pinning the parser's
  // key list — which `accepts every advertised sort key` does — cannot see that.
  const sites = [
    makeWebsiteRow({
      id: "r1",
      name: "Alpha",
      url: "https://2.example.com",
      status: "legacy",
      pScore: 40,
      rScore: 10,
      bpScore: 30,
      seoScore: 20,
      nextMaintenanceAt: "2026-02-01",
      nextTestingAt: "2026-03-02",
      lastLighthouseAuditAt: "2026-01-03T00:00:00Z",
    }),
    makeWebsiteRow({
      id: "r2",
      name: "Bravo",
      url: "https://1.example.com",
      status: "maintenance",
      pScore: 30,
      rScore: 40,
      bpScore: 10,
      seoScore: 30,
      nextMaintenanceAt: "2026-04-01",
      nextTestingAt: "2026-01-02",
      lastLighthouseAuditAt: "2026-03-03T00:00:00Z",
    }),
    makeWebsiteRow({
      id: "r3",
      name: "Charlie",
      url: "https://4.example.com",
      status: storedStatus("archived"),
      pScore: 20,
      rScore: 30,
      bpScore: 20,
      seoScore: 10,
      nextMaintenanceAt: "2026-03-01",
      nextTestingAt: "2026-04-02",
      lastLighthouseAuditAt: "2026-02-03T00:00:00Z",
    }),
    makeWebsiteRow({
      id: "r4",
      name: "Delta",
      url: "https://3.example.com",
      status: "deprecated",
      pScore: 10,
      rScore: 20,
      bpScore: 40,
      seoScore: 40,
      nextMaintenanceAt: "2026-01-01",
      nextTestingAt: "2026-02-02",
      lastLighthouseAuditAt: "2026-04-03T00:00:00Z",
    }),
  ];
  const EXPECTED_ASC: Record<FleetSortKey, string[]> = {
    name: ["Alpha", "Bravo", "Charlie", "Delta"],
    url: ["Bravo", "Alpha", "Delta", "Charlie"],
    status: ["Charlie", "Delta", "Alpha", "Bravo"],
    perf: ["Delta", "Charlie", "Bravo", "Alpha"],
    a11y: ["Alpha", "Delta", "Charlie", "Bravo"],
    bp: ["Bravo", "Charlie", "Alpha", "Delta"],
    seo: ["Charlie", "Alpha", "Bravo", "Delta"],
    nextMaintenance: ["Delta", "Alpha", "Charlie", "Bravo"],
    nextTesting: ["Bravo", "Delta", "Alpha", "Charlie"],
    lastAudit: ["Alpha", "Charlie", "Bravo", "Delta"],
  };
  for (const key of FLEET_SORT_KEYS) {
    it(`sorts on the ${key} column in both directions`, () => {
      const asc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: key });
      expect(asc.rows.map((r) => r.name)).toEqual(EXPECTED_ASC[key]);
      const desc = buildFleetTableModel(sites, { ...DEFAULT_QUERY, sort: key, dir: "desc" });
      // No nulls and no ties in this fixture, so desc is the exact reverse.
      expect(desc.rows.map((r) => r.name)).toEqual([...EXPECTED_ASC[key]].reverse());
    });
  }
});
