import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "../../src/recipes/launch.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { mapRow as mapReportRow } from "../../src/reports/airtable/reports.js";
import type { AuditResult, RecipeResult } from "../../src/types.js";
import { makeFakeReportWriter } from "../reports/_helpers/fake-report-writer.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const TODAY = new Date();
const TODAY_YMD = TODAY.toISOString().slice(0, 10);
const PERIOD = TODAY.toISOString().slice(0, 7);
const REPORT_ID = "rec_existing_launch";
const QUOTA = "Airtable monthly API call quota exhausted";

let checkoutDir = "";

beforeAll(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), "turso-first-launch-"));
  await mkdir(join(checkoutDir, "src/routes"), { recursive: true });
});

afterAll(async () => {
  await rm(checkoutDir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

type Update = { table: string; id: string; fields: Record<string, unknown> };

function orderedBase(
  log: string[],
  updates: Update[],
  failWhen: (u: Update) => boolean,
): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      const u = { table, id: records[0]!.id, fields: records[0]!.fields };
      log.push(`airtable:${table}:${Object.keys(u.fields).join(",")}`);
      updates.push(u);
      if (failWhen(u)) {
        throw Object.assign(new Error(QUOTA), { code: "AIRTABLE_QUOTA_EXHAUSTED" });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

function uploadFetch(log: string[], status: number) {
  return vi.fn(async (url: string) => {
    log.push(`airtable:upload:${decodeURIComponent(String(url).split("/").at(-2)!)}`);
    return {
      ok: status === 200,
      status,
      statusText: status === 200 ? "OK" : "Too Many Requests",
      text: async () => (status === 200 ? "" : QUOTA),
    };
  }) as unknown as typeof global.fetch;
}

const lighthouse: AuditResult = {
  audit: "lighthouse",
  site: "Acme Co",
  status: "pass",
  summary: "lighthouse ok",
  details: {
    summary: { performance: 0.87, accessibility: 0.91, "best-practices": 1.0, seo: 0.95 },
  },
};

async function run(opts: { failReports?: boolean; uploadStatus?: number } = {}) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log: string[] = [];
  const updates: Update[] = [];
  global.fetch = uploadFetch(log, opts.uploadStatus ?? 200);
  const base = orderedBase(
    log,
    updates,
    (u) => Boolean(opts.failReports) && u.table === "Reports" && "Completed on" in u.fields,
  );
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
  const reportMirror = {
    ...writer,
    patch: async (id: string, patch: Parameters<typeof writer.patch>[1]) => {
      log.push(`turso:patch:${Object.keys(patch).join(",")}`);
      await writer.patch(id, patch);
    },
    body: async (id: string, html: string) => {
      log.push("turso:body");
      await writer.body(id, html);
    },
  };
  const result = await launch(
    { path: checkoutDir, name: "Acme Co" },
    {
      base,
      roster: async () => [
        makeWebsiteRow({ id: "rec_site_acme", name: "Acme Co", status: "launching" }),
      ],
      reportMirror,
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
  return { result, log, updates, writer, warned: warn.mock.calls.flat().join("\n") };
}

const TURSO_SCORES = {
  lighthouse_performance: 87,
  lighthouse_accessibility: 91,
  lighthouse_best_practices: 100,
  lighthouse_seo: 95,
  completed_on: TODAY_YMD,
};

describe("launch reuse path refreshes the Turso row before the Airtable shadow", () => {
  it("patches the scores in Turso, then writes the same refresh to Airtable (known-good control)", async () => {
    const { result, log, updates, writer } = await run();
    expect(result.complete).toBe(true);
    const turso = log.indexOf(`turso:patch:${Object.keys(TURSO_SCORES).join(",")}`);
    const airtable = log.findIndex(
      (l) => l.startsWith("airtable:Reports:") && l.includes("Completed on"),
    );
    expect(turso).toBeGreaterThanOrEqual(0);
    expect(airtable).toBeGreaterThan(turso);
    expect(writer.patches[0]).toEqual({ id: REPORT_ID, patch: TURSO_SCORES });
    expect(updates.find((u) => u.table === "Reports" && "Completed on" in u.fields)).toEqual({
      table: "Reports",
      id: REPORT_ID,
      fields: {
        "Lighthouse — Performance": 87,
        "Lighthouse — Accessibility": 91,
        "Lighthouse — Best Practices": 100,
        "Lighthouse — SEO": 95,
        "Completed on": TODAY_YMD,
      },
    });
  });

  it("a failed Airtable score refresh still lands the Turso patch, and still fails the draft step", async () => {
    const { result, writer } = await run({ failReports: true });
    expect(writer.patches).toEqual([{ id: REPORT_ID, patch: TURSO_SCORES }]);
    expect(result.complete).toBe(false);
    expect(result.steps.at(-1)).toEqual({
      name: "draft",
      result: { kind: "error", message: QUOTA },
    });
  });
});

describe("launch stores the preview body in Turso before the Airtable upload", () => {
  it("writes the body, then uploads it (known-good control)", async () => {
    const { result, log, writer } = await run();
    expect(result.complete).toBe(true);
    const turso = log.indexOf("turso:body");
    const upload = log.indexOf("airtable:upload:Rendered HTML");
    expect(turso).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(turso);
    expect(writer.bodies).toHaveLength(1);
  });

  it("a failed upload still lands the body in Turso, warns, and the launch completes", async () => {
    const { result, writer, warned } = await run({ uploadStatus: 429 });
    expect(writer.bodies).toHaveLength(1);
    expect(writer.bodies[0]!.id).toBe(REPORT_ID);
    expect(writer.bodies[0]!.html).toContain("Acme Co");
    expect(warned).toContain(
      `⚠ Launch preview upload skipped for Acme Co: Airtable upload failed: 429 Too Many Requests ${QUOTA}`,
    );
    expect(result.complete).toBe(true);
  });
});
