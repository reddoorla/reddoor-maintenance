import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import { openDb } from "../../src/db/client.js";
import {
  cleanSendStreak,
  formatTestStreak,
  insertTestSend,
  listTestSends,
  parseVerdict,
  setTestSendVerdict,
  type TestSendVerdict,
} from "../../src/db/test-sends.js";

const v = (...verdicts: TestSendVerdict[]) => verdicts.map((verdict) => ({ verdict }));

describe("cleanSendStreak, by #974's rule: clean rows counted up from the bottom", () => {
  // The recommendation's Measure, against the table as BACKLOG held it on 10-06:
  // 29 Navy's 09-28 send (clean, #978), then the five 10-05 sends, all awaiting.
  it("is 0 on the 10-06 table, where five awaiting rows are newest", () => {
    expect(
      cleanSendStreak(v("clean", "awaiting", "awaiting", "awaiting", "awaiting", "awaiting")),
    ).toBe(0);
  });

  it("is 1 with only the 09-28 row", () => {
    expect(cleanSendStreak(v("clean"))).toBe(1);
  });

  it("is 0 when a problem row is newest", () => {
    expect(cleanSendStreak(v("clean", "clean", "problem"))).toBe(0);
  });

  it("stops at the first row that is not clean, counting from the newest", () => {
    expect(cleanSendStreak(v("clean", "problem", "clean", "clean"))).toBe(2);
    expect(cleanSendStreak(v("clean", "awaiting", "clean", "clean", "clean"))).toBe(3);
  });

  it("is 0 on an empty table", () => {
    expect(cleanSendStreak([])).toBe(0);
  });
});

describe("parseVerdict", () => {
  it("reads `clean` as clean, anything else as the problem it names", () => {
    expect(parseVerdict(" clean ")).toEqual({ verdict: "clean", problem: null });
    expect(parseVerdict("CLEAN")).toEqual({ verdict: "clean", problem: null });
    expect(parseVerdict("BP score shows 78")).toEqual({
      verdict: "problem",
      problem: "BP score shows 78",
    });
  });

  it("refuses a blank verdict", () => {
    expect(() => parseVerdict("  ")).toThrow(/needs a verdict/);
    expect(() => parseVerdict(undefined)).toThrow(/needs a verdict/);
  });
});

describe("report_test_sends (migration 0054)", () => {
  async function seeded() {
    const db = await openDb({ url: ":memory:" });
    const base = {
      reportId: "report_1",
      siteId: "site_1",
      subject: "[TEST] Your report",
      sentTo: "op@example.test",
      resendMessageId: "re_1",
    };
    // Inserted out of order: the read orders by sent_at, not insertion.
    await insertTestSend(db, { ...base, id: "ts_b", sentAt: new Date("2026-10-05T18:00:00Z") });
    await insertTestSend(db, { ...base, id: "ts_a", sentAt: new Date("2026-09-28T22:54:00Z") });
    await insertTestSend(db, { ...base, id: "ts_c", sentAt: new Date("2026-10-05T18:00:00Z") });
    return db;
  }

  it("logs each send as awaiting and lists oldest first by (sent_at, id)", async () => {
    const db = await seeded();
    const rows = await listTestSends(db);
    expect(rows.map((r) => r.id)).toEqual(["ts_a", "ts_b", "ts_c"]);
    expect(
      rows.every((r) => r.verdict === "awaiting" && r.problem === null && r.verdictAt === null),
    ).toBe(true);
    expect(rows[0]).toMatchObject({
      reportId: "report_1",
      sentTo: "op@example.test",
      sentAt: "2026-09-28T22:54:00.000Z",
    });
  });

  it("records a verdict, returns the row as it was, and refuses an unknown id", async () => {
    const db = await seeded();
    const now = new Date("2026-11-03T22:00:00Z");
    const before = await setTestSendVerdict(
      db,
      "ts_a",
      { verdict: "problem", problem: "wrong month" },
      now,
    );
    expect(before?.verdict).toBe("awaiting");
    const again = await setTestSendVerdict(db, "ts_a", { verdict: "clean", problem: null }, now);
    expect(again).toMatchObject({ verdict: "problem", problem: "wrong month" });
    expect((await listTestSends(db))[0]).toMatchObject({
      verdict: "clean",
      problem: null,
      verdictAt: now.toISOString(),
    });
    expect(
      await setTestSendVerdict(db, "ts_nope", { verdict: "clean", problem: null }, now),
    ).toBeNull();
  });

  it("refuses a verdict outside awaiting, clean and problem at the table", async () => {
    const db = await seeded();
    await expect(
      sql`UPDATE report_test_sends SET verdict = 'fine' WHERE id = 'ts_a'`.execute(db),
    ).rejects.toThrow(/CHECK/i);
  });

  it("prints the same streak a SELECT on the table gives", async () => {
    const db = await seeded();
    const now = new Date();
    await setTestSendVerdict(db, "ts_b", { verdict: "clean", problem: null }, now);
    await setTestSendVerdict(db, "ts_c", { verdict: "clean", problem: null }, now);
    // The streak by SQL alone: clean rows newer than the newest non-clean row.
    const { rows } = await sql<{ n: number }>`
      SELECT count(*) AS n FROM report_test_sends t
      WHERE t.verdict = 'clean' AND NOT EXISTS (
        SELECT 1 FROM report_test_sends u WHERE u.verdict <> 'clean'
          AND (u.sent_at > t.sent_at OR (u.sent_at = t.sent_at AND u.id > t.id)))`.execute(db);
    const out = formatTestStreak(await listTestSends(db));
    expect(Number(rows[0]!.n)).toBe(2);
    expect(out.split("\n")[0]).toBe("TEST_SEND_STREAK streak=2 sends=3 awaiting=1");
    expect(out).toContain("ts_a report=report_1 awaiting");
  });
});
