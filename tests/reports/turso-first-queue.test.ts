import { describe, it, expect, vi } from "vitest";
import { queueDraft } from "../../src/reports/queue.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { mapRow } from "../../src/reports/airtable/reports.js";
import type { ReportType } from "../../src/reports/types.js";
import { makeFakeReportWriter } from "./_helpers/fake-report-writer.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

function rep(id: string, type: ReportType, draftReady: boolean) {
  return mapRow({
    id,
    fields: { "Report ID": id, Site: ["siteA"], "Report type": type, "Draft ready": draftReady },
  });
}

function orderedBase(log: string[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}:${String(records[0]!.fields["Draft ready"])}`);
      if (fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

function loggingWriter(log: string[], seed: ReturnType<typeof rep>[]) {
  const writer = makeFakeReportWriter(seed);
  const patch = writer.patch;
  writer.patch = async (id, p) => {
    log.push(`turso:${id}:${String(p.draft_ready)}`);
    await patch(id, p);
  };
  return writer;
}

describe("queueDraft writes every Turso flag before the Airtable shadow", () => {
  it("supersedes and queues in Turso, then replays the same flags onto Airtable", async () => {
    const log: string[] = [];
    const writer = loggingWriter(log, [
      rep("rec_maint", "Maintenance", true),
      rep("rec_test", "Testing", false),
    ]);

    const out = await queueDraft(
      orderedBase(log, false),
      { id: "rec_test", siteId: "siteA", reportType: "Testing" },
      writer,
    );

    expect(out).toEqual({ queued: true, supersededIds: ["rec_maint"] });
    expect(log).toEqual([
      "turso:rec_maint:0",
      "turso:rec_test:1",
      "airtable:Reports:rec_maint:false",
      "airtable:Reports:rec_test:true",
    ]);
  });

  it("a superseded `rec` row's failing shadow cannot cost the new report its Turso queue flag", async () => {
    const log: string[] = [];
    const id = "report_01ARYZ6S41TSV4RRFFQ69G5FAV";
    const writer = loggingWriter(log, [
      rep("rec_maint", "Maintenance", true),
      rep(id, "Testing", false),
    ]);

    await expect(
      queueDraft(orderedBase(log, true), { id, siteId: "siteA", reportType: "Testing" }, writer),
    ).rejects.toMatchObject({ code: "AIRTABLE_QUOTA_EXHAUSTED" });

    expect(writer.patches).toEqual([
      { id: "rec_maint", patch: { draft_ready: 0 } },
      { id, patch: { draft_ready: 1 } },
    ]);
    expect(log).toEqual([`turso:rec_maint:0`, `turso:${id}:1`, "airtable:Reports:rec_maint:false"]);
  });

  it("stands down in Turso first when blocked, and still throws the shadow's failure", async () => {
    const log: string[] = [];
    const writer = loggingWriter(log, [
      rep("rec_test", "Testing", true),
      rep("rec_maint", "Maintenance", true),
    ]);

    await expect(
      queueDraft(
        orderedBase(log, true),
        { id: "rec_maint", siteId: "siteA", reportType: "Maintenance" },
        writer,
      ),
    ).rejects.toThrow(/quota exhausted/);

    expect(writer.patches).toEqual([{ id: "rec_maint", patch: { draft_ready: 0 } }]);
    expect(log).toEqual(["turso:rec_maint:0", "airtable:Reports:rec_maint:false"]);
  });
});
