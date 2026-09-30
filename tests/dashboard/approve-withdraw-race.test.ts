import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * P1-28: approve and withdraw each read the row, decide, then write. The write
 * carries the state it decided on as a WHERE, so a withdraw that lands between
 * an approve's read and its write leaves the row unapproved (and the reverse).
 *
 * The race is made deterministic by wrapping the real `getReportById`: the
 * competing write runs right after the handler's read returns. Real handlers,
 * real libSQL in a temp `file:` database per test, TURSO_* overwritten.
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

import approveReportHandler from "../../netlify/functions/approve-report.mjs";
import withdrawReportHandler from "../../netlify/functions/withdraw-report.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { gatingFields } from "../../src/reports/checklist.js";

const CLEAN_EVIDENCE = JSON.stringify(
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass", checkedAt: "2026-09-01T00:00:00.000Z", note: "seeded" },
    ]),
  ),
);
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");
const ORIGINAL_ENV = { ...process.env };

let dir: string;
let db: Db;

async function post(id: string, action: "approve" | "withdraw", query = ""): Promise<Response> {
  const req = new Request(`https://x/api/reports/${id}/${action}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: AUTH },
    ...(query ? { body: JSON.stringify({ reason: "client asked" }) } : {}),
  });
  const handler = action === "approve" ? approveReportHandler : withdrawReportHandler;
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return handler(req, { params: { id } });
}

async function row(id: string) {
  return db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "approve-withdraw-race-"));
  process.env = { ...ORIGINAL_ENV, DASHBOARD_PASSWORD: "s3cret" };
  delete process.env.TURSO_AUTH_TOKEN;
  const url = `file:${join(dir, "race.sqlite")}`;
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
  await db
    .insertInto("reports")
    .values({
      id: "recREP",
      site_id: "recSite",
      report_id: "recREP-2026-09",
      report_type: "Maintenance",
      draft_ready: 1,
      approved_to_send: 0,
      sent_at: null,
      checklist_auto_evidence: CLEAN_EVIDENCE,
      lighthouse_performance: 98,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 96,
      lighthouse_seo: 100,
    } as never)
    .execute();
});

afterEach(async () => {
  race.afterRead = null;
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("approve vs withdraw races (P1-28)", () => {
  it("control: with no competing write the approve lands", async () => {
    const res = await post("recREP", "approve");
    expect(res.status).toBe(200);
    expect((await row("recREP")).approved_to_send).toBe(1);
  });

  it.each(["", "?override=1"])(
    "a withdraw landing between approve's read and write → 409, row not approved (%s)",
    async (query) => {
      race.afterRead = async () => {
        await db
          .updateTable("reports")
          .set({ withdrawn_at: "2026-09-30T12:00:00.000Z", withdrawn_by: "dashboard" })
          .where("id", "=", "recREP")
          .execute();
      };
      const res = await post("recREP", "approve", query);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ status: "noop", reportId: "recREP", reason: "withdrawn" });
      const r = await row("recREP");
      expect(r.approved_to_send).toBe(0);
      expect(r.send_override).toBe(0);
    },
  );

  it("an approve landing between withdraw's read and write → 409, row not withdrawn", async () => {
    race.afterRead = async () => {
      await db
        .updateTable("reports")
        .set({ approved_to_send: 1, approved_by: "dashboard" })
        .where("id", "=", "recREP")
        .execute();
    };
    const res = await post("recREP", "withdraw");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      status: "noop",
      reportId: "recREP",
      reason: "already-approved",
    });
    expect((await row("recREP")).withdrawn_at).toBeNull();
  });
});
