import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { draftReportForSite } from "../../src/reports/draft.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { mapRow } from "../../src/reports/airtable/reports.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";
import { makeFakeReportWriter } from "./_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/reports/ga/client.js", async (importActual) => ({
  ...(await importActual<typeof import("../../src/reports/ga/client.js")>()),
  fetchPeriodUsers: vi.fn(),
}));
vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

vi.mock("../../src/reports/search/client.js", () => ({ fetchSearchPresence: vi.fn() }));

const SITE = makeWebsiteRow({
  id: "rec_site_acme",
  pointOfContact: "ops@acme.example.com",
  maintenanceFreq: "Monthly",
  maintenanceDay: "2026-04-26",
  testingFreq: "Quarterly",
  pScore: 87,
  rScore: 91,
  bpScore: 100,
  seoScore: 95,
});

function quotaError(): Error {
  return Object.assign(new Error("Airtable monthly API call quota exhausted"), {
    code: "AIRTABLE_QUOTA_EXHAUSTED",
  });
}

function orderedBase(log: string[], fail: boolean): AirtableBase {
  const inner = makeFakeBase({ Reports: [] });
  return ((table: string) => ({
    ...inner(table),
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}:${String(records[0]!.fields["Draft ready"])}`);
      if (fail) throw quotaError();
      return records;
    },
  })) as unknown as AirtableBase;
}

function loggingWriter(log: string[], seed: Parameters<typeof makeFakeReportWriter>[0] = []) {
  const writer = makeFakeReportWriter(seed);
  const { body, patch } = writer;
  writer.body = async (id, html) => {
    log.push(`turso:body:${id}`);
    await body(id, html);
  };
  writer.patch = async (id, p) => {
    log.push(`turso:patch:${id}:${String(p.draft_ready)}`);
    await patch(id, p);
  };
  return writer;
}

function uploadFetch(log: string[], status: number) {
  return vi.fn(async (url: string) => {
    log.push(`airtable:upload:${url.split("/")[5]}`);
    return {
      ok: status < 400,
      status,
      statusText: status < 400 ? "OK" : "Too Many Requests",
      text: async () => (status < 400 ? "" : "PUBLIC_API_BILLING_LIMIT_EXCEEDED"),
    };
  });
}

const HALF_MADE = {
  period: "2026-05",
  completeRowId: "rec_halfmade",
  existingRow: { id: "rec_halfmade", reportId: "Acme Co — Maintenance — 2026-05-26" } as never,
};

beforeEach(() => {
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  vi.stubEnv("GA_SUBJECT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("draftReportForSite writes the body and the queue flags to Turso before any Airtable shadow", () => {
  it("completes a half-made `rec` row: Turso body and flag, then the attachment, then Draft ready", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", uploadFetch(log, 200));
    const writer = loggingWriter(log);

    const result = await draftReportForSite(orderedBase(log, false), SITE, "Maintenance", {
      refreshHeader: false,
      reportMirror: writer,
      ...HALF_MADE,
    });

    expect(result.queued).toBe(true);
    expect(log).toEqual([
      "turso:body:rec_halfmade",
      "turso:patch:rec_halfmade:1",
      "airtable:upload:rec_halfmade",
      "airtable:Reports:rec_halfmade:true",
    ]);
  });

  it("an exhausted attachment upload still leaves the half-made row stored and queued in Turso", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", uploadFetch(log, 429));
    const writer = loggingWriter(log);

    await expect(
      draftReportForSite(orderedBase(log, false), SITE, "Maintenance", {
        refreshHeader: false,
        reportMirror: writer,
        ...HALF_MADE,
      }),
    ).rejects.toThrow(/Airtable upload failed: 429/);

    expect(writer.bodies).toEqual([{ id: "rec_halfmade", html: expect.stringContaining("Acme") }]);
    expect(writer.patches).toEqual([{ id: "rec_halfmade", patch: { draft_ready: 1 } }]);
    expect(log).not.toContain("airtable:Reports:rec_halfmade:true");
  });

  it("a superseded `rec` row's failing shadow cannot cost a fresh draft its Turso queue flag", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", uploadFetch(log, 200));
    const writer = loggingWriter(log, [
      mapRow({
        id: "rec_old_maint",
        fields: {
          "Report ID": "Acme Co — Maintenance — 2026-09-01",
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          "Draft ready": true,
        },
      }),
    ]);

    await expect(
      draftReportForSite(orderedBase(log, true), SITE, "Testing", {
        refreshHeader: false,
        reportMirror: writer,
      }),
    ).rejects.toMatchObject({ code: "AIRTABLE_QUOTA_EXHAUSTED" });

    const id = writer.inserts[0]!.id;
    expect(id).toMatch(/^report_/);
    expect(writer.bodies.map((b) => b.id)).toEqual([id]);
    expect(writer.patches).toEqual([
      { id: "rec_old_maint", patch: { draft_ready: 0 } },
      { id, patch: { draft_ready: 1 } },
    ]);
    expect(log).toEqual([
      `turso:body:${id}`,
      "turso:patch:rec_old_maint:0",
      `turso:patch:${id}:1`,
      "airtable:Reports:rec_old_maint:false",
    ]);
  });
});
