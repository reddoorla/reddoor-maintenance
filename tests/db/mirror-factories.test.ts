/**
 * #612: Turso is the only store, so a mirror factory never swallows. A failed
 * write rejects, a 0-row update rejects (nothing imports a missing row), and an
 * unreachable store refuses to build a mirror at all rather than discarding
 * every write handed to it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { RawRecord } from "../../src/db/field-map.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { makeSiteMirror } from "../../src/db/site-mirror.js";
import { makeReportMirror } from "../../src/reports/report-mirror.js";
import { makeHealthMirror, makeScheduleMirror } from "../../src/audits/health-mirror.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const SITE: RawRecord = { id: "recSITE", fields: { Name: "Acme Gallery", Status: "maintained" } };

async function dbWithSite() {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(db, SITE, NOW.toISOString());
  return db;
}

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

describe("makeSiteMirror", () => {
  it("a write failure REJECTS, after logging mirrored=0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(async () => brokenDb());
    await expect(mirror.site("recSITE", { Status: "maintained" })).rejects.toThrow(/SQLITE_BUSY/);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=0");
  });

  it("a 0-row update REJECTS, after logging mirrored=missed", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recNEW", { Status: "maintained" })).rejects.toThrow(/recNEW/);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=missed");
  });

  it("REFUSES TO BUILD without libSQL creds, rather than discarding every write", async () => {
    await expect(makeSiteMirror(noCreds)).rejects.toThrow(
      /SITE_MIRROR unavailable.*TURSO_DATABASE_URL/,
    );
  });

  it("still succeeds on the happy path", async () => {
    const db = await dbWithSite();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recSITE", { Status: "archived" })).resolves.toBeUndefined();
    const row = await db
      .selectFrom("sites")
      .select("status")
      .where("id", "=", "recSITE")
      .executeTakeFirst();
    expect(row?.status).toBe("archived");
  });
});

describe("makeReportMirror", () => {
  it("a write failure REJECTS, after logging mirrored=0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeReportMirror(async () => brokenDb());
    await expect(mirror.body("recR", "<p>x</p>")).rejects.toThrow(/SQLITE_BUSY/);
    expect((log.mock.calls as unknown[][]).flat().join("\n")).toContain("mirrored=0");
  });

  it("REFUSES TO BUILD without creds", async () => {
    await expect(makeReportMirror(noCreds)).rejects.toThrow(
      /REPORT_MIRROR unavailable.*TURSO_DATABASE_URL/,
    );
  });

  it("still succeeds on the happy path", async () => {
    const db = await openDb({ url: ":memory:" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeReportMirror(async () => db);
    await expect(
      mirror.create({ id: "recR", fields: { "Report ID": "r1" } }),
    ).resolves.toMatchObject({ id: "recR" });
    await expect(mirror.body("recR", "<p>x</p>")).resolves.toBeUndefined();
  });
});

describe("makeHealthMirror / makeScheduleMirror", () => {
  it("throw without creds instead of handing back a mirror that would discard the sweep", async () => {
    await expect(makeHealthMirror(noCreds)).rejects.toThrow(/health-mirror unavailable/);
    await expect(makeScheduleMirror(noCreds)).rejects.toThrow(/schedule-mirror unavailable/);
  });

  it("return a working mirror when creds resolve", async () => {
    const db = await dbWithSite();
    const health = await makeHealthMirror(async () => db);
    const schedule = await makeScheduleMirror(async () => db);
    expect(await health("recSITE", { "Smoke OK": "pass" })).toBe(true);
    expect(await schedule("recSITE", { "Next testing at": "2026-12-01" }, NOW.toISOString())).toBe(
      true,
    );
    expect(await schedule("recNEW", { "Next testing at": "2026-12-01" }, NOW.toISOString())).toBe(
      false,
    );
  });
});
