import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { announce } from "../../src/recipes/announce.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { mapRow as mapReportRow } from "../../src/reports/airtable/reports.js";
import { makeFakeReportWriter } from "../reports/_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const NOW = new Date("2026-06-17T12:00:00.000Z");
const REPORT_ID = "rec_existing_announce";
const QUOTA = "Airtable monthly API call quota exhausted";
const savedGaSubject = process.env.GA_SUBJECT;

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  process.env.GA_SUBJECT = "tucker@reddoorla.com";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
  vi.mocked(fetchSearch).mockResolvedValue({
    value: null,
    softFailed: false,
    defaultQueryMissed: false,
    propertyMissing: false,
    notConfigured: false,
  });
});

afterEach(() => {
  if (savedGaSubject === undefined) delete process.env.GA_SUBJECT;
  else process.env.GA_SUBJECT = savedGaSubject;
  vi.restoreAllMocks();
});

type Update = { table: string; id: string; fields: Record<string, unknown> };
type Failure = "websites" | "reports" | "upload" | "health";

function orderedBase(log: string[], updates: Update[], fail?: Failure): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      const u = { table, id: records[0]!.id, fields: records[0]!.fields };
      log.push(`airtable:${table}:${Object.keys(u.fields).join(",")}`);
      updates.push(u);
      const failing =
        (fail === "websites" && table === "Websites") ||
        (fail === "reports" && table === "Reports" && "Completed on" in u.fields);
      if (failing) throw Object.assign(new Error(QUOTA), { code: "AIRTABLE_QUOTA_EXHAUSTED" });
      return records;
    },
  })) as unknown as AirtableBase;
}

async function run(fail?: Failure) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log: string[] = [];
  const updates: Update[] = [];
  const upload = fail === "upload" ? 429 : 200;
  global.fetch = vi.fn(async (url: string) => {
    log.push(`airtable:upload:${decodeURIComponent(String(url).split("/").at(-2)!)}`);
    return {
      ok: upload === 200,
      status: upload,
      statusText: upload === 200 ? "OK" : "Too Many Requests",
      text: async () => (upload === 200 ? "" : QUOTA),
    };
  }) as unknown as typeof global.fetch;
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
  ]);
  const health: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const { results } = await announce({
    base: orderedBase(log, updates, fail),
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
    reportMirror: {
      ...writer,
      patch: async (id, patch) => {
        log.push(`turso:patch:${Object.keys(patch).join(",")}`);
        await writer.patch(id, patch);
      },
      body: async (id, html) => {
        log.push("turso:body");
        await writer.body(id, html);
      },
    },
    siteMirror: {
      created: async () => {},
      hasRow: async () => true,
      health: async (id, fields) => {
        log.push(`turso:health:${Object.keys(fields).join(",")}`);
        health.push({ id, fields });
        if (fail === "health") throw new Error("libsql down");
      },
      site: async () => {},
    },
  });
  return { results, log, updates, writer, health, warned: warn.mock.calls.flat().join("\n") };
}

const before = (log: string[], first: string, second: (l: string) => boolean) => {
  const a = log.indexOf(first);
  const b = log.findIndex(second);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
};

describe("announce analytics-health: Turso first, then the Airtable shadow (#782 pattern)", () => {
  const STAMP = { "Analytics soft-fail at": NOW.toISOString() };

  it("mirrors the stamp into Turso before the Airtable write (known-good control)", async () => {
    const { log, health, updates, results } = await run();
    before(log, "turso:health:Analytics soft-fail at", (l) =>
      l.startsWith("airtable:Websites:Analytics soft-fail at"),
    );
    expect(health).toEqual([{ id: "rec_acme", fields: STAMP }]);
    expect(updates.find((u) => u.table === "Websites")).toEqual({
      table: "Websites",
      id: "rec_acme",
      fields: STAMP,
    });
    expect(results[0]).toMatchObject({ status: "reused" });
  });

  it("a failed Airtable stamp still lands in Turso, is warned, and the draft continues", async () => {
    const { health, warned, results } = await run("websites");
    expect(health).toEqual([{ id: "rec_acme", fields: STAMP }]);
    expect(warned).toContain(
      `⚠ analytics-health Airtable shadow write skipped for Acme Co: ${QUOTA}`,
    );
    expect(results[0]).toMatchObject({ status: "reused", reportId: REPORT_ID });
  });

  it("a failed Turso mirror is warned and the Airtable shadow is still attempted", async () => {
    const { updates, warned, results } = await run("health");
    expect(warned).toContain("⚠ analytics-health Turso mirror failed for Acme Co: libsql down");
    expect(updates.find((u) => u.table === "Websites")?.fields).toEqual(STAMP);
    expect(results[0]).toMatchObject({ status: "reused" });
  });
});

describe("announce reuse path refreshes the Turso row before the Airtable shadow", () => {
  const TURSO_SCORES = {
    lighthouse_performance: 87,
    lighthouse_accessibility: 91,
    lighthouse_best_practices: 100,
    lighthouse_seo: 95,
    completed_on: "2026-06-17",
  };

  it("patches the scores in Turso, then the Airtable row (known-good control)", async () => {
    const { log, updates, writer } = await run();
    before(log, `turso:patch:${Object.keys(TURSO_SCORES).join(",")}`, (l) =>
      l.startsWith("airtable:Reports:Lighthouse"),
    );
    expect(writer.patches[0]).toEqual({ id: REPORT_ID, patch: TURSO_SCORES });
    expect(updates.find((u) => u.table === "Reports" && "Completed on" in u.fields)).toEqual({
      table: "Reports",
      id: REPORT_ID,
      fields: {
        "Lighthouse — Performance": 87,
        "Lighthouse — Accessibility": 91,
        "Lighthouse — Best Practices": 100,
        "Lighthouse — SEO": 95,
        "Completed on": "2026-06-17",
      },
    });
  });

  it("a failed Airtable refresh still lands the Turso patch and still errors the site", async () => {
    const { writer, results } = await run("reports");
    expect(writer.patches).toEqual([{ id: REPORT_ID, patch: TURSO_SCORES }]);
    expect(results).toEqual([{ site: "Acme Co", status: "error", message: QUOTA }]);
  });
});

describe("announce stores the preview body in Turso before the Airtable upload", () => {
  it("writes the body, then uploads it (known-good control)", async () => {
    const { log, writer } = await run();
    before(log, "turso:body", (l) => l === "airtable:upload:Rendered HTML");
    expect(writer.bodies).toHaveLength(1);
  });

  it("a failed upload still lands the body in Turso, warns, and the site still drafts", async () => {
    const { writer, warned, results } = await run("upload");
    expect(writer.bodies).toHaveLength(1);
    expect(writer.bodies[0]!.id).toBe(REPORT_ID);
    expect(writer.bodies[0]!.html).toContain("Acme Co");
    expect(warned).toContain(
      `⚠ Announcement preview upload skipped for Acme Co: Airtable upload failed: 429 Too Many Requests ${QUOTA}`,
    );
    expect(results[0]).toMatchObject({ status: "reused", reportId: REPORT_ID, queued: true });
  });
});
