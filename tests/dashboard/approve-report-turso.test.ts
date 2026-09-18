import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #539 Phase 6 (#646): an approve is a TURSO write with an Airtable shadow, so
 * it must keep working once `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` are pulled —
 * the same gate dropped from `resend-webhook`
 * (https://github.com/reddoorla/reddoor-maintenance/pull/855) and from
 * `report-commentary` (https://github.com/reddoorla/reddoor-maintenance/pull/868).
 *
 * Nothing on the Turso side is mocked: the handler opens a real libSQL database
 * — a throwaway `file:` database in a temp dir (not `:memory:`, because every
 * openDb on `:memory:` is a brand-new empty database and the handler opens its
 * own). TURSO_DATABASE_URL is overwritten and TURSO_AUTH_TOKEN deleted for every
 * test, so an operator shell with real Turso credentials exported can never
 * point this suite at production.
 *
 * Only the Airtable I/O is mocked, so the shadow write can be observed and made
 * to fail, and so no test can reach a real base.
 *
 * The authorization gates this endpoint carries — CSRF, Basic auth, the
 * already-sent guard, the draft-ready gate and the send-blocker gate — are
 * asserted here too: dropping the env gate must not move any of them.
 */

// Partial mock: only the two Airtable writers are replaced. The module's pure
// exports stay real, because the Turso reader (src/db/fleet-state.ts) imports
// its row coercers through this module.
vi.mock("../../src/reports/airtable/reports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/airtable/reports.js")>()),
  approveReportRow: vi.fn(),
  overrideReportRow: vi.fn(),
}));
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));
import { approveReportRow, overrideReportRow } from "../../src/reports/airtable/reports.js";
import { openBase } from "../../src/reports/airtable/client.js";
import approveReportHandler from "../../netlify/functions/approve-report.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { gatingFields } from "../../src/reports/checklist.js";

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

const shadowApprove = vi.mocked(approveReportRow);
const shadowOverride = vi.mocked(overrideReportRow);
const openBaseMock = vi.mocked(openBase);

// "op:s3cret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

const DIR = mkdtempSync(join(tmpdir(), "approve-report-turso-"));
let dbSeq = 0;
let db: Db;

