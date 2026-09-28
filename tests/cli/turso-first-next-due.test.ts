import { describe, it, expect, vi, afterEach } from "vitest";
import { writeNextDueDates } from "../../src/cli/commands/report.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const TODAY = new Date("2026-08-24T09:23:00.000Z");
const TODAY_YMD = "2026-08-24";

const SITES = [
  makeWebsiteRow({ id: "recA", name: "Acme", maintenanceFreq: "Monthly" }),
  makeWebsiteRow({ id: "recB", name: "Beta", testingFreq: "Monthly" }),
];

type Write = { siteId: string; fields: Record<string, unknown> };

function orderedBase(log: string[], sent: Write[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}`);
      sent.push({ siteId: records[0]!.id, fields: records[0]!.fields });
      if (fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

async function run(fail: boolean) {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log: string[] = [];
  const mirrored: Array<Write & { computedAt: string }> = [];
  const shadowed: Write[] = [];
  await writeNextDueDates(
    orderedBase(log, shadowed, fail),
    SITES,
    [],
    TODAY,
    async (siteId, fields, computedAt) => {
      log.push(`turso:${siteId}`);
      mirrored.push({ siteId, fields, computedAt });
      return true;
    },
  );
  return {
    log,
    mirrored,
    shadowed,
    line: out.mock.calls.flat().join("\n"),
    warned: warn.mock.calls.flat().join("\n"),
  };
}

describe("writeNextDueDates writes site_schedule before the Airtable shadow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mirrors each moved date before its Airtable update (both succeed: known-good control)", async () => {
    const { log, mirrored, shadowed, line } = await run(false);
    expect(log).toEqual([
      "turso:recA",
      "airtable:Websites:recA",
      "turso:recB",
      "airtable:Websites:recB",
    ]);
    expect(mirrored.map(({ siteId, fields }) => ({ siteId, fields }))).toEqual(shadowed);
    expect(line).toContain(
      "NEXT_DUE_WRITE wrote=2 skipped=0 failed=0 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
  });

  it("still lands every date in Turso when every Airtable write fails, and still counts them as failed", async () => {
    const { mirrored, shadowed, line, warned } = await run(true);
    expect(mirrored).toEqual([
      {
        siteId: "recA",
        fields: { "Next maintenance at": TODAY_YMD, "Next testing at": null },
        computedAt: TODAY.toISOString(),
      },
      {
        siteId: "recB",
        fields: { "Next maintenance at": null, "Next testing at": TODAY_YMD },
        computedAt: TODAY.toISOString(),
      },
    ]);
    expect(mirrored.map(({ siteId, fields }) => ({ siteId, fields }))).toEqual(shadowed);
    expect(line).toContain(
      "NEXT_DUE_WRITE wrote=0 skipped=0 failed=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(warned).toContain(
      "next-due write skipped for Acme: Airtable monthly API call quota exhausted",
    );
  });
});
