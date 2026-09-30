import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * P1-28: a withdraw is a TURSO write, on the same footing as approve-report.
 *
 * Nothing is mocked: the handler opens a real libSQL database — a throwaway
 * `file:` database in a temp dir (not `:memory:`, because every openDb on
 * `:memory:` is a brand-new empty database and the handler opens its own).
 * TURSO_DATABASE_URL is overwritten and TURSO_AUTH_TOKEN deleted for every test,
 * so an operator shell with real Turso credentials exported can never point this
 * suite at production.
 */

import withdrawReportHandler from "../../netlify/functions/withdraw-report.mjs";
import approveReportHandler from "../../netlify/functions/approve-report.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { gatingFields } from "../../src/reports/checklist.js";
import { sql } from "kysely";

/** Auto-evidence that clears the health gate for a Maintenance report. Derived
 *  from the PRODUCTION gating list rather than a hand-copied set of field names,
 *  so a new gating field cannot silently turn every seed below into a
 *  `send-blocked` 409 that looks like a handler regression. */
const CLEAN_EVIDENCE = JSON.stringify(
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass", checkedAt: "2026-09-01T00:00:00.000Z", note: "seeded" },
    ]),
  ),
);

// "op:s3cret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

// A fresh directory per test, removed after it: no test can open a database
// another test (or another file in the same worker) left behind.
let dir: string;
let db: Db;

async function post(
  id: string,
  opts: { action?: "withdraw" | "approve"; headers?: Record<string, string> } = {},
): Promise<Response> {
  const action = opts.action ?? "withdraw";
  const req = new Request(`https://x/api/reports/${id}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.headers ?? { authorization: AUTH }),
    },
  });
  const handler = action === "withdraw" ? withdrawReportHandler : approveReportHandler;
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return handler(req, { params: { id } });
}

/** A site clear of every approve blocker: recipients, a decodable header image. */
async function seedSite(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db
    .insertInto("sites")
    .values({
      id,
      slug: `site-${id.toLowerCase()}`,
      name: `Site ${id}`,
      url: "https://example.com",
      status: "Maintained",
      report_recipients_to: "client@example.com",
      header_image_filename: "header.png",
      header_image_type: "image/png",
      ...over,
    } as never)
    .execute();
}

/** A report clear of every approve blocker: draft-ready, unsent, four scores. */
async function seedReport(
  id: string,
  siteId: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insertInto("reports")
    .values({
      id,
      site_id: siteId,
      report_id: `${id}-2026-09`,
      report_type: "Maintenance",
      draft_ready: 1,
      approved_to_send: 0,
      sent_at: null,
      checklist_auto_evidence: CLEAN_EVIDENCE,
      lighthouse_performance: 98,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 96,
      lighthouse_seo: 100,
      ...over,
    } as never)
    .execute();
}

async function reportRow(id: string): Promise<Record<string, unknown> | undefined> {
  return (await db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst()) as
    Record<string, unknown> | undefined;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.DASHBOARD_PASSWORD = "s3cret";
  delete process.env.TURSO_AUTH_TOKEN;
  dir = mkdtempSync(join(tmpdir(), "withdraw-report-turso-"));
  const url = `file:${join(dir, "db.sqlite")}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("withdraw-report writes to Turso", () => {
  it("withdraws a pending draft — 200, and the stamp lands in Turso", async () => {
    await seedSite("recSiteA");
    await seedReport("recREP1", "recSiteA");
    const res = await post("recREP1");
    expect(await res.json()).toEqual({ status: "withdrawn", reportId: "recREP1" });
    expect(res.status).toBe(200);
    const row = await reportRow("recREP1");
    expect(typeof row?.withdrawn_at).toBe("string");
    expect(row?.withdrawn_by).toBe("dashboard");
    expect(row?.draft_ready).toBe(1);
    expect(row?.approved_to_send).toBe(0);
  });

  it("a withdrawn draft can no longer be approved — 409, nothing written", async () => {
    await seedSite("recSiteB");
    await seedReport("recREP2", "recSiteB");
    expect((await post("recREP2")).status).toBe(200);
    const res = await post("recREP2", { action: "approve" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recREP2", reason: "withdrawn" });
    expect((await reportRow("recREP2"))?.approved_to_send).toBe(0);
  });

  it("withdrawing twice is an idempotent 200 no-op", async () => {
    await seedSite("recSiteC");
    await seedReport("recREP3", "recSiteC", { withdrawn_at: "2026-09-29T00:00:00.000Z" });
    const res = await post("recREP3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP3",
      reason: "already-withdrawn",
    });
    expect((await reportRow("recREP3"))?.withdrawn_at).toBe("2026-09-29T00:00:00.000Z");
  });

  it.each([
    ["already-sent", { sent_at: "2026-09-01T12:00:00.000Z" }],
    ["already-approved", { approved_to_send: 1 }],
    ["not-draft-ready", { draft_ready: 0 }],
  ] as const)("refuses (%s) with 409 and writes nothing", async (reason, over) => {
    await seedSite("recSiteD");
    await seedReport("recREP4", "recSiteD", over);
    const res = await post("recREP4");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recREP4", reason });
    expect((await reportRow("recREP4"))?.withdrawn_at).toBeNull();
  });
});

describe("withdraw-report: the gates", () => {
  it("an unauthenticated POST is refused before anything is written", async () => {
    await seedSite("recSiteE");
    await seedReport("recREP5", "recSiteE");
    const res = await post("recREP5", { headers: {} });
    expect(res.status).toBe(401);
    expect((await reportRow("recREP5"))?.withdrawn_at).toBeNull();
  });

  it("a cross-site POST is refused with 403 before auth", async () => {
    await seedSite("recSiteF");
    await seedReport("recREP6", "recSiteF");
    const res = await post("recREP6", {
      headers: { authorization: AUTH, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect((await reportRow("recREP6"))?.withdrawn_at).toBeNull();
  });

  it("a GET is a health check and a PUT is 405", async () => {
    const get = await withdrawReportHandler(new Request("https://x/api/reports/r/withdraw"), {
      params: { id: "r" },
    } as never);
    expect(get.status).toBe(200);
    const put = await withdrawReportHandler(
      new Request("https://x/api/reports/r/withdraw", { method: "PUT" }),
      { params: { id: "r" } } as never,
    );
    expect(put.status).toBe(405);
  });

  it("a missing report id is a 404", async () => {
    expect((await post("recNOSUCHROW")).status).toBe(404);
  });

  it("the TURSO_DATABASE_URL gate — a 500", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("recREP1");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Turso env missing");
    err.mockRestore();
  });

  it("a refused Turso write is a 502, and nothing is withdrawn", async () => {
    await seedSite("recSiteG");
    await seedReport("recREPG", "recSiteG");
    await sql`CREATE TRIGGER refuse_report_update BEFORE UPDATE ON reports BEGIN SELECT RAISE(ABORT, 'turso write refused'); END`.execute(
      db,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("recREPG");
    expect(res.status).toBe(502);
    expect((await reportRow("recREPG"))?.withdrawn_at).toBeNull();
    err.mockRestore();
  });
});
