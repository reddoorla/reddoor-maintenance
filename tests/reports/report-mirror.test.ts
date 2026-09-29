/**
 * #539 Phase 5: the Turso dual-write for the whole Reports write surface, and
 * its marker line.
 *
 * The marker exists because of #585, where Phase 3's next-due mirror never ran
 * in production for weeks: the helper returned null without creds and the write
 * silently no-opped, so a DEAD dual-write and a healthy one produced identical
 * output. The tell there was an ABSENT suffix — something nobody was looking
 * for. So this mirror never returns null: an unreachable store refuses to
 * build, and every write logs one REPORT_MIRROR line before it succeeds or
 * throws, which makes a missing line mean the wiring itself is gone rather than
 * "probably fine".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeReportMirror } from "../../src/reports/report-mirror.js";
import { openDb } from "../../src/db/client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeReportMirror (always observable, never swallows)", () => {
  const logged = (spy: ReturnType<typeof vi.spyOn>) =>
    (spy.mock.calls as unknown[][]).flat().join("\n");

  it("create: writes the row and reports op=create mirrored=1", async () => {
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    await mirror.create({ id: "recNEW", fields: { "Report ID": "acme-2026-08" } });

    const stored = await db
      .selectFrom("reports")
      .select("report_id")
      .where("id", "=", "recNEW")
      .executeTakeFirst();
    expect(stored?.report_id).toBe("acme-2026-08");
    expect(logged(log)).toContain("REPORT_MIRROR report=recNEW op=create mirrored=1");
  });

  it("body: stores the rendered HTML the console preview serves", async () => {
    // Without this the preview route 404s ("No rendered body stored") on every
    // freshly drafted report — the row exists, the page it links to does not.
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    await mirror.create({ id: "recNEW", fields: {} });
    await mirror.body("recNEW", "<p>the report</p>");

    const stored = await db
      .selectFrom("reports")
      .select("rendered_html")
      .where("id", "=", "recNEW")
      .executeTakeFirst();
    expect(stored?.rendered_html).toBe("<p>the report</p>");
    expect(logged(log)).toContain("REPORT_MIRROR report=recNEW op=body mirrored=1");
  });

  it("patch: updates named columns on an existing row", async () => {
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    await mirror.create({ id: "recNEW", fields: { "Draft ready": true } });
    await mirror.patch("recNEW", { draft_ready: 0, lighthouse_seo: 71 });

    const stored = await db
      .selectFrom("reports")
      .select(["draft_ready", "lighthouse_seo"])
      .where("id", "=", "recNEW")
      .executeTakeFirst();
    expect(stored?.draft_ready).toBe(0);
    expect(stored?.lighthouse_seo).toBe(71);
    expect(logged(log)).toContain("REPORT_MIRROR report=recNEW op=patch mirrored=1");
  });

  it("#647: patch on a row Turso never held reports mirrored=missed, and THROWS", async () => {
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    await expect(mirror.patch("recGHOST", { draft_ready: 0 })).rejects.toThrow(
      /REPORT_MIRROR report=recGHOST op=patch: no such row in Turso/,
    );
    expect(logged(log)).toContain("REPORT_MIRROR report=recGHOST op=patch mirrored=missed");

    // Positive control: the same mirror is transparent when the row exists.
    await mirror.create({ id: "recREAL", fields: { "Report ID": "R" } });
    await expect(mirror.patch("recREAL", { draft_ready: 0 })).resolves.toBeUndefined();
  });

  it("without libSQL creds it refuses to build instead of returning null", async () => {
    await expect(
      makeReportMirror(async () => {
        throw new Error("no TURSO_DATABASE_URL");
      }),
    ).rejects.toThrow(/REPORT_MIRROR unavailable: no TURSO_DATABASE_URL/);
  });

  it("create: inserts the row, logs op=create mirrored=1, and returns what Turso STORED", async () => {
    // #646 step 4: the primary write. What comes back must be the persisted row,
    // not a mapping of the caller's payload — the drafting path uploads a body
    // for, and queues, whatever id this returns.
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    const row = await mirror.create({
      id: "report_01ARYZ6S41TSV4RRFFQ69G5FAV",
      fields: { "Report ID": "acme-2026-09", Site: ["site_01ARYZ6S41TSV4RRFFQ69G5FAV"] },
    });

    expect(row.id).toBe("report_01ARYZ6S41TSV4RRFFQ69G5FAV");
    expect(row.reportId).toBe("acme-2026-09");
    expect(row.siteId).toBe("site_01ARYZ6S41TSV4RRFFQ69G5FAV");
    expect(logged(log)).toContain(
      "REPORT_MIRROR report=report_01ARYZ6S41TSV4RRFFQ69G5FAV op=create mirrored=1",
    );
    await db.destroy();
  });

  it("create: a colliding id FAILS rather than overwriting the existing report", async () => {
    // A plain INSERT, deliberately not the `created` mirror's upsert: the id was
    // just minted, so a conflict means something is wrong.
    const db = await openDb({ url: ":memory:" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeReportMirror(async () => db);
    const rec = { id: "report_DUPE", fields: { "Report ID": "first" } };
    await mirror.create(rec);
    await expect(mirror.create({ ...rec, fields: { "Report ID": "second" } })).rejects.toThrow(
      /UNIQUE|constraint/i,
    );
    const stored = await db
      .selectFrom("reports")
      .select("report_id")
      .where("id", "=", "report_DUPE")
      .executeTakeFirst();
    expect(stored?.report_id).toBe("first");
    await db.destroy();
  });

  it("forSite: answers with that site's reports — the drafting path's read", async () => {
    const db = await openDb({ url: ":memory:" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mirror = await makeReportMirror(async () => db);
    await mirror.create({ id: "report_A", fields: { Site: ["site_1"], "Report type": "Testing" } });
    await mirror.create({ id: "report_B", fields: { Site: ["site_2"] } });

    const rows = await mirror.forSite("site_1");
    expect(rows.map((r) => r.id)).toEqual(["report_A"]);
    expect(rows[0]!.reportType).toBe("Testing");
    await db.destroy();
  });

  it("a write failure is reported as mirrored=0 and thrown to the caller", async () => {
    // The failure is injected at the db handle rather than by closing a real
    // one: an in-memory Kysely instance keeps answering after `destroy()`, so
    // that version of this test passed while asserting the opposite of what it
    // claimed to.
    const boom = () => {
      throw new Error("SQLITE_BUSY");
    };
    const db = { insertInto: boom, updateTable: boom } as unknown as Awaited<
      ReturnType<typeof openDb>
    >;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db);
    await expect(mirror.body("recNEW", "<p>x</p>")).rejects.toThrow(/SQLITE_BUSY/);
    await expect(mirror.patch("recNEW", { draft_ready: 1 })).rejects.toThrow(/SQLITE_BUSY/);

    const out = logged(log);
    for (const op of ["body", "patch"]) {
      expect(out).toContain(`REPORT_MIRROR report=recNEW op=${op} mirrored=0 error=SQLITE_BUSY`);
    }
  });
});
