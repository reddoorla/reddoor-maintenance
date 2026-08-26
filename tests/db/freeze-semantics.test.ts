/**
 * #612: the mirrors' error semantics are backwards for a frozen world, and
 * stopping the hourly import is what makes that fatal.
 *
 * Today, correctly: Airtable is authoritative, so an Airtable write throws and
 * surfaces while a Turso mirror failure is caught, logged and swallowed — the
 * hourly import converges whatever it missed. Once the import stops, nothing
 * converges anything, and that same swallowed failure is permanent data loss
 * announced only by a log line nobody greps.
 *
 * So the freeze inverts which store is allowed to fail. This suite pins BOTH
 * sides of the switch by injecting `strict` as a fixture, and keeps exactly ONE
 * assertion on the shipped constant — the lesson from a prior migration, where a
 * suite that only ever read the shipped value tested a single state and proved
 * nothing about the other.
 *
 * Three outcomes change meaning at the flip:
 *   mirrored=0      "the sync will fix it"        → "that write is gone"
 *   mirrored=missed "the site isn't imported yet" → impossible, therefore a bug
 *   mirrored=absent "no creds, Airtable has it"   → "every write was discarded"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import { makeSiteMirror } from "../../src/db/site-mirror.js";
import { makeReportMirror } from "../../src/reports/report-mirror.js";
import { TURSO_IS_AUTHORITATIVE } from "../../src/db/freeze.js";
import {
  makeHealthMirrorBestEffort,
  makeScheduleMirrorBestEffort,
} from "../../src/audits/health-mirror.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const SITE: RawRecord = { id: "recSITE", fields: { Name: "Acme Gallery", Status: "maintained" } };

const io = (records: RawRecord[]): ImportIo => ({
  listWebsiteRecords: async () => records,
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
});

async function dbWithSite() {
  const db = await openDb({ url: ":memory:" });
  await importFleetState(db, io([SITE]));
  return db;
}

/** A handle whose every write throws — the "Turso is down" fixture. */
const brokenDb = () => {
  const boom = () => {
    throw new Error("SQLITE_BUSY");
  };
  return { insertInto: boom, updateTable: boom } as unknown as Awaited<ReturnType<typeof openDb>>;
};

const noCreds = async () => {
  throw new Error("TURSO_DATABASE_URL not set");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the shipped switch", () => {
  it("is OFF — Airtable is still authoritative until the freeze flips it", () => {
    // The ONE assertion on the shipped value. Flipping this constant IS the
    // freeze; every behavioural assertion below injects `strict` instead, so
    // both sides stay proven whichever way the constant currently points.
    expect(TURSO_IS_AUTHORITATIVE).toBe(false);
  });
});

describe("makeSiteMirror — pre-freeze (strict=false), the shipped behaviour", () => {
  it("swallows a write failure and reports mirrored=0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(async () => brokenDb(), false);
    await expect(mirror.site("recSITE", { Status: "maintained" })).resolves.toBeUndefined();
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=0");
  });

  it("tolerates a site the sync has not imported yet (mirrored=missed)", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(async () => db, false);
    await expect(mirror.site("recNEW", { Status: "maintained" })).resolves.toBeUndefined();
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=missed");
  });

  it("builds without libSQL creds and reports mirrored=absent per write", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(noCreds, false);
    await expect(mirror.site("recSITE", { Status: "maintained" })).resolves.toBeUndefined();
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=absent");
  });
});

describe("makeSiteMirror — frozen (strict=true), where Turso is the only store", () => {
  it("a write failure REJECTS instead of being swallowed", async () => {
    // Post-freeze there is no hourly import to converge it: swallowing here
    // discards the write for good.
    const mirror = await makeSiteMirror(async () => brokenDb(), true);
    await expect(mirror.site("recSITE", { Status: "maintained" })).rejects.toThrow(/SQLITE_BUSY/);
  });

  it("a 0-row update REJECTS — `missed` is impossible once nothing imports", async () => {
    // Pre-freeze this means "the sync has not imported that site yet", which is
    // a legitimate transient. Post-freeze no importer exists, so a row that is
    // absent will stay absent: it is a bug, not a wait.
    const db = await dbWithSite();
    const mirror = await makeSiteMirror(async () => db, true);
    await expect(mirror.site("recNEW", { Status: "maintained" })).rejects.toThrow(/recNEW/);
  });

  it("REFUSES TO BUILD without libSQL creds, rather than discarding every write", async () => {
    // Fail at construction, not per write. A caller that got a working-looking
    // mirror would run its whole batch before anyone noticed nothing persisted.
    await expect(makeSiteMirror(noCreds, true)).rejects.toThrow(/TURSO_DATABASE_URL/);
  });

  it("still succeeds on the happy path", async () => {
    // The positive control. Without it, every assertion above would pass on a
    // mirror that simply threw at all times.
    const db = await dbWithSite();
    const mirror = await makeSiteMirror(async () => db, true);
    await expect(mirror.site("recSITE", { Status: "archived" })).resolves.toBeUndefined();
    const row = await db
      .selectFrom("sites")
      .select("status")
      .where("id", "=", "recSITE")
      .executeTakeFirst();
    expect(row?.status).toBe("archived");
  });
});

describe("makeReportMirror — the same inversion", () => {
  it("pre-freeze: swallows a write failure", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeReportMirror(async () => brokenDb(), false);
    await expect(mirror.created({ id: "recR", fields: {} })).resolves.toBeUndefined();
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=0");
  });

  it("frozen: a write failure REJECTS", async () => {
    const mirror = await makeReportMirror(async () => brokenDb(), true);
    await expect(mirror.created({ id: "recR", fields: {} })).rejects.toThrow(/SQLITE_BUSY/);
  });

  it("frozen: REFUSES TO BUILD without creds", async () => {
    await expect(makeReportMirror(noCreds, true)).rejects.toThrow(/TURSO_DATABASE_URL/);
  });

  it("frozen: still succeeds on the happy path", async () => {
    const db = await openDb({ url: ":memory:" });
    const mirror = await makeReportMirror(async () => db, true);
    await expect(
      mirror.created({ id: "recR", fields: { "Report ID": "r1" } }),
    ).resolves.toBeUndefined();
    await expect(mirror.body("recR", "<p>x</p>")).resolves.toBeUndefined();
  });
});

/**
 * The two Phase 3 factories return NULL without creds — "mirroring not
 * attempted", which the caller reports separately from "mirroring failed". That
 * distinction is exactly right while the hourly import converges the gap, and
 * exactly wrong once it stops: a null mirror then discards every write in the
 * sweep with nothing to reconcile it.
 */
describe("the Phase 3 factories — null is survivable only until the freeze", () => {
  it("pre-freeze: returns null without creds, so the sweep proceeds unmirrored", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await makeHealthMirrorBestEffort(noCreds, false)).toBeNull();
    expect(await makeScheduleMirrorBestEffort(noCreds, false)).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it("frozen: throws instead of returning a null that would discard the sweep", async () => {
    await expect(makeHealthMirrorBestEffort(noCreds, true)).rejects.toThrow(/health-mirror/);
    await expect(makeScheduleMirrorBestEffort(noCreds, true)).rejects.toThrow(/schedule-mirror/);
  });

  it("frozen: still returns a working mirror when creds resolve (positive control)", async () => {
    const db = await dbWithSite();
    const mirror = await makeHealthMirrorBestEffort(async () => db, true);
    expect(mirror).not.toBeNull();
    expect(await mirror!("recSITE", { "Smoke OK": "pass" })).toBe(true);
  });
});
