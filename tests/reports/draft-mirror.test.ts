/**
 * #539 Phase 5: the create-side dual-write for Reports rows, and its marker line.
 *
 * The marker exists because of #585, where Phase 3's next-due mirror never ran
 * in production for weeks: the helper returned null without creds and the write
 * silently no-opped, so a DEAD dual-write and a healthy one produced identical
 * output. The tell there was an ABSENT suffix — something nobody was looking
 * for. So this mirror never returns null: creds-absent is a state it REPORTS
 * (`mirrored=absent`), which makes a missing DRAFT_MIRROR line mean the wiring
 * itself is gone rather than "probably fine".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createDraft } from "../../src/reports/airtable/reports.js";
import { makeDraftMirror } from "../../src/reports/draft-mirror.js";
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

describe("makeDraftMirror (best-effort, always observable)", () => {
  it("writes the row and reports mirrored=1", async () => {
    const db = await openDb({ url: ":memory:" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeDraftMirror(async () => db);
    await mirror({ id: "recNEW", fields: { "Report ID": "acme-2026-08" } });

    const stored = await db
      .selectFrom("reports")
      .select("report_id")
      .where("id", "=", "recNEW")
      .executeTakeFirst();
    expect(stored?.report_id).toBe("acme-2026-08");
    expect(log.mock.calls.flat().join("\n")).toContain("DRAFT_MIRROR report=recNEW mirrored=1");
  });

  it("without libSQL creds it reports mirrored=absent instead of returning null", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeDraftMirror(async () => {
      throw new Error("no TURSO_DATABASE_URL");
    });
    await expect(mirror({ id: "recNEW", fields: {} })).resolves.toBeUndefined();

    expect(log.mock.calls.flat().join("\n")).toContain(
      "DRAFT_MIRROR report=recNEW mirrored=absent",
    );
  });

  it("a write failure is reported as mirrored=0 and never breaks the draft", async () => {
    // The failure is injected at the db handle rather than by closing a real
    // one: an in-memory Kysely instance keeps answering after `destroy()`, so
    // that version of this test passed while asserting the opposite of what it
    // claimed to.
    const db = {
      insertInto: () => {
        throw new Error("SQLITE_BUSY");
      },
    } as unknown as Awaited<ReturnType<typeof openDb>>;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mirror = await makeDraftMirror(async () => db);
    await expect(mirror({ id: "recNEW", fields: {} })).resolves.toBeUndefined();

    expect(log.mock.calls.flat().join("\n")).toContain(
      "DRAFT_MIRROR report=recNEW mirrored=0 error=SQLITE_BUSY",
    );
  });
});
