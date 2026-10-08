import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #1262: unapprove is a TURSO write on the same footing as approve and withdraw.
 * Real handler, real libSQL in a temp `file:` database per test, TURSO_*
 * overwritten. Races are made deterministic the way approve-withdraw-race.test.ts
 * makes them: the competing write runs right after the handler's read returns.
 */
const race = vi.hoisted(() => ({ afterRead: null as null | (() => Promise<void>) }));

vi.mock("../../src/db/fleet-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/fleet-state.js")>();
  return {
    ...actual,
    getReportById: async (...args: Parameters<typeof actual.getReportById>) => {
      const row = await actual.getReportById(...args);
      const competing = race.afterRead;
      race.afterRead = null;
      if (competing) await competing();
      return row;
    },
  };
});

import unapproveReportHandler from "../../netlify/functions/unapprove-report.mjs";
import approveReportHandler from "../../netlify/functions/approve-report.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { getReportById, storeLighthouseScores } from "../../src/db/fleet-state.js";
import { isPendingApproval } from "../../src/reports/report-row.js";
import { gatingFields } from "../../src/reports/checklist.js";

const CLEAN_EVIDENCE = JSON.stringify(
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass", checkedAt: "2026-10-01T00:00:00.000Z", note: "seeded" },
    ]),
  ),
);
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");
const ORIGINAL_ENV = { ...process.env };
const APPROVED = {
  approved_to_send: 1,
  approved_at: "2026-10-08T15:11:12.000Z",
  approved_by: "dashboard",
};

let dir: string;
let db: Db;

async function post(
  id: string,
  opts: { action?: "unapprove" | "approve"; headers?: Record<string, string> } = {},
): Promise<Response> {
  const action = opts.action ?? "unapprove";
  const req = new Request(`https://x/api/reports/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.headers ?? { authorization: AUTH }) },
  });
  const handler = action === "unapprove" ? unapproveReportHandler : approveReportHandler;
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return handler(req, { params: { id } });
}

async function seedReport(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db
    .insertInto("reports")
    .values({
      id,
      site_id: "recSite",
      report_id: `${id}-2026-10`,
      report_type: "Maintenance",
      draft_ready: 1,
      sent_at: null,
      checklist_auto_evidence: CLEAN_EVIDENCE,
      lighthouse_performance: 98,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 78,
      lighthouse_seo: 100,
      ...APPROVED,
      ...over,
    } as never)
    .execute();
}

async function row(id: string) {
  return db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

const competing = (id: string, set: Record<string, unknown>) => async () => {
  await db.updateTable("reports").set(set).where("id", "=", id).execute();
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "unapprove-report-turso-"));
  process.env = { ...ORIGINAL_ENV, DASHBOARD_PASSWORD: "s3cret" };
  delete process.env.TURSO_AUTH_TOKEN;
  const url = `file:${join(dir, "db.sqlite")}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
  await db
    .insertInto("sites")
    .values({
      id: "recSite",
      slug: "site",
      name: "Site",
      url: "https://example.com",
      status: "Maintained",
      report_recipients_to: "client@example.com",
      header_image_filename: "header.png",
      header_image_type: "image/png",
    } as never)
    .execute();
});

