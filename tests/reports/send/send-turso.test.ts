/**
 * #646 step 4: the nightly send reads its QUEUE, its ROSTER and its HEADER PLATE
 * from Turso, and writes its sent stamp there.
 *
 * The rest of the send suite injects those from in-memory fixtures, because what
 * it pins is the send's own behaviour. This file wires what the CLI wires —
 * `listSendableReports`, `listSites`, `loadHeaderImage` and `mirrorReportPatch`
 * over a REAL migrated libSQL database in a temp `file:` (never `:memory:`, never
 * a `TURSO_*` url from the environment).
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
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
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

describe("the send path, read from Turso", () => {
  it("sends a queued report from Turso alone — queue, roster and header plate — and stamps it there", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });

    expect(res.code).toBe(0);
    expect(res.output).toContain("✓ sent:");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.to).toEqual(["owner@turso.example.com"]);
    // The plate came from the database, and no attachment was fetched (the stubbed
    // fetch above throws if one is).
    expect(log.mock.calls.flat().join("\n")).toContain(
      `REPORT_SEND report=Turso Co — Maintenance — 2026-09-17 site=Turso Co header=turso`,
    );
    const stamped = await db
      .selectFrom("reports")
      .select(["sent_at", "resend_message_id"])
      .where("id", "=", REPORT)
      .executeTakeFirstOrThrow();
    expect(stamped.sent_at).not.toBeNull();
    expect(stamped.resend_message_id).toBe("msg_turso_1");
    expect(await listSendableReports(db)).toEqual([]);
  });

  it("a report that is not approved is not in the queue at all", async () => {
    await db.updateTable("reports").set({ approved_to_send: 0 }).where("id", "=", REPORT).execute();
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(captured).toHaveLength(0);
  });

  it("no plate in Turso: the report fails, naming the command that fixes it", async () => {
    await db
      .updateTable("sites")
      .set({ header_image: null, header_image_filename: null, header_image_type: null })
      .where("id", "=", SITE)
      .execute();
    const { client, captured } = captureClient();
    const res = await sendApprovedReports({ ...io(), resend: client });
    expect(res.code).toBe(1);
    expect(res.output).toContain(
      "no Header image: no header plate in Turso — run `reddoor-maint header-image turso-co --write-back`",
    );
    expect(captured).toHaveLength(0);
    expect((await listSendableReports(db)).map((r) => r.id)).toEqual([REPORT]);
  });
});
