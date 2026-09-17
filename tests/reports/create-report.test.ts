/**
 * #646 step 4: creating a report is a TURSO write. These are the creator's own
 * rules — what it mints, what it writes, what it hands back, and the Airtable
 * shadow it deliberately does not attempt. The drafting path that calls it is
 * covered in draft.test.ts; the whole thing against a real libSQL database is
 * tests/reports/turso-native-report.e2e.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { createReportDraft, findReportForPeriod } from "../../src/reports/create-report.js";
import { draftFields, type DraftInput } from "../../src/reports/draft-fields.js";
import { mapRow } from "../../src/reports/airtable/reports.js";
import { makeFakeReportWriter } from "./_helpers/fake-report-writer.js";

function input(over: Partial<DraftInput> = {}): DraftInput {
  return {
    reportId: "Acme Co — Maintenance — 2026-09-17",
    siteId: "site_01ARYZ6S41TSV4RRFFQ69G5FAV",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: new Date("2026-08-18T00:00:00.000Z"),
    periodEnd: new Date("2026-09-17T00:00:00.000Z"),
    completedOn: new Date("2026-09-17T00:00:00.000Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
    ...over,
  };
}

describe("createReportDraft", () => {
  it("mints a `report_<ULID>` id and writes the row through the store", async () => {
    const writer = makeFakeReportWriter();
    const row = await createReportDraft(input(), { create: writer.create });

    expect(writer.inserts).toHaveLength(1);
    expect(writer.inserts[0]!.id).toMatch(/^report_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row.id).toBe(writer.inserts[0]!.id);
  });

  it("drafts for a `site_<ULID>` site — the case that was impossible before", async () => {
    // The Airtable creator refuses this by name: there is no Websites record for
    // its `Site` link to point at. This is the whole reason the decision exists.
    const writer = makeFakeReportWriter();
    const row = await createReportDraft(input(), { create: writer.create });
    expect(row.siteId).toBe("site_01ARYZ6S41TSV4RRFFQ69G5FAV");
  });

  it("writes exactly the shared field set, so the stored row matches the Airtable shape", async () => {
    const writer = makeFakeReportWriter();
    const spec = input();
    await createReportDraft(spec, { create: writer.create });
    expect(writer.inserts[0]!.fields).toEqual(draftFields(spec));
  });

  it("returns what the STORE gave back, not the caller's input", async () => {
    // The row a caller acts on (uploads a body for, queues) must be the persisted
    // one: mapping the input here would diverge the moment a coercion changed.
    const stored = mapRow({ id: "report_STUB", fields: { "Report ID": "from the store" } });
    const row = await createReportDraft(input(), { create: async () => stored });
    expect(row).toBe(stored);
  });

  it("logs the Airtable shadow skip rather than attempting a create", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const writer = makeFakeReportWriter();
    const row = await createReportDraft(input(), { create: writer.create });
    expect(log).toHaveBeenCalledWith(
      `AIRTABLE_SHADOW skipped=non-rec-id writer=createReportDraft id=${row.id}`,
    );
    log.mockRestore();
  });

  it("propagates a store failure — a report that did not land must not look drafted", async () => {
    await expect(
      createReportDraft(input(), {
        create: async () => {
          throw new Error("no such table: reports");
        },
      }),
    ).rejects.toThrow(/no such table/);
  });

  it("takes an injected minter, so a caller can pin the id", async () => {
    const writer = makeFakeReportWriter();
    const row = await createReportDraft(input(), {
      create: writer.create,
      mintId: () => "report_PINNED",
    });
    expect(row.id).toBe("report_PINNED");
  });
});

describe("findReportForPeriod", () => {
  const rows = [
    mapRow({
      id: "rec_old",
      fields: { Site: ["recA"], "Report type": "Launch", Period: "2026-08" },
    }),
    mapRow({
      id: "rec_now",
      fields: { Site: ["recA"], "Report type": "Launch", Period: "2026-09" },
    }),
    mapRow({
      id: "rec_other",
      fields: { Site: ["recA"], "Report type": "Announcement", Period: "2026-09" },
    }),
  ];
  const store = { forSite: async (siteId: string) => rows.filter((r) => r.siteId === siteId) };

  it("matches the (site, type, period) triple", async () => {
    expect((await findReportForPeriod(store, "recA", "Launch", "2026-09"))?.id).toBe("rec_now");
  });

  it("returns null when the period has no report of that type", async () => {
    expect(await findReportForPeriod(store, "recA", "Launch", "2026-10")).toBeNull();
  });

  it("never matches another site's report", async () => {
    expect(await findReportForPeriod(store, "recB", "Launch", "2026-09")).toBeNull();
  });
});
