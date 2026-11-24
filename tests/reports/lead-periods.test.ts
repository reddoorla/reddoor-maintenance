import { describe, it, expect } from "vitest";
import { leadPeriods, isCountedLead, LEADS_TIME_ZONE } from "../../src/reports/lead-periods.js";

// 2026-11-24 12:00 PT. Pacific days: "yesterday" is 11-23, so the current 30-day
// window is 10-25..11-23 and the previous one is 09-25..10-24 (reportWindows).
const NOW = new Date("2026-11-24T20:00:00Z");

describe("leadPeriods: the 30-day windows", () => {
  it("uses Pacific time, the window the report's analytics block uses", () => {
    expect(LEADS_TIME_ZONE).toBe("America/Los_Angeles");
    const p = leadPeriods([], NOW);
    expect(p.current).toEqual({ startDate: "2026-10-25", endDate: "2026-11-23" });
    expect(p.previous).toEqual({ startDate: "2026-09-25", endDate: "2026-10-24" });
  });

  it("counts the first and last Pacific minute of the current window, and nothing either side", () => {
    const p = leadPeriods(
      [
        "2026-10-25T07:00:00.000Z", // 10-25 00:00 PDT: first minute, IN
        "2026-10-25T06:59:59.000Z", // 10-24 23:59:59 PDT: previous window
        "2026-11-24T07:59:59.000Z", // 11-23 23:59:59 PST: last second, IN
        "2026-11-24T08:00:00.000Z", // 11-24 00:00 PST: today, not yet counted
      ],
      NOW,
    );
    expect(p.last30).toBe(2);
    expect(p.prior30).toBe(1);
    expect(p.allTime).toBe(4);
  });

  it("bounds the previous window the same way", () => {
    const p = leadPeriods(
      [
        "2026-09-25T07:00:00.000Z", // 09-25 00:00 PDT: IN previous
        "2026-09-25T06:59:59.000Z", // 09-24: older than both windows
      ],
      NOW,
    );
    expect(p.prior30).toBe(1);
    expect(p.last30).toBe(0);
    expect(p.allTime).toBe(2);
  });
});

describe("leadPeriods: month over month", () => {
  it("gives the last six complete Pacific months, oldest first, each with its own count", () => {
    const at = (iso: string, n: number) => Array.from({ length: n }, () => iso);
    const p = leadPeriods(
      [
        ...at("2026-10-15T19:00:00Z", 5), // October
        ...at("2026-09-10T19:00:00Z", 2), // September
        "2026-11-01T06:30:00Z", // 10-31 23:30 PDT: still October
        "2026-11-20T19:00:00Z", // November: in progress, not a complete month
        "2026-04-30T19:00:00Z", // April: seven months back, outside the six
      ],
      NOW,
    );
    expect(p.months).toEqual([
      { month: "2026-05", count: 0 },
      { month: "2026-06", count: 0 },
      { month: "2026-07", count: 0 },
      { month: "2026-08", count: 0 },
      { month: "2026-09", count: 2 },
      { month: "2026-10", count: 6 },
    ]);
  });

  it("crosses a year boundary", () => {
    const p = leadPeriods(["2025-12-31T19:00:00Z"], new Date("2026-02-10T20:00:00Z"));
    expect(p.months.map((m) => m.month)).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
    expect(p.months[4]).toEqual({ month: "2025-12", count: 1 });
  });
});

describe("isCountedLead", () => {
  it("counts a lead form that is not spam, whatever its read state", () => {
    expect(isCountedLead({ status: "new", formType: "contact" })).toBe(true);
    expect(isCountedLead({ status: "read", formType: "inquiry" })).toBe(true);
  });
  it("skips spam and signups, as the digest's lead count does", () => {
    expect(isCountedLead({ status: "spam", formType: "contact" })).toBe(false);
    expect(isCountedLead({ status: "spam_auto", formType: "contact" })).toBe(false);
    expect(isCountedLead({ status: "new", formType: "newsletter" })).toBe(false);
    expect(isCountedLead({ status: "new", formType: "rsvp" })).toBe(false);
  });
});
