import { describe, it, expect } from "vitest";
import { openDb, type Db } from "../../src/db/client.js";
import {
  importFleetState,
  formatReapSummary,
  type RawRecord,
  type ImportIo,
} from "../../src/db/import-airtable.js";
import { checkFleetParity } from "../../src/db/parity.js";

/**
 * The importer is upsert-only, so until this landed a record DELETED in
 * Airtable stayed in Turso forever. Parity flags it (deliberately — a Turso row
 * Airtable no longer has is a real divergence), which meant one routine
 * operator deletion wedged the hourly `fleet-db-sync` red permanently with no
 * self-healing path. That is not hypothetical: two unsent Beachfront Dentistry
 * drafts deleted on 2026-08-25 redded 15 consecutive runs.
 *
 * Reaping is the only destructive thing this importer does, so its refusal
 * policy is tested as carefully as its happy path: a truncated or empty
 * Airtable read must never be able to empty Turso.
 */

const NOW = new Date("2026-08-25T12:00:00.000Z");

const site = (id: string, name: string): RawRecord => ({
  id,
  fields: { Name: name, Status: "maintained", url: `https://${name}.example.com` },
});

const report = (id: string, siteId: string): RawRecord => ({
  id,
  fields: { Site: [siteId], "Report ID": `${siteId}-${id}`, "Report type": "Maintenance" },
});

const io = (over: Partial<ImportIo> = {}): ImportIo => ({
  listWebsiteRecords: async () => [site("recS1", "Alpha")],
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
  ...over,
});

const ids = async (db: Db, table: "sites" | "reports"): Promise<string[]> =>
  (await db.selectFrom(table).select("id").execute()).map((r) => String(r.id)).sort();

const siteIds = async (db: Db, table: "site_health" | "site_schedule"): Promise<string[]> =>
  (await db.selectFrom(table).select("site_id").execute()).map((r) => String(r.site_id)).sort();

