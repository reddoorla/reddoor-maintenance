/**
 * #1262 (Operator decisions 100): an unapprove racing the send batch, through the
 * real send loop and the real unapprove handler over one temp libSQL database.
 * Before the claim, an unapprove fired during the Resend call answered 200
 * "unapproved" while the email went out, leaving the row unapproved and sent.
 * The setup is send-turso.test.ts's; TURSO_* is overwritten so the handler opens
 * the same temp database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../../src/db/client.js";
import {
  listSendableReports,
  listSites,
  mirrorReportPatch,
  mirrorSiteInsert,
  claimReportForSend,
  releaseSendClaim,
} from "../../../src/db/fleet-state.js";
import { storeHeaderImage, loadHeaderImage } from "../../../src/db/header-images.js";
import unapproveReportHandler from "../../../netlify/functions/unapprove-report.mjs";
import { sendApprovedReports } from "../../../src/reports/send/orchestrate.js";
import type { ResendClient, ResendSendInput } from "../../../src/reports/send/resend.js";

// The real header pipeline needs sharp and a real JPEG; the plate's PROVENANCE is
// what this file is about, so the processing step is stubbed exactly as the rest
// of the send suite stubs it.
vi.mock("../../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

vi.mock("../../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn(async () => {}),
}));

const SITE = "recTURSOSITE";
const REPORT = "recTURSOREPORT";
const PLATE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

const ORIGINAL_ENV = { ...process.env };
let dir: string;
let db: Db;

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  return {
    captured,
    client: {
      async send(input) {
        captured.push(input);
        return { messageId: "msg_turso_1" };
      },
    },
  };
}

beforeEach(async () => {
  // The send fetches nothing: the plate comes from the database.
  global.fetch = vi.fn(async () => {
    throw new Error("the send fetched something — the Turso plate was not used");
  }) as unknown as typeof global.fetch;
  dir = mkdtempSync(join(tmpdir(), "send-turso-"));
  process.env = { ...ORIGINAL_ENV, DASHBOARD_PASSWORD: "s3cret" };
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "fleet.db")}`;
  db = await openDb({ url: process.env.TURSO_DATABASE_URL });
  await mirrorSiteInsert(
    db,
    {
      id: SITE,
      fields: {
        Name: "Turso Co",
        Status: "maintained",
        url: "https://turso.example.com",
        "Report recipients (To)": "owner@turso.example.com",
        pScore: 92,
        rScore: 100,
        bpScore: 96,
        seoScore: 94,
      },
    },
    "2026-09-17T00:00:00.000Z",
  );
  await storeHeaderImage(db, SITE, {
    bytes: PLATE,
    filename: "turso.jpg",
    contentType: "image/jpeg",
    generatedAt: "2026-09-17T00:00:00.000Z",
  });
  await db
    .insertInto("reports")
    .values({
      id: REPORT,
      report_id: "Turso Co — Maintenance — 2026-09-17",
      site_id: SITE,
      report_type: "Maintenance",
      period: "2026-09",
      period_start: "2026-08-17",
      period_end: "2026-09-17",
      completed_on: "2026-09-17",
      lighthouse_performance: 92,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 96,
      lighthouse_seo: 94,
      draft_ready: 1,
      approved_to_send: 1,
      send_override: 0,
      sent_at: null,
      // Every gating field pass — the health gate is not what this file is about.
      checklist_auto_evidence: JSON.stringify(
        Object.fromEntries(
          [
            "Maint: Deploy & Function Health",
            "Maint: CMS Checked",
            "Maint: Domain, DNS & SSL",
            "Maint: Google Indexed",
            "Maint: Security Updates",
            "Maint: Uptime Checked",
          ].map((f) => [f, { result: "pass", checkedAt: "2026-09-17T00:00:00.000Z", note: "" }]),
        ),
      ),
    })
    .execute();
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const io = () => ({
  sendable: () => listSendableReports(db),
  roster: () => listSites(db),
  loadHeaderPlate: async (siteId: string) => (await loadHeaderImage(db, siteId))?.bytes ?? null,
  claimForSend: (reportId: string, approvedAt: string | null, at: Date) =>
    claimReportForSend(db, reportId, approvedAt, at),
  releaseSendClaim: (reportId: string) => releaseSendClaim(db, reportId),
  reportSentMirror: async (reportId: string, sentAt: Date, messageId: string | null) => {
    await mirrorReportPatch(db, reportId, {
      sent_at: sentAt.toISOString(),
      ...(messageId !== null ? { resend_message_id: messageId } : {}),
    });
  },
  siteMirror: {
    health: async () => {},
    site: async () => {
      throw new Error("no Launch report here — the launch flip must not run");
    },
  },
});

const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

async function unapprove(): Promise<{ status: number; body: unknown }> {
  const res = await unapproveReportHandler(
    new Request(`https://x/api/reports/${REPORT}/unapprove`, {
      method: "POST",
      headers: { authorization: AUTH },
    }),
    { params: { id: REPORT } } as never,
  );
  return { status: res.status, body: await res.json() };
}

const state = () =>
  db
    .selectFrom("reports")
    .select(["approved_to_send", "sent_at", "send_started_at", "unapproved_at"])
    .where("id", "=", REPORT)
    .executeTakeFirstOrThrow();

describe("unapprove vs the send batch (Operator decisions 100)", () => {
  it("control: an unapprove before the queue read means nothing is sent", async () => {
    expect((await unapprove()).status).toBe(200);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(captured).toHaveLength(0);
  });

  it("an unapprove during the Resend call loses: 409 sending, and the row ends approved and sent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let during: { status: number; body: unknown } | null = null;
    const captured: ResendSendInput[] = [];
    const client: ResendClient = {
      async send(input) {
        during = await unapprove();
        captured.push(input);
        return { messageId: "msg_race" };
      },
    };
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(during).toEqual({
      status: 409,
      body: { status: "noop", reportId: REPORT, reason: "sending" },
    });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    const r = await state();
    expect(r.approved_to_send).toBe(1);
    expect(r.sent_at).not.toBeNull();
    expect(r.send_started_at).not.toBeNull();
    expect(r.unapproved_at).toBeNull();
  });

  it("an unapprove after the queue read but before the claim wins: no email, the report is skipped", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let during: { status: number; body: unknown } | null = null;
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({
      ...io(),
      resend: client,
      loadHeaderPlate: async (siteId: string) => {
        during = await unapprove();
        return (await loadHeaderImage(db, siteId))?.bytes ?? null;
      },
    });
    expect(during).toEqual({
      status: 200,
      body: { status: "unapproved", reportId: REPORT },
    });
    expect(captured).toHaveLength(0);
    expect(res.code).toBe(0);
    expect(res.output).toContain("skipped (unapproved or withdrawn since the queue was read)");
    const r = await state();
    expect(r.approved_to_send).toBe(0);
    expect(r.sent_at).toBeNull();
    expect(r.send_started_at).toBeNull();
  });

  it("unapprove, refresh and re-approve after the queue read: the stale copy is not sent, the next run sends the new one", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await db
      .updateTable("reports")
      .set({ approved_at: "2026-10-08T15:11:12.000Z" })
      .where("id", "=", REPORT)
      .execute();
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({
      ...io(),
      resend: client,
      loadHeaderPlate: async (siteId: string) => {
        expect((await unapprove()).status).toBe(200);
        await db
          .updateTable("reports")
          .set({
            lighthouse_performance: 37,
            approved_to_send: 1,
            approved_at: "2026-10-08T16:05:00.000Z",
          })
          .where("id", "=", REPORT)
          .execute();
        return (await loadHeaderImage(db, siteId))?.bytes ?? null;
      },
    });
    expect(captured).toHaveLength(0);
    expect(res.code).toBe(0);
    expect(res.output).toContain("skipped");
    const r = await state();
    expect(r.approved_to_send).toBe(1);
    expect(r.send_started_at).toBeNull();

    const next = captureClient();
    expect((await sendApprovedReports({ ...io(), resend: next.client })).code).toBe(0);
    expect(next.captured).toHaveLength(1);
    expect(next.captured[0]!.html).toContain("37");
  });

  it("a send Resend refuses outright drops its claim, so the report can still be unapproved", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client: ResendClient = {
      async send() {
        throw Object.assign(new Error("Resend error: Invalid `to` field."), {
          resendErrorName: "validation_error",
        });
      },
    };
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res.code).toBe(1);
    expect((await state()).send_started_at).toBeNull();
    expect(await unapprove()).toEqual({
      status: 200,
      body: { status: "unapproved", reportId: REPORT },
    });
  });

  it("an ambiguous send failure keeps its claim: the email may have left, so unapprove still loses", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const client: ResendClient = {
      async send() {
        throw Object.assign(
          new Error("Resend error: Unable to fetch data. The request could not be resolved."),
          { resendErrorName: "application_error" },
        );
      },
    };
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res.code).toBe(1);
    expect((await state()).send_started_at).not.toBeNull();
    expect((await unapprove()).status).toBe(409);
  });

  it("a claim whose run died before the stamp is re-claimed and sent by the next run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await db
      .updateTable("reports")
      .set({ send_started_at: "2026-10-08T16:07:03.000Z" })
      .where("id", "=", REPORT)
      .execute();
    expect((await unapprove()).status).toBe(409);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    const r = await state();
    expect(r.sent_at).not.toBeNull();
    expect(r.send_started_at).not.toBe("2026-10-08T16:07:03.000Z");
  });
});
