/**
 * #539 Phase 5: the Turso write-through for the one-off Websites writers — the
 * ones that were never part of the Phase 3 nightly sweep and so reached Turso
 * only via the hourly sync (analytics soft-fail, auto-fix attempts, prismic
 * models, launched, the forms notify target, the single-site audit write-back).
 *
 * Like `makeReportMirror` and unlike the Phase 3 factories, this NEVER returns
 * null. #585 is the reason: `makeHealthMirrorBestEffort` returned null without
 * creds, the dual-write silently no-opped for weeks, and a dead mirror was
 * indistinguishable from a healthy one. Here creds-absent is a state the mirror
 * reports, so a missing SITE_MIRROR line means the wiring itself is gone.
 *
 * `missed` is its own outcome, distinct from both success and failure: the
 * UPDATE matched no row because the hourly sync has not imported that site yet.
 * Counting it as `mirrored=1` would claim a write that never landed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import { makeSiteMirror } from "../../src/db/site-mirror.js";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const SITE: RawRecord = { id: "recSITE", fields: { Name: "Acme Gallery", Status: "launching" } };

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

const logged = (spy: ReturnType<typeof vi.spyOn>) =>
  (spy.mock.calls as unknown[][]).flat().join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSiteMirror (best-effort, always observable)", () => {
  it("site: writes sites columns and reports op=site mirrored=1", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await mirror.site("recSITE", { Status: "maintained", "Launched at": "2026-08-25" });

    const row = await db
      .selectFrom("sites")
      .select(["status", "launched_at"])
      .where("id", "=", "recSITE")
      .executeTakeFirst();
    expect(row).toMatchObject({ status: "maintained", launched_at: "2026-08-25" });
    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=site mirrored=1");
  });

  it("health: writes site_health columns and reports op=health mirrored=1", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await mirror.health("recSITE", { "Analytics soft-fail at": "2026-08-25T00:00:00.000Z" });

    const row = await db
      .selectFrom("site_health")
      .select("analytics_soft_fail_at")
      .where("site_id", "=", "recSITE")
      .executeTakeFirst();
    expect(row?.analytics_soft_fail_at).toBe("2026-08-25T00:00:00.000Z");
    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=health mirrored=1");
  });

  it("reports mirrored=missed for a site the sync has not imported yet", async () => {
    // Distinct from success on purpose: the write did not land, it just is not
    // an error either. Reporting it as mirrored=1 would claim otherwise.
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await mirror.site("recBRANDNEW", { Status: "maintained" });

    expect(logged(log)).toContain("SITE_MIRROR site=recBRANDNEW op=site mirrored=missed");
  });

  it("without libSQL creds every operation reports mirrored=absent instead of returning null", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => {
      throw new Error("no TURSO_DATABASE_URL");
    });
    await expect(mirror.site("recSITE", { Status: "maintained" })).resolves.toBeUndefined();
    await expect(mirror.health("recSITE", { "Smoke OK": "pass" })).resolves.toBeUndefined();

    const out = logged(log);
    expect(out).toContain("SITE_MIRROR site=recSITE op=site mirrored=absent");
    expect(out).toContain("SITE_MIRROR site=recSITE op=health mirrored=absent");
  });

  it("a write failure is reported as mirrored=0 and never breaks the caller", async () => {
    const db = {
      updateTable: () => {
        throw new Error("SQLITE_BUSY");
      },
    } as unknown as Awaited<ReturnType<typeof openDb>>;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recSITE", { Status: "maintained" })).resolves.toBeUndefined();

    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=site mirrored=0 error=SQLITE_BUSY");
  });

  it("an unmapped column is a failure, not a silent drop", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await mirror.site("recSITE", { "Not A Column": "x" });

    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=site mirrored=0");
    expect(logged(log)).toContain("Not A Column");
  });
});
