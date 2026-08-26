/**
 * #539 Phase 5: the Turso dual-write for the whole Reports write surface, and
 * its marker line.
 *
 * The marker exists because of #585, where Phase 3's next-due mirror never ran
 * in production for weeks: the helper returned null without creds and the write
 * silently no-opped, so a DEAD dual-write and a healthy one produced identical
 * output. The tell there was an ABSENT suffix — something nobody was looking
 * for. So this mirror never returns null: creds-absent is a state it REPORTS
 * (`mirrored=absent`), which makes a missing REPORT_MIRROR line mean the wiring
 * itself is gone rather than "probably fine".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createDraft } from "../../src/reports/airtable/reports.js";
import { makeReportMirror } from "../../src/reports/report-mirror.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";
import { openDb } from "../../src/db/client.js";

const INPUT = {
  reportId: "Acme — Maintenance — 2026-08-31",
  siteId: "rec_site_acme",
  reportType: "Maintenance" as const,
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-31T00:00:00Z"),
  completedOn: new Date("2026-08-31T00:00:00Z"),
  lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
  lastTestedDate: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDraft hands the created record to an injected mirror", () => {
  it("passes the id and the fields Airtable echoed back, not the caller's input", async () => {
    // The mirror must see what Airtable STORED. Mapping the caller's DraftInput
    // instead would diverge the moment Airtable normalises a value, and parity
    // compares against the stored record.
    const base = makeFakeBase({ Reports: [] });
    const seen: Array<{ id: string; fields: Record<string, unknown> }> = [];

    const row = await createDraft(base, { ...INPUT, period: "2026-08" }, async (rec) => {
      seen.push(rec);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(row.id);
    expect(seen[0]!.fields["Report ID"]).toBe(INPUT.reportId);
    expect(seen[0]!.fields["Period"]).toBe("2026-08");
    expect(seen[0]!.fields["Delivery status"]).toBe("pending");
  });

  it("still creates the row when no mirror is injected (the pre-Phase-5 callers)", async () => {
    const base = makeFakeBase({ Reports: [] });
    await expect(createDraft(base, INPUT)).resolves.toMatchObject({ reportType: "Maintenance" });
  });
});

describe("makeReportMirror (best-effort, always observable)", () => {
  const logged = (spy: ReturnType<typeof vi.spyOn>) =>
    (spy.mock.calls as unknown[][]).flat().join("\n");

  it("created: writes the row and reports op=created mirrored=1", async () => {
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db, false);
    await mirror.created({ id: "recNEW", fields: { "Report ID": "acme-2026-08" } });

    const stored = await db
      .selectFrom("reports")
      .select("report_id")
      .where("id", "=", "recNEW")
      .executeTakeFirst();
    expect(stored?.report_id).toBe("acme-2026-08");
    expect(logged(log)).toContain("REPORT_MIRROR report=recNEW op=created mirrored=1");
  });

  it("body: stores the rendered HTML the console preview serves", async () => {
    // Without this the preview route 404s ("No rendered body stored") on every
    // freshly drafted report until the next hourly sync re-downloads the
    // Airtable attachment — the row exists, the page it links to does not.
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => db, false);
    await mirror.created({ id: "recNEW", fields: {} });
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

    const mirror = await makeReportMirror(async () => db, false);
    await mirror.created({ id: "recNEW", fields: { "Draft ready": true } });
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

  it("without libSQL creds every operation reports mirrored=absent instead of returning null", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeReportMirror(async () => {
      throw new Error("no TURSO_DATABASE_URL");
    }, false);
    await expect(mirror.created({ id: "recNEW", fields: {} })).resolves.toBeUndefined();
    await expect(mirror.body("recNEW", "<p>x</p>")).resolves.toBeUndefined();
    await expect(mirror.patch("recNEW", { draft_ready: 1 })).resolves.toBeUndefined();

    const out = logged(log);
    for (const op of ["created", "body", "patch"]) {
      expect(out).toContain(`REPORT_MIRROR report=recNEW op=${op} mirrored=absent`);
    }
  });

  it("a write failure is reported as mirrored=0 and never breaks the draft", async () => {
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

    const mirror = await makeReportMirror(async () => db, false);
    await expect(mirror.created({ id: "recNEW", fields: {} })).resolves.toBeUndefined();
    await expect(mirror.body("recNEW", "<p>x</p>")).resolves.toBeUndefined();
    await expect(mirror.patch("recNEW", { draft_ready: 1 })).resolves.toBeUndefined();

    const out = logged(log);
    for (const op of ["created", "body", "patch"]) {
      expect(out).toContain(`REPORT_MIRROR report=recNEW op=${op} mirrored=0 error=SQLITE_BUSY`);
    }
  });
});