afterEach(async () => {
  race.afterRead = null;
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("unapprove-report writes to Turso", () => {
  it("clears the approval and stamps who took it back and when — 200", async () => {
    await seedReport("recREP1");
    const res = await post("recREP1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unapproved", reportId: "recREP1" });
    const r = await row("recREP1");
    expect(r.approved_to_send).toBe(0);
    expect(r.approved_at).toBeNull();
    expect(r.approved_by).toBeNull();
    expect(r.unapproved_by).toBe("dashboard");
    expect(r.unapproved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.sent_at).toBeNull();
    expect(r.draft_ready).toBe(1);
  });

  it("the report is pending again, so refresh preview's score write lands", async () => {
    await seedReport("recREP2");
    const scores = { performance: 98, accessibility: 100, bestPractices: 100, seo: 100 };
    expect(await storeLighthouseScores(db, "recREP2", scores)).toBe(false);
    expect((await post("recREP2")).status).toBe(200);
    const after = await getReportById(db, "recREP2");
    expect(after && isPendingApproval(after)).toBe(true);
    expect(await storeLighthouseScores(db, "recREP2", scores)).toBe(true);
    expect((await row("recREP2")).lighthouse_best_practices).toBe(100);
  });

  it("an override approval is cleared with it, so a later plain approve cannot inherit the bypass", async () => {
    await seedReport("recREP3", {
      send_override: 1,
      override_reason: "client asked",
      override_by: "dashboard",
      override_at: "2026-10-08T15:11:12.000Z",
    });
    expect((await post("recREP3")).status).toBe(200);
    const r = await row("recREP3");
    expect(r.send_override).toBe(0);
    expect(r.override_reason).toBe("client asked");
  });

  it("it can be approved again afterwards", async () => {
    await seedReport("recREP4");
    expect((await post("recREP4")).status).toBe(200);
    expect((await post("recREP4", { action: "approve" })).status).toBe(200);
    expect((await row("recREP4")).approved_to_send).toBe(1);
  });

  it("a sent report is a 409 no-op (already-sent) and nothing is written", async () => {
    await seedReport("recREP5", { sent_at: "2026-10-09T09:23:00.000Z" });
    const res = await post("recREP5");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP5",
      reason: "already-sent",
    });
    const r = await row("recREP5");
    expect(r.approved_to_send).toBe(1);
    expect(r.unapproved_at).toBeNull();
  });

  it("a withdrawn report is a 409 no-op (withdrawn) and nothing is written", async () => {
    await seedReport("recREP6", { withdrawn_at: "2026-10-08T00:00:00.000Z" });
    const res = await post("recREP6");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recREP6", reason: "withdrawn" });
    expect((await row("recREP6")).unapproved_at).toBeNull();
  });

  it("a report already unapproved is an idempotent 200 no-op (not-approved)", async () => {
    await seedReport("recREP7", {
      approved_to_send: 0,
      approved_at: null,
      approved_by: null,
      unapproved_at: "2026-10-08T15:20:00.000Z",
      unapproved_by: "dashboard",
    });
    const res = await post("recREP7");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP7",
      reason: "not-approved",
    });
    expect((await row("recREP7")).unapproved_at).toBe("2026-10-08T15:20:00.000Z");
  });

  it("a missing report id is a 404", async () => {
    expect((await post("recNOSUCHROW")).status).toBe(404);
  });
});

describe("unapprove-report races", () => {
  it("control: with no competing write the unapprove lands", async () => {
    await seedReport("recR0");
    race.afterRead = async () => {};
    expect((await post("recR0")).status).toBe(200);
    expect((await row("recR0")).approved_to_send).toBe(0);
  });

  it("a send stamped between the read and the write wins: 409 already-sent, still approved", async () => {
    await seedReport("recR1");
    race.afterRead = competing("recR1", { sent_at: "2026-10-09T09:23:05.000Z" });
    const res = await post("recR1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recR1", reason: "already-sent" });
    const r = await row("recR1");
    expect(r.approved_to_send).toBe(1);
    expect(r.approved_at).toBe(APPROVED.approved_at);
    expect(r.unapproved_at).toBeNull();
  });

  it("a withdraw landing between the read and the write: 409 withdrawn, nothing unapproved", async () => {
    await seedReport("recR2");
    race.afterRead = competing("recR2", { withdrawn_at: "2026-10-08T15:30:00.000Z" });
    const res = await post("recR2");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recR2", reason: "withdrawn" });
    expect((await row("recR2")).unapproved_at).toBeNull();
  });

  it("a second unapprove landing first: the late one is a 200 no-op (not-approved)", async () => {
    await seedReport("recR3");
    race.afterRead = competing("recR3", { approved_to_send: 0, approved_at: null });
    const res = await post("recR3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "noop", reportId: "recR3", reason: "not-approved" });
    expect((await row("recR3")).unapproved_at).toBeNull();
  });
});

describe("unapprove-report: the gates", () => {
  it("an unauthenticated POST is refused before anything is written", async () => {
    await seedReport("recG1");
    const res = await post("recG1", { headers: {} });
    expect(res.status).toBe(401);
    expect((await row("recG1")).approved_to_send).toBe(1);
  });

  it("a wrong password is refused before anything is written", async () => {
    await seedReport("recG2");
    const bad = "Basic " + Buffer.from("op:nope").toString("base64");
    const res = await post("recG2", { headers: { authorization: bad } });
    expect(res.status).toBe(401);
    expect((await row("recG2")).approved_to_send).toBe(1);
  });

  it("a cross-site POST is refused with 403 before auth", async () => {
    await seedReport("recG3");
    const res = await post("recG3", {
      headers: { authorization: AUTH, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect((await row("recG3")).approved_to_send).toBe(1);
  });

  it("a GET is a health check and a PUT is 405", async () => {
    const get = await unapproveReportHandler(new Request("https://x/api/reports/r/unapprove"), {
      params: { id: "r" },
    } as never);
    expect(get.status).toBe(200);
    const put = await unapproveReportHandler(
      new Request("https://x/api/reports/r/unapprove", { method: "PUT" }),
      { params: { id: "r" } } as never,
    );
    expect(put.status).toBe(405);
  });

  it("the TURSO_DATABASE_URL gate — a 500", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("recG4");
    expect(res.status).toBe(500);
    err.mockRestore();
  });
});
