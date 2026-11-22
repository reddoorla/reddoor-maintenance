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
import { bindRedateDeps } from "../../src/cli/commands/report.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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

describe("storeRedatedBody's take-back mark", () => {
  const A = "nightly: due date moved 2026-05-30 → 2026-06-01";
  const B = "nightly: due date moved 2026-06-01 → 2026-06-02";
  const mark = async () =>
    (
      await db
        .selectFrom("reports")
        .select("unapproved_by")
        .where("id", "=", REPORT)
        .executeTakeFirstOrThrow()
    ).unapproved_by;

  it("rewrites the mark in the same write when it still reads as expected", async () => {
    await seed({ unapproved_by: A });
    expect(
      await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>", { was: A, now: B }),
    ).toBe(true);
    expect(await mark()).toBe(B);
    expect(await stored()).toEqual({ dueOn: "2026-06-02", html: "<p>06-02</p>" });
  });

  it("leaves the row alone when the mark changed meanwhile (he approved and unapproved it)", async () => {
    await seed({ unapproved_by: "Reddoor" });
    expect(
      await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>", { was: A, now: B }),
    ).toBe(false);
    expect(await mark()).toBe("Reddoor");
    expect(await stored()).toEqual({ dueOn: "2026-06-01", html: "<p>06-01</p>" });
  });

  it("leaves the mark as it is without one", async () => {
    await seed({ unapproved_by: "Reddoor" });
    expect(await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>")).toBe(true);
    expect(await mark()).toBe("Reddoor");
  });
});

describe("storeRedatedBody after a take-back that missed (another run's, or his own)", () => {
  const A = "nightly: due date moved 2026-06-01 → 2026-06-02";
  const B = "nightly: due date moved 2026-06-01 → 2026-06-03";
  const mark = async () =>
    (
      await db
        .selectFrom("reports")
        .select("unapproved_by")
        .where("id", "=", REPORT)
        .executeTakeFirstOrThrow()
    ).unapproved_by;

  it("refuses where another run's nightly mark names another move: that run owns the move", async () => {
    await seed({ unapproved_by: A });
    expect(
      await storeRedatedBody(db, REPORT, "2026-06-03", "<p>06-03</p>", {
        nightlyOnly: true,
        now: B,
      }),
    ).toBe(false);
    expect(await mark()).toBe(A);
    expect(await stored()).toEqual({ dueOn: "2026-06-01", html: "<p>06-01</p>" });
  });

  it("stores where the mark already names this move (another run took it back for the same one)", async () => {
    await seed({ unapproved_by: B });
    expect(
      await storeRedatedBody(db, REPORT, "2026-06-03", "<p>06-03</p>", {
        nightlyOnly: true,
        now: B,
      }),
    ).toBe(true);
    expect(await mark()).toBe(B);
    expect(await stored()).toEqual({ dueOn: "2026-06-03", html: "<p>06-03</p>" });
  });

  it("keeps the operator's own mark, and still stores", async () => {
    await seed({ unapproved_by: "dashboard" });
    expect(
      await storeRedatedBody(db, REPORT, "2026-06-03", "<p>06-03</p>", {
        nightlyOnly: true,
        now: B,
      }),
    ).toBe(true);
    expect(await mark()).toBe("dashboard");
    expect(await stored()).toEqual({ dueOn: "2026-06-03", html: "<p>06-03</p>" });
  });

  it.each([
    ["the stale run stores last", ["fresh", "stale"]],
    ["the stale run stores first", ["stale", "fresh"]],
  ])(
    "two overlapping runs: the one whose take-back landed owns the move, whichever stores last (%s)",
    async (_name, order) => {
      await seed({ approved_to_send: 1, approved_at: "2026-05-25T18:00:00.000Z" });
      const at = new Date("2026-05-26T13:00:00.000Z");
      // The fresh run (planned from the edited anchor) takes it back first; the
      // stale run's take-back misses.
      expect(await unapproveReportIfUnsent(db, REPORT, at, B)).toBe(true);
      expect(await unapproveReportIfUnsent(db, REPORT, at, A)).toBe(false);
      const results: Record<string, boolean> = {};
      for (const who of order) {
        results[who] =
          who === "fresh"
            ? await storeRedatedBody(db, REPORT, "2026-06-03", "<p>06-03</p>", { was: B, now: B })
            : await storeRedatedBody(db, REPORT, "2026-06-02", "<p>06-02</p>", {
                nightlyOnly: true,
                now: A,
              });
      }
      expect(results).toEqual({ fresh: true, stale: false });
      const row = await getReportById(db, REPORT);
      expect(row?.dueOn).toBe("2026-06-03");
      expect(row && redatedMove(row)).toEqual({ from: "2026-06-01", to: "2026-06-03" });
    },
  );
});

describe("bindRedateDeps: the nightly's re-date wiring over Turso", () => {
  const site = makeWebsiteRow({ id: SITE, name: "Redate Co" });
  const AT = new Date("2026-05-26T13:00:00.000Z");
  const by = redatedBy("2026-06-01", "2026-06-02");
  let approveMidRender = false;
  const bind = () =>
    bindRedateDeps(
      async () => db,
      async (d) => ({
        getReport: (id) => getReportById(d, id),
        getSite: async () => site,
        loadHeaderPlate: async () => new Uint8Array([1]),
        render: async (_s, r) => {
          if (approveMidRender) {
            await d
              .updateTable("reports")
              .set({ approved_to_send: 1 })
              .where("id", "=", REPORT)
              .execute();
          }
          return { html: `<p>${r.dueOn}</p>` };
        },
        store: async () => {
          throw new Error("the re-date must store through storeRedatedBody");
        },
        storeEvidence: async () => true,
        storeScores: async () => true,
        now: () => AT,
      }),
    );

  beforeEach(() => {
    approveMidRender = false;
  });

  it("takes the approval back with the move's mark, then stores the body and date", async () => {
    await seed({ approved_to_send: 1, approved_at: "2026-05-25T18:00:00.000Z" });
    const redate = await bind();
    expect(await redate.unapprove(REPORT, AT, by)).toBe(true);
    const row = await getReportById(db, REPORT);
    expect(row?.unapprovedBy).toBe(by);
    expect(row?.unapprovedAt).toBe(AT.toISOString());
    expect(await redate.rerender(REPORT, "2026-06-02", { was: by, now: by })).toEqual({
      status: "rendered",
      stored: true,
    });
    expect(await stored()).toEqual({ dueOn: "2026-06-02", html: "<p>2026-06-02</p>" });
  });

  it("passes the marker through: a second move rewrites the first's mark", async () => {
    await seed({ unapproved_by: by, due_on: "2026-06-02", rendered_html: "<p>06-02</p>" });
    const next = redatedBy("2026-06-02", "2026-06-03");
    const redate = await bind();
    expect((await redate.rerender(REPORT, "2026-06-03", { was: by, now: next })).stored).toBe(true);
    expect((await getReportById(db, REPORT))?.unapprovedBy).toBe(next);
  });

  it("says stored: false when an approval lands while the body renders", async () => {
    await seed();
    approveMidRender = true;
    const redate = await bind();
    expect(await redate.rerender(REPORT, "2026-06-02", null)).toEqual({
      status: "rendered",
      stored: false,
    });
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
    expect(row?.unapprovedAt).toBe("2026-05-26T13:00:00.000Z");
  });
});
