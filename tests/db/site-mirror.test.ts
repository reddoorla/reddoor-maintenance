/**
 * #539 Phase 5: the Turso write-through for the one-off Websites writers — the
 * ones that were never part of the Phase 3 nightly sweep and so reached Turso
 * only via the hourly sync (analytics soft-fail, auto-fix attempts, prismic
 * models, launched, the forms notify target, the single-site audit write-back).
 *
 * This NEVER returns null. #585 is the reason: the health mirror factory once
 * returned null without creds, the dual-write silently no-opped for weeks, and
 * a dead mirror was indistinguishable from a healthy one. Here an unreachable
 * store refuses to build, and every write logs one SITE_MIRROR line before it
 * succeeds or throws.
 *
 * `missed` is its own outcome, distinct from both success and failure: the
 * UPDATE matched no row. Counting it as `mirrored=1` would claim a write that
 * never landed, and nothing imports the row later, so it also throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { RawRecord } from "../../src/db/field-map.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { makeSiteMirror } from "../../src/db/site-mirror.js";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const SITE: RawRecord = { id: "recSITE", fields: { Name: "Acme Gallery", Status: "launching" } };

async function dbWithSite() {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(db, SITE, NOW.toISOString());
  return db;
}

const logged = (spy: ReturnType<typeof vi.spyOn>) =>
  (spy.mock.calls as unknown[][]).flat().join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSiteMirror (always observable, never swallows)", () => {
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

  it("reports mirrored=missed for a site Turso does not hold, and throws", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recBRANDNEW", { Status: "maintained" })).rejects.toThrow(
      /SITE_MIRROR site=recBRANDNEW op=site: no such row in Turso/,
    );

    expect(logged(log)).toContain("SITE_MIRROR site=recBRANDNEW op=site mirrored=missed");
  });

  it("without libSQL creds it refuses to build instead of returning null", async () => {
    await expect(
      makeSiteMirror(async () => {
        throw new Error("no TURSO_DATABASE_URL");
      }),
    ).rejects.toThrow(/SITE_MIRROR unavailable: no TURSO_DATABASE_URL/);
  });

  it("a write failure is reported as mirrored=0 and thrown to the caller", async () => {
    const db = {
      updateTable: () => {
        throw new Error("SQLITE_BUSY");
      },
    } as unknown as Awaited<ReturnType<typeof openDb>>;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recSITE", { Status: "maintained" })).rejects.toThrow(/SQLITE_BUSY/);

    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=site mirrored=0 error=SQLITE_BUSY");
  });

  it("an unmapped column is a failure, not a silent drop", async () => {
    const db = await dbWithSite();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeSiteMirror(async () => db);
    await expect(mirror.site("recSITE", { "Not A Column": "x" })).rejects.toThrow(/Not A Column/);

    expect(logged(log)).toContain("SITE_MIRROR site=recSITE op=site mirrored=0");
    expect(logged(log)).toContain("Not A Column");
  });
});
