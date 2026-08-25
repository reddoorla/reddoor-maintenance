import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { syncFleetState, formatSyncResult } from "../../src/db/sync.js";
import { importFleetState } from "../../src/db/import-airtable.js";
import type { ImportIo, RawRecord } from "../../src/db/import-airtable.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const site = (status: string): RawRecord => ({
  id: "recACME",
  fields: { Name: "Acme Gallery", Status: status, url: "https://acme.example.com" },
});

const rep = (id: string): RawRecord => ({
  id,
  fields: { Site: ["recACME"], "Report ID": `ACME-${id}`, "Report type": "Maintenance" },
});

const io = (over: Partial<ImportIo> = {}): ImportIo => ({
  listWebsiteRecords: async () => [site("maintenance")],
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
  ...over,
});

/** IO whose Websites read returns a SEQUENCE — one entry per call, last entry
 *  repeated. Models Airtable changing between the import's read and the parity
 *  check's read (the race the retry exists for). */
const sequencedIo = (statuses: string[]): { io: ImportIo; calls: () => number } => {
  let call = 0;
  return {
    io: io({
      listWebsiteRecords: async () => {
        const status = statuses[Math.min(call, statuses.length - 1)];
        call++;
        return [site(status ?? "maintenance")];
      },
    }),
    calls: () => call,
  };
};

describe("syncFleetState", () => {
  // PROVE THE INSTRUMENT FIRST: a quiet Airtable syncs green with no retry.
  it("clean pass: imports, parity green, no retry", async () => {
    const db = await openDb({ url: ":memory:" });
    const r = await syncFleetState(db, io());
    expect(r.retried).toBe(false);
    expect(r.parity.mismatches).toEqual([]);
    expect(r.importSummary.sites).toBe(1);
    expect(formatSyncResult(r)).toBe(
      "FLEET_REAP sites=0 reports=0 refused=0\n" +
        "FLEET_SYNC sites=1 reports=0 html_fetched=0 html_skipped=0 retried=0 mismatches=0",
    );
  });

  it("a write landing between the import read and the parity read converges via ONE retry", async () => {
    const db = await openDb({ url: ":memory:" });
    // call 1 (import) sees maintenance; call 2 (parity) sees legacy → mismatch;
    // calls 3+ (re-import, re-parity) both see legacy → green.
    const { io: seq, calls } = sequencedIo(["maintenance", "legacy", "legacy"]);
    const r = await syncFleetState(db, seq);
    expect(r.retried).toBe(true);
    expect(r.parity.mismatches).toEqual([]);
    expect(calls()).toBe(4);
    // The retry actually wrote the newer state, not just re-checked it.
    const row = await db.selectFrom("sites").select("status").executeTakeFirst();
    expect(row?.status).toBe("legacy");
    expect(formatSyncResult(r)).toContain("retried=1 mismatches=0");
  });

  it("a PERSISTENT mismatch survives the retry and is reported, never absorbed", async () => {
    const db = await openDb({ url: ":memory:" });
    // Alternates on every read: import can never agree with the parity check.
    const { io: seq } = sequencedIo(["maintenance", "legacy", "maintenance", "legacy"]);
    const r = await syncFleetState(db, seq);
    expect(r.retried).toBe(true);
    expect(r.parity.mismatches.length).toBeGreaterThan(0);
    const out = formatSyncResult(r);
    expect(out).toContain("retried=1 mismatches=1");
    // The mismatch is NAMED (parity's ✗ lines ride along), not just counted.
    expect(out).toContain("✗ sites recACME status");
  });

  it("emits the FLEET_SYNC machine line on every run — clean included", async () => {
    const db = await openDb({ url: ":memory:" });
    const out = formatSyncResult(await syncFleetState(db, io()));
    expect(out).toMatch(
      /^FLEET_SYNC sites=\d+ reports=\d+ html_fetched=\d+ html_skipped=\d+ retried=[01] mismatches=\d+$/m,
    );
  });

  it("emits the FLEET_REAP machine line on every run — nothing-reaped included", async () => {
    // Same contract as FLEET_PARITY: an absent line must mean "the reap never
    // ran", never "it ran and removed nothing".
    const db = await openDb({ url: ":memory:" });
    const out = formatSyncResult(await syncFleetState(db, io()));
    expect(out).toMatch(/^FLEET_REAP sites=0 reports=0 refused=0$/m);
  });

  it("NAMES each reaped row — a destructive pass is never a bare count", async () => {
    const db = await openDb({ url: ":memory:" });
    const both = [rep("recR1"), rep("recR2")];
    await importFleetState(db, io({ listReportRecords: async () => both }));

    const out = formatSyncResult(
      await syncFleetState(db, io({ listReportRecords: async () => [both[0]!] })),
    );

    expect(out).toContain("reaped reports recR2");
    expect(out).toContain("FLEET_REAP sites=0 reports=1 refused=0");
  });

  it("reports a REFUSED reap loudly, and the run stays red", async () => {
    const db = await openDb({ url: ":memory:" });
    const three = ["recR1", "recR2", "recR3"].map(rep);
    await importFleetState(db, io({ listReportRecords: async () => three }));

    // Airtable returns nothing: the reap is refused, so the three rows survive
    // and parity keeps reporting them — red, but recoverable.
    const r = await syncFleetState(db, io({ listReportRecords: async () => [] }));
    const out = formatSyncResult(r);

    expect(out).toContain("REFUSED to reap");
    expect(out).toContain("FLEET_REAP sites=0 reports=0 refused=1");
    expect(r.parity.mismatches).toHaveLength(3);
    expect(out).toContain("mismatches=3");
  });
});
