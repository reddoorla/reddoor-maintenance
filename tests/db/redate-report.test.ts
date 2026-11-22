/**
 * #2157: the nightly's re-date stores the re-rendered body and the cycle's new
 * due date in one write, and only on a row that is still draft-ready,
 * unapproved, unsent, unwithdrawn and unclaimed, so an approval given while the
 * body rendered keeps the date and body it was given for. Over a temp libSQL
 * database.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import {
  getReportById,
  mirrorSiteInsert,
  storeRedatedBody,
  unapproveReportIfUnsent,
} from "../../src/db/fleet-state.js";
import { redatedBy, redatedMove } from "../../src/reports/report-row.js";

const SITE = "recREDATESITE";
const REPORT = "recREDATEREPORT";
let dir: string;
let db: Db;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "redate-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  await mirrorSiteInsert(
    db,
    { id: SITE, fields: { Name: "Redate Co", Status: "maintained", url: "https://r.example.com" } },
    "2026-05-01T00:00:00.000Z",
  );
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
});

async function seed(over: Record<string, unknown> = {}) {
  await db
    .insertInto("reports")
    .values({
      id: REPORT,
      report_id: "Redate Co — Maintenance — 2026-05-26",
      site_id: SITE,
      report_type: "Maintenance",
      period: "2026-06",
      completed_on: "2026-05-26",
      draft_ready: 1,
      approved_to_send: 0,
      send_override: 0,
      sent_at: null,
      due_on: "2026-06-01",
      rendered_html: "<p>06-01</p>",
      ...over,
    })
    .execute();
}

const stored = async () => {
  const r = await db
    .selectFrom("reports")
    .select(["due_on", "rendered_html"])
    .where("id", "=", REPORT)
    .executeTakeFirstOrThrow();
  return { dueOn: r.due_on, html: r.rendered_html };
};

describe("storeRedatedBody", () => {
  it("stores the body and the date together on a ready, unapproved, unsent, unwithdrawn, unclaimed row", async () => {
    await seed();
    expect(await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>")).toBe(true);
    expect(await stored()).toEqual({ dueOn: "2026-06-02", html: "<p>06-02</p>" });
  });

  it.each([
    ["approved", { approved_to_send: 1 }],
    ["sent", { sent_at: "2026-05-26T16:07:00.000Z" }],
    ["withdrawn", { withdrawn_at: "2026-05-26T10:00:00.000Z" }],
    ["claimed for a send", { send_started_at: "2026-05-26T16:07:01.000Z" }],
    ["superseded (not draft-ready)", { draft_ready: 0 }],
  ])("leaves a row that is %s on its date and body", async (_name, over) => {
    await seed(over);
    expect(await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>")).toBe(false);
    expect(await stored()).toEqual({ dueOn: "2026-06-01", html: "<p>06-01</p>" });
  });
});

describe("the nightly's take-back, read back from Turso", () => {
  it("records the move in unapproved_by, and the read gives it back", async () => {
    await seed({ approved_to_send: 1, approved_at: "2026-05-25T18:00:00.000Z" });
    expect(
      await unapproveReportIfUnsent(
        db,
        REPORT,
        new Date("2026-05-26T13:00:00.000Z"),
        redatedBy("2026-06-01", "2026-06-02"),
      ),
    ).toBe(true);
    const row = await getReportById(db, REPORT);
    expect(row?.approvedToSend).toBe(false);
    expect(row && redatedMove(row)).toEqual({ from: "2026-06-01", to: "2026-06-02" });
  });
});
