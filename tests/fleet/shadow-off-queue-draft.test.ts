import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/reports/ga/client.js", async (importActual) => ({
  ...(await importActual<typeof import("../../src/reports/ga/client.js")>()),
  fetchPeriodUsers: vi.fn(async () => {
    throw new Error("GA 503");
  }),
}));
vi.mock("../../src/reports/search/client.js", () => ({
  fetchSearchPresence: vi.fn(async () => {
    throw new Error("Search Console 503");
  }),
}));

import { queueDraft } from "../../src/reports/queue.js";
import { draftReportForSite } from "../../src/reports/draft.js";
import { mapRow } from "../../src/reports/airtable/reports.js";
import type { ReportType } from "../../src/reports/types.js";
import { makeFakeReportWriter } from "../reports/_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableBase, untouchableFetch } from "./_helpers/untouchable-airtable.js";

let touched: string[] = [];
let logged: () => string;

beforeEach(() => {
  touched = [];
  vi.stubGlobal("fetch", untouchableFetch(touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  vi.stubEnv("GA_SUBJECT", "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function report(id: string, type: ReportType, draftReady: boolean, site = "rec_site_acme") {
  return mapRow({
    id,
    fields: {
      "Report ID": `Acme Co — ${type} — ${id}`,
      Site: [site],
      "Report type": type,
      "Draft ready": draftReady,
    },
  });
}

describe("shipped shadow-off: queueDraft never touches Airtable", () => {
  it("supersedes and queues rec rows in Turso", async () => {
    const writer = makeFakeReportWriter([
      report("rec_maint", "Maintenance", true),
      report("rec_test", "Testing", false),
    ]);
    const out = await queueDraft(
      untouchableBase(touched),
      { id: "rec_test", siteId: "rec_site_acme", reportType: "Testing" },
      writer,
    );
    expect(touched).toEqual([]);
    expect(out).toEqual({ queued: true, supersededIds: ["rec_maint"] });
    expect(writer.patches).toEqual([
      { id: "rec_maint", patch: { draft_ready: 0 } },
      { id: "rec_test", patch: { draft_ready: 1 } },
    ]);
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=setDraftReady id=rec_maint",
    );
  });

  it("stands a blocked rec row down in Turso without throwing", async () => {
    const writer = makeFakeReportWriter([
      report("rec_test", "Testing", true),
      report("rec_maint", "Maintenance", true),
    ]);
    const out = await queueDraft(
      untouchableBase(touched),
      { id: "rec_maint", siteId: "rec_site_acme", reportType: "Maintenance" },
      writer,
    );
    expect(touched).toEqual([]);
    expect(out).toEqual({ queued: false, blockedBy: "Testing", supersededIds: [] });
    expect(writer.patches).toEqual([{ id: "rec_maint", patch: { draft_ready: 0 } }]);
  });
});

describe("shipped shadow-off: draftReportForSite never touches Airtable", () => {
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

  it("completes a half-made rec row and stamps its analytics soft-fail, all in Turso", async () => {
    vi.stubEnv("GA_SUBJECT", "tucker@reddoorla.com");
    const writer = makeFakeReportWriter();
    const health: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const result = await draftReportForSite(
      untouchableBase(touched),
      { ...SITE, ga4PropertyId: "G-123" },
      "Maintenance",
      {
        refreshHeader: false,
        reportMirror: writer,
        siteMirror: {
          created: async () => {},
          hasRow: async () => true,
          health: async (id, fields) => {
            health.push({ id, fields });
          },
          site: async () => {},
        },
        period: "2026-05",
        completeRowId: "rec_halfmade",
        existingRow: {
          id: "rec_halfmade",
          reportId: "Acme Co — Maintenance — 2026-05-26",
        } as never,
      },
    );
    expect(touched).toEqual([]);
    expect(result.queued).toBe(true);
    expect(result.softFailures).toEqual(["ga", "search"]);
    expect(health).toEqual([
      { id: "rec_site_acme", fields: { "Analytics soft-fail at": expect.any(String) } },
    ]);
    expect(writer.bodies).toEqual([{ id: "rec_halfmade", html: expect.stringContaining("Acme") }]);
    expect(writer.patches).toEqual([{ id: "rec_halfmade", patch: { draft_ready: 1 } }]);
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=uploadAttachment id=rec_halfmade",
    );
  });

  it("mints a fresh draft that supersedes a rec row, all in Turso", async () => {
    const writer = makeFakeReportWriter([report("rec_old_maint", "Maintenance", true)]);
    const result = await draftReportForSite(untouchableBase(touched), SITE, "Testing", {
      refreshHeader: false,
      reportMirror: writer,
    });
    expect(touched).toEqual([]);
    const id = writer.inserts[0]!.id;
    expect(id).toMatch(/^report_/);
    expect(result).toMatchObject({ queued: true, supersededIds: ["rec_old_maint"] });
    expect(writer.bodies.map((b) => b.id)).toEqual([id]);
    expect(writer.patches).toEqual([
      { id: "rec_old_maint", patch: { draft_ready: 0 } },
      { id, patch: { draft_ready: 1 } },
    ]);
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=setDraftReady id=rec_old_maint",
    );
  });
});