describe("importFleetState reaps rows Airtable no longer has", () => {
  it("removes a deleted report and leaves parity CLEAN in one pass", async () => {
    const db = await openDb({ url: ":memory:" });
    const sites = [site("recS1", "Alpha")];
    const both = [report("recR1", "recS1"), report("recR2", "recS1")];

    await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => both }),
    );
    expect(await ids(db, "reports")).toEqual(["recR1", "recR2"]);

    // The operator deletes recR2 in Airtable. One sync pass must converge.
    const after = io({
      listWebsiteRecords: async () => sites,
      listReportRecords: async () => [both[0]!],
    });
    await importFleetState(db, after);

    expect(await ids(db, "reports")).toEqual(["recR1"]);
    const parity = await checkFleetParity(db, after);
    expect(parity.mismatches).toEqual([]);
  });

  it("names every row it removed, so an irreversible pass is never silent", async () => {
    const db = await openDb({ url: ":memory:" });
    const sites = [site("recS1", "Alpha")];
    const both = [report("recR1", "recS1"), report("recR2", "recS1")];
    await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => both }),
    );

    const summary = await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => [both[0]!] }),
    );

    expect(summary.reaped.reports).toEqual(["recR2"]);
    expect(summary.reaped.sites).toEqual([]);
    expect(summary.reaped.refusals).toEqual([]);
  });

  it("removes a deleted site's health and schedule rows with it", async () => {
    const db = await openDb({ url: ":memory:" });
    const two = [site("recS1", "Alpha"), site("recS2", "Beta")];
    await importFleetState(db, io({ listWebsiteRecords: async () => two }));
    expect(await siteIds(db, "site_health")).toEqual(["recS1", "recS2"]);

    const after = io({ listWebsiteRecords: async () => [two[0]!] });
    const summary = await importFleetState(db, after);

    expect(await ids(db, "sites")).toEqual(["recS1"]);
    // Nothing cascades in SQLite here — no FKs are declared — so an unreaped
    // health/schedule row would linger forever, invisible to parity (which only
    // reverse-checks `sites`) and readable by every Phase 2 reader.
    expect(await siteIds(db, "site_health")).toEqual(["recS1"]);
    expect(await siteIds(db, "site_schedule")).toEqual(["recS1"]);
    expect(summary.reaped.sites).toEqual(["recS2"]);
    expect((await checkFleetParity(db, after)).mismatches).toEqual([]);
  });

  it("REFUSES to reap when Airtable returns nothing but rows are stored", async () => {
    // The catastrophic read: an empty list is never a legitimate description of
    // a fleet that has rows. Refuse the whole pass and let parity red the run.
    const db = await openDb({ url: ":memory:" });
    const sites = [site("recS1", "Alpha")];
    const three = ["recR1", "recR2", "recR3"].map((id) => report(id, "recS1"));
    await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => three }),
    );

    const summary = await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => [] }),
    );

    expect(await ids(db, "reports")).toEqual(["recR1", "recR2", "recR3"]);
    expect(summary.reaped.reports).toEqual([]);
    expect(summary.reaped.refusals.join(" ")).toContain("reports");
  });

  it("REFUSES a reap larger than the allowance (a truncated read, not 20 deletions)", async () => {
    const db = await openDb({ url: ":memory:" });
    const sites = [site("recS1", "Alpha")];
    const hundred = Array.from({ length: 100 }, (_, i) => report(`recR${i}`, "recS1"));
    await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => hundred }),
    );

    // 100 stored, 80 returned → 20 to reap, over the max(5, 10%) allowance.
    const summary = await importFleetState(
      db,
      io({
        listWebsiteRecords: async () => sites,
        listReportRecords: async () => hundred.slice(0, 80),
      }),
    );

    expect(await ids(db, "reports")).toHaveLength(100);
    expect(summary.reaped.reports).toEqual([]);
    expect(summary.reaped.refusals.join(" ")).toContain("20");
  });

  it("ALLOWS a reap at the allowance boundary (the guard is not a blanket refusal)", async () => {
    // The positive control for the two refusals above: without it they could
    // both be passing because reaping never happens at all.
    const db = await openDb({ url: ":memory:" });
    const sites = [site("recS1", "Alpha")];
    const hundred = Array.from({ length: 100 }, (_, i) => report(`recR${i}`, "recS1"));
    await importFleetState(
      db,
      io({ listWebsiteRecords: async () => sites, listReportRecords: async () => hundred }),
    );

    // 100 stored, 90 returned → exactly 10 = max(5, 10% of 100). Allowed.
    const summary = await importFleetState(
      db,
      io({
        listWebsiteRecords: async () => sites,
        listReportRecords: async () => hundred.slice(0, 90),
      }),
    );

    expect(summary.reaped.reports).toHaveLength(10);
    expect(summary.reaped.refusals).toEqual([]);
    expect(await ids(db, "reports")).toHaveLength(90);
  });
});

/** ONE formatter, shared by `db sync` and the one-shot `db import-airtable` —
 *  both can now delete, so both must report identically. A second hand-rolled
 *  copy is how one of them ends up deleting quietly. */
describe("formatReapSummary", () => {
  it("emits the FLEET_REAP line even when nothing was reaped", () => {
    expect(formatReapSummary({ sites: [], reports: [], refusals: [] })).toEqual([
      "FLEET_REAP sites=0 reports=0 refused=0",
    ]);
  });

  it("names each removed row above the machine line", () => {
    const lines = formatReapSummary({ sites: ["recS9"], reports: ["recR8"], refusals: [] });
    expect(lines[0]).toContain("recS9");
    expect(lines[1]).toContain("recR8");
    expect(lines.at(-1)).toBe("FLEET_REAP sites=1 reports=1 refused=0");
  });

  it("quotes a refusal in full, so the operator sees WHY nothing was deleted", () => {
    const lines = formatReapSummary({
      sites: [],
      reports: [],
      refusals: ["reports: REFUSED to reap — Airtable returned 0 rows while 18 are stored"],
    });
    expect(lines.join("\n")).toContain("Airtable returned 0 rows while 18 are stored");
    expect(lines.at(-1)).toBe("FLEET_REAP sites=0 reports=0 refused=1");
  });
});
