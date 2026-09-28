import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));

import { launch } from "../../src/recipes/launch.js";
import { announce } from "../../src/recipes/announce.js";
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";
import { mapRow as mapReportRow } from "../../src/reports/airtable/reports.js";
import type { SiteMirror } from "../../src/db/site-mirror.js";
import type { AuditResult, RecipeResult } from "../../src/types.js";
import { makeFakeReportWriter } from "../reports/_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableBase, untouchableFetch } from "./_helpers/untouchable-airtable.js";

let touched: string[] = [];
let logged: () => string;
let warned: () => string;

beforeEach(() => {
  touched = [];
  vi.stubGlobal("fetch", untouchableFetch(touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
  warned = () => warn.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function recordingSiteMirror() {
  const health: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const mirror: SiteMirror = {
    created: async () => {},
    hasRow: async () => true,
    health: async (id, fields) => {
      health.push({ id, fields });
    },
    site: async () => {},
  };
  return { mirror, health };
}

describe("shipped shadow-off: launch never touches Airtable", () => {
  const TODAY = new Date();
  const PERIOD = TODAY.toISOString().slice(0, 7);
  const REPORT_ID = "rec_existing_launch";
  let checkoutDir = "";

  beforeAll(async () => {
    checkoutDir = await mkdtemp(join(tmpdir(), "shadow-off-launch-"));
    await mkdir(join(checkoutDir, "src/routes"), { recursive: true });
  });

  afterAll(async () => {
    await rm(checkoutDir, { recursive: true, force: true });
  });

  it("writes the first audit, refreshes the reused row, stores the preview and queues it, all in Turso", async () => {
    const writer = makeFakeReportWriter([
      mapReportRow({
        id: REPORT_ID,
        fields: {
          "Report ID": "Acme Co — Launch — existing",
          Site: ["rec_site_acme"],
          "Report type": "Launch",
          Period: PERIOD,
          "Lighthouse — Performance": 10,
        },
      }),
    ]);
    const { mirror, health } = recordingSiteMirror();
    const lighthouse: AuditResult = {
      audit: "lighthouse",
      site: "Acme Co",
      status: "pass",
      summary: "lighthouse ok",
      details: {
        summary: { performance: 0.87, accessibility: 0.91, "best-practices": 1.0, seo: 0.95 },
      },
    };
    const result = await launch(
      { path: checkoutDir, name: "Acme Co" },
      {
        base: untouchableBase(touched),
        roster: async () => [
          makeWebsiteRow({ id: "rec_site_acme", name: "Acme Co", status: "launching" }),
        ],
        reportMirror: writer,
        siteMirror: mirror,
        bootstrap: async (): Promise<RecipeResult> => ({
          recipe: "self-updating",
          site: "Acme Co",
          status: "applied",
          commits: ["abc123"],
        }),
        audit: async () => [lighthouse],
        probe: async (url: string) =>
          url.endsWith("/health")
            ? { status: 200, body: '{"ok":true}' }
            : { status: 404, body: "<h1>404</h1>" },
      },
    );
    expect(touched).toEqual([]);
    expect(result.complete).toBe(true);
    expect(health).toEqual([
      { id: "rec_site_acme", fields: expect.objectContaining({ pScore: 87 }) },
    ]);
    expect(writer.patches).toEqual([
      {
        id: REPORT_ID,
        patch: {
          lighthouse_performance: 87,
          lighthouse_accessibility: 91,
          lighthouse_best_practices: 100,
          lighthouse_seo: 95,
          completed_on: TODAY.toISOString().slice(0, 10),
        },
      },
      { id: REPORT_ID, patch: { draft_ready: 1 } },
    ]);
    expect(writer.bodies).toEqual([{ id: REPORT_ID, html: expect.stringContaining("Acme Co") }]);
    expect(warned()).not.toContain("preview upload skipped");
    expect(logged()).toContain(
      `AIRTABLE_SHADOW skipped=shadow-off writer=updateReportScores id=${REPORT_ID}`,
    );
  });
});

describe("shipped shadow-off: announce never touches Airtable", () => {
  const NOW = new Date("2026-06-17T12:00:00.000Z");
  const REPORT_ID = "rec_existing_announce";

  it("stamps analytics health, refreshes the reused row, stores the preview and queues it, all in Turso", async () => {
    vi.stubEnv("GA_SUBJECT", "tucker@reddoorla.com");
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
    vi.mocked(fetchSearch).mockResolvedValue({
      value: null,
      softFailed: false,
      defaultQueryMissed: false,
      propertyMissing: false,
      notConfigured: false,
    });
    const writer = makeFakeReportWriter([
      mapReportRow({
        id: REPORT_ID,
        fields: {
          "Report ID": "Acme Co — Announcement — existing",
          Site: ["rec_acme"],
          "Report type": "Announcement",
          Period: "2026-06",
        },
      }),
      mapReportRow({
        id: "rec_queued_maint",
        fields: {
          "Report ID": "Acme Co — Maintenance — 2026-06-01",
          Site: ["rec_acme"],
          "Report type": "Maintenance",
          "Draft ready": true,
        },
      }),
    ]);
    const { mirror, health } = recordingSiteMirror();
    const { results } = await announce({
      base: untouchableBase(touched),
      now: NOW,
      refreshHeader: false,
      roster: async () => [
        makeWebsiteRow({
          id: "rec_acme",
          name: "Acme Co",
          status: "maintained",
          ga4PropertyId: "G-123",
          reportRecipientsTo: "client@acme.example.com",
          pScore: 87,
          rScore: 91,
          bpScore: 100,
          seoScore: 95,
        }),
      ],
      reportMirror: writer,
      siteMirror: mirror,
    });
    expect(touched).toEqual([]);
    expect(results).toEqual([
      {
        site: "Acme Co",
        status: "reused",
        reportId: REPORT_ID,
        recipientMissing: false,
        queued: true,
      },
    ]);
    expect(health).toEqual([
      { id: "rec_acme", fields: { "Analytics soft-fail at": NOW.toISOString() } },
    ]);
    expect(writer.patches).toEqual([
      {
        id: REPORT_ID,
        patch: {
          lighthouse_performance: 87,
          lighthouse_accessibility: 91,
          lighthouse_best_practices: 100,
          lighthouse_seo: 95,
          completed_on: "2026-06-17",
        },
      },
      { id: "rec_queued_maint", patch: { draft_ready: 0 } },
      { id: REPORT_ID, patch: { draft_ready: 1 } },
    ]);
    expect(writer.bodies).toEqual([{ id: REPORT_ID, html: expect.stringContaining("Acme Co") }]);
    expect(warned()).not.toContain("Airtable shadow write skipped");
    expect(warned()).not.toContain("preview upload skipped");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateAnalyticsHealth id=rec_acme",
    );
  });
});