async function post(
  id: string,
  opts: {
    override?: boolean;
    reason?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const qs = opts.override ? "?override=1" : "";
  const req = new Request(`https://x/api/reports/${id}/approve${qs}`, {
    method: "POST",
    ...(opts.override ? { body: JSON.stringify({ reason: opts.reason ?? "" }) } : {}),
    headers: {
      "content-type": "application/json",
      ...(opts.headers ?? { authorization: AUTH }),
    },
  });
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return approveReportHandler(req, { params: { id } });
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
  delete process.env.AIRTABLE_PAT;
  delete process.env.AIRTABLE_BASE_ID;
  const url = `file:${join(DIR, `db-${++dbSeq}.sqlite`)}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
  shadowApprove.mockReset();
  shadowApprove.mockResolvedValue(undefined);
  shadowOverride.mockReset();
  shadowOverride.mockResolvedValue(undefined);
  openBaseMock.mockClear();
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("approve-report with NO Airtable env (the post-unplug world)", () => {
  it("approves — 200, not 'Airtable env missing', and the flag lands in Turso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteA");
    await seedReport("recREP1", "recSiteA");
    const res = await post("recREP1");
    expect(await res.json()).toEqual({ status: "approved", reportId: "recREP1" });
    expect(res.status).toBe(200);
    // The approval actually LANDS in the store the send batch reads.
    const row = await reportRow("recREP1");
    expect(row?.approved_to_send).toBe(1);
    expect(row?.approved_by).toBe("dashboard");
    expect(typeof row?.approved_at).toBe("string");
    expect(shadowApprove).not.toHaveBeenCalled();
    // No Airtable client is even constructed without credentials.
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "AIRTABLE_SHADOW skipped=env-absent record=recREP1",
    );
    warn.mockRestore();
  });

  it("the logged override still stamps its full audit trail in Turso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteB");
    await seedReport("recREP2", "recSiteB");
    const res = await post("recREP2", { override: true, reason: "client asked for it today" });
    expect(await res.json()).toEqual({
      status: "overridden",
      reportId: "recREP2",
      reason: "client asked for it today",
    });
    expect(res.status).toBe(200);
    const row = await reportRow("recREP2");
    expect(row?.send_override).toBe(1);
    expect(row?.override_reason).toBe("client asked for it today");
    expect(row?.override_by).toBe("dashboard");
    expect(typeof row?.override_at).toBe("string");
    // overrideReportRow flips Approved to send with the SAME stamp — the mirror
    // must match it field-for-field, shadow or no shadow.
    expect(row?.approved_to_send).toBe(1);
    expect(row?.approved_at).toBe(row?.override_at);
    expect(row?.approved_by).toBe("dashboard");
    expect(shadowOverride).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "AIRTABLE_SHADOW skipped=env-absent record=recREP2",
    );
    warn.mockRestore();
  });

  it("a HALF-configured Airtable env skips the shadow too, and still approves", async () => {
    process.env.AIRTABLE_PAT = "pat_only";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteC");
    await seedReport("recREP3", "recSiteC");
    const res = await post("recREP3");
    expect(res.status).toBe(200);
    expect((await reportRow("recREP3"))?.approved_to_send).toBe(1);
    expect(shadowApprove).not.toHaveBeenCalled();
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain("AIRTABLE_SHADOW skipped=env-partial");
    warn.mockRestore();
  });

  it("a minted report_<ULID> id is served too (its shadow would skip anyway)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("site_01K5F0RZ2N9Q7M3V8T4H6XW1AB");
    await seedReport("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB", "site_01K5F0RZ2N9Q7M3V8T4H6XW1AB");
    const res = await post("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB");
    expect(res.status).toBe(200);
    expect((await reportRow("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB"))?.approved_to_send).toBe(1);
    warn.mockRestore();
  });
});

describe("approve-report: the authorization gates are untouched by the env drop", () => {
  it("an unauthenticated POST is refused before anything is written", async () => {
    await seedSite("recSiteD");
    await seedReport("recREP4", "recSiteD");
    const res = await post("recREP4", { headers: {} });
    expect(res.status).toBe(401);
    expect((await reportRow("recREP4"))?.approved_to_send).toBe(0);
    expect(shadowApprove).not.toHaveBeenCalled();
  });

  it("a cross-site POST is refused with 403 before auth", async () => {
    await seedSite("recSiteE");
    await seedReport("recREP5", "recSiteE");
    const res = await post("recREP5", {
      headers: { authorization: AUTH, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect((await reportRow("recREP5"))?.approved_to_send).toBe(0);
  });

  it("an already-SENT report is still a no-op, and Turso is untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteF");
    await seedReport("recREP6", "recSiteF", { sent_at: "2026-09-01T12:00:00.000Z" });
    const res = await post("recREP6");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP6",
      reason: "already-sent",
    });
    expect((await reportRow("recREP6"))?.approved_to_send).toBe(0);
    warn.mockRestore();
  });

  it("a not-yet-draft-ready report is still a no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteG");
    await seedReport("recREP7", "recSiteG", { draft_ready: 0 });
    const res = await post("recREP7");
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP7",
      reason: "not-draft-ready",
    });
    expect((await reportRow("recREP7"))?.approved_to_send).toBe(0);
    warn.mockRestore();
  });

  it("the send-blocker gate still refuses with 409 and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No recipients and no header image → two `fail` blockers.
    await seedSite("recSiteH", {
      report_recipients_to: null,
      point_of_contact: null,
      header_image_filename: null,
      header_image_type: null,
    });
    await seedReport("recREP8", "recSiteH");
    const res = await post("recREP8");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { status: string; reason: string; blockers: string[] };
    expect(body.status).toBe("blocked");
    expect(body.reason).toBe("send-blocked");
    expect(body.blockers.join("\n")).toContain("recipients-missing");
    expect(body.blockers.join("\n")).toContain("header-image-missing");
    expect((await reportRow("recREP8"))?.approved_to_send).toBe(0);
    expect(shadowApprove).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an override with an EMPTY reason is still refused — no bypass", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteI");
    await seedReport("recREP9", "recSiteI");
    const res = await post("recREP9", { override: true, reason: "   " });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      status: "blocked",
      reportId: "recREP9",
      reason: "override-reason-required",
    });
    const row = await reportRow("recREP9");
    expect(row?.send_override).toBe(0);
    expect(row?.approved_to_send).toBe(0);
    warn.mockRestore();
  });

  it("an override does NOT bypass the infra blockers either", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedSite("recSiteJ", { report_recipients_to: null, point_of_contact: null });
    await seedReport("recREP10", "recSiteJ");
    const res = await post("recREP10", { override: true, reason: "send it anyway" });
    expect(res.status).toBe(409);
    expect((await reportRow("recREP10"))?.send_override).toBe(0);
    warn.mockRestore();
  });

  it("a missing report id is still a 404", async () => {
    const res = await post("recNOSUCHROW");
    expect(res.status).toBe(404);
  });

  it("the TURSO_DATABASE_URL gate is untouched — still a 500", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("recREP1");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Turso env missing");
    err.mockRestore();
  });
});

describe("approve-report WITH Airtable env (the rollback-window world)", () => {
  beforeEach(() => {
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "appTestBase";
  });

  // The positive control: this is the behaviour that already ships, so it must
  // pass on origin/main as well as on this branch. If the harness itself were
  // broken (auth, routing, the temp db, the blocker seeds) this test would fail
  // too, and no FAIL above could be trusted.
  it("still writes the Airtable shadow, and the approval lands in Turso", async () => {
    await seedSite("recSiteK");
    await seedReport("recREP11", "recSiteK");
    const res = await post("recREP11");
    expect(res.status).toBe(200);
    expect((await reportRow("recREP11"))?.approved_to_send).toBe(1);
    expect(shadowApprove).toHaveBeenCalledWith(
      expect.anything(),
      "recREP11",
      expect.any(Date),
      "dashboard",
    );
  });

  it("still writes the override shadow", async () => {
    await seedSite("recSiteL");
    await seedReport("recREP12", "recSiteL");
    const res = await post("recREP12", { override: true, reason: "deadline" });
    expect(res.status).toBe(200);
    expect(shadowOverride).toHaveBeenCalledWith(
      expect.anything(),
      "recREP12",
      expect.any(Date),
      "dashboard",
      "deadline",
    );
  });

  it("a failing shadow still reds the request, AFTER the approval landed in Turso", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await seedSite("recSiteM");
    await seedReport("recREP13", "recSiteM");
    shadowApprove.mockRejectedValueOnce(new Error("Airtable 503"));
    const res = await post("recREP13");
    expect(res.status).toBe(502);
    // The authoritative store is written FIRST, so the outage costs only the
    // shadow — the operator's approve is not lost with it.
    expect((await reportRow("recREP13"))?.approved_to_send).toBe(1);
    err.mockRestore();
  });

  it("a failing OVERRIDE shadow reds the request, after the audit trail landed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await seedSite("recSiteN");
    await seedReport("recREP14", "recSiteN");
    shadowOverride.mockRejectedValueOnce(new Error("Airtable 503"));
    const res = await post("recREP14", { override: true, reason: "deadline" });
    expect(res.status).toBe(502);
    const row = await reportRow("recREP14");
    expect(row?.send_override).toBe(1);
    expect(row?.override_reason).toBe("deadline");
    expect(row?.approved_to_send).toBe(1);
    err.mockRestore();
  });
});
