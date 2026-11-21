/**
 * #2157: the nightly's re-date writes `due_on` only on a row that is still
 * unapproved, unsent, unwithdrawn and unclaimed, so an approval given while the
 * nightly works keeps the date it was given for. Over a temp libSQL database.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import {
  getReportById,
  mirrorSiteInsert,
  redateReportIfUnapproved,
} from "../../src/db/fleet-state.js";

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
      ...over,
    })
    .execute();
}

const dueOn = async () => (await getReportById(db, REPORT))?.dueOn;

describe("redateReportIfUnapproved", () => {
  it("moves an unapproved, unsent, unwithdrawn, unclaimed row", async () => {
    await seed();
    expect(await redateReportIfUnapproved(db, REPORT, "2026-06-02")).toBe(true);
    expect(await dueOn()).toBe("2026-06-02");
  });

  it.each([
    ["approved", { approved_to_send: 1 }],
    ["sent", { sent_at: "2026-05-26T16:07:00.000Z" }],
    ["withdrawn", { withdrawn_at: "2026-05-26T10:00:00.000Z" }],
    ["claimed for a send", { send_started_at: "2026-05-26T16:07:01.000Z" }],
  ])("leaves a row that is %s on its date", async (_name, over) => {
    await seed(over);
    expect(await redateReportIfUnapproved(db, REPORT, "2026-06-02")).toBe(false);
    expect(await dueOn()).toBe("2026-06-01");
  });
});
