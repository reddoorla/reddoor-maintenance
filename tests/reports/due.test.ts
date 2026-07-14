import { describe, it, expect, vi, afterEach } from "vitest";
import { findDueReports, nextDueDate, reportPeriodKey } from "../../src/reports/due.js";
import { mapRow, type WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "rec_site_1",
    name: "Acme",
    pointOfContact: "ops@acme.example.com",
    maintenanceFreq: "Monthly",
    ...over,
  });
}

/** Build a WebsiteRow the way production does — through mapRow — so the frequency
 *  guard at the read boundary (toFrequency) is exercised instead of bypassed. The
 *  factory above hands the scheduler pre-coerced values a live Airtable fetch can
 *  never produce; raw-cell behavior MUST be asserted through this helper. */
function siteFromAirtable(fields: Record<string, unknown>): WebsiteRow {
  return mapRow({ id: "rec_site_1", fields: { Name: "Acme", ...fields } });
}

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "rec_report_1",
    reportId: "Acme — Maintenance — 2026-04-01",
    siteId: "rec_site_1",
    reportType: "Maintenance",
    period: null,
    periodStart: null,
    periodEnd: null,
    completedOn: null,
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-04-01T12:00:00.000Z",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: null,
    resendMessageId: "msg_1",
    approvedAt: null,
    approvedBy: null,
    checklist: {},
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    ...over,
  };
}

const TODAY = new Date("2026-05-26T12:00:00Z");

describe("findDueReports", () => {
  it("skips sites with frequency=None", () => {
    expect(findDueReports([site({ maintenanceFreq: "None" })], [], TODAY)).toEqual([]);
  });

  it("flags a site with no Reports row and no fallback maintenance day as due immediately", () => {
    const due = findDueReports([site()], [], TODAY);
    expect(due).toHaveLength(1);
    expect(due[0]?.reportType).toBe("Maintenance");
    expect(due[0]?.lastSent).toBeNull();
  });

  it("uses maintenance day fallback when no Reports row exists", () => {
    const due = findDueReports([site({ maintenanceDay: "2026-04-26" })], [], TODAY);
    expect(due).toHaveLength(1);
    // The dueDate must equal baseDate + 1 month (not "today" — that would mean the fallback was ignored).
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  it("does NOT flag as due when last Sent at + freq is in the future", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-05-01T12:00:00.000Z" })], TODAY);
    expect(due).toEqual([]);
  });

  it("DOES flag as due when last Sent at + freq has passed", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-03-01T12:00:00.000Z" })], TODAY);
    expect(due).toHaveLength(1);
    // 2026-03-01 + Monthly = 2026-04-01 (the day it became due).
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(due[0]!.lastSent).toBe("2026-03-01T12:00:00.000Z");
  });

  it("picks the most recent Sent at when multiple reports exist", () => {
    const recent = report({ id: "r2", sentAt: "2026-05-15T12:00:00.000Z" });
    const old = report({ id: "r3", sentAt: "2026-02-15T12:00:00.000Z" });
    expect(findDueReports([site()], [recent, old], TODAY)).toEqual([]);
  });

  it("flags Maintenance and Testing independently when both freqs are set", () => {
    const s = site({
      maintenanceFreq: "Monthly",
      testingFreq: "Quarterly",
      maintenanceDay: "2026-04-26",
      testingDay: "2026-02-26",
    });
    const due = findDueReports([s], [], TODAY);
    expect(due.map((d) => d.reportType).sort()).toEqual(["Maintenance", "Testing"]);
  });

  it("only matches reports linked to this site (not another site's reports)", () => {
    const otherSite = report({ siteId: "rec_other", sentAt: "2026-05-25T12:00:00.000Z" });
    const due = findDueReports([site()], [otherSite], TODAY);
    expect(due).toHaveLength(1);
  });

  it("respects Quarterly frequency", () => {
    const due = findDueReports(
      [site({ maintenanceFreq: "Quarterly" })],
      [report({ sentAt: "2026-02-26T12:00:00.000Z" })],
      TODAY,
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  it("skips sites with status=deprecated (even if freq is set)", () => {
    const due = findDueReports(
      [site({ status: "deprecated", maintenanceFreq: "Monthly", maintenanceDay: "2026-01-01" })],
      [],
      TODAY,
    );
    expect(due).toEqual([]);
  });

  it("skips sites with status='probably not our problem'", () => {
    const due = findDueReports(
      [
        site({
          status: "probably not our problem",
          maintenanceFreq: "Monthly",
          maintenanceDay: "2026-01-01",
        }),
      ],
      [],
      TODAY,
    );
    expect(due).toEqual([]);
  });

  it("skips pre-launch sites (launch period / in development) — not live yet", () => {
    const due = findDueReports(
      [
        site({ id: "rec_a", status: "launch period", maintenanceDay: "2026-01-01" }),
        site({ id: "rec_b", status: "in development", maintenanceDay: "2026-01-01" }),
      ],
      [],
      TODAY,
    );
    expect(due).toEqual([]);
  });

  it("includes hosting sites (eligible, live)", () => {
    const due = findDueReports(
      [site({ id: "rec_b", status: "hosting", maintenanceDay: "2026-01-01" })],
      [],
      TODAY,
    );
    expect(due).toHaveLength(1);
  });

  it("treats null status as eligible (backwards compat with partial data)", () => {
    const due = findDueReports([site({ status: null, maintenanceDay: "2026-01-01" })], [], TODAY);
    expect(due).toHaveLength(1);
  });

  it("respects Yearly frequency", () => {
    const due = findDueReports(
      [site({ maintenanceFreq: "Yearly" })],
      [report({ sentAt: "2025-05-26T12:00:00.000Z" })],
      TODAY,
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  // B4 regression: Jan 31 + 1 month should clamp to Feb 28, not roll to Mar 3.
  it("clamps month-overflow when base date is the 31st (B4)", () => {
    const due = findDueReports(
      [site({ maintenanceDay: "2026-01-31" })],
      [],
      new Date("2026-03-01T12:00:00Z"),
    );
    expect(due).toHaveLength(1);
    // Naive setMonth gives "2026-03-03"; the clamp gives Feb 28. Today (Mar 1) is past either way,
    // but we assert on the value so a regression to the naive impl flips the date string.
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("clamps month-overflow correctly on leap years", () => {
    // 2028 is a leap year — Jan 31 + 1mo should clamp to Feb 29.
    const due = findDueReports(
      [site({ maintenanceDay: "2028-01-31" })],
      [],
      new Date("2028-03-01T12:00:00Z"),
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.dueDate.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  describe("unrecognized frequency (guarded at the read boundary — mapRow/toFrequency)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns LOUDLY at mapRow time and never schedules a casing/typo frequency", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // "monthly" (lowercase) is not a known select option — it used to be silently
      // coerced to "None" at mapRow time, dropping the site from the schedule with
      // zero signal (a warn in due.ts existed but sat BELOW the coercion, dead).
      const s = siteFromAirtable({
        "maintenence freq": "monthly",
        "maintenance day": "2026-01-01",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/unrecognized frequency 'monthly'/);
      expect(s.maintenanceFreq).toBe("None");
      expect(findDueReports([s], [], TODAY)).toEqual([]);
    });

    it("accepts a trailing-space typo ('Quarterly ') as Quarterly — schedules, no warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Trailing whitespace is trimmed at the read boundary, so an operator's
      // trailing-space select option degrades gracefully instead of unscheduling.
      const s = siteFromAirtable({
        "maintenence freq": "Quarterly ",
        "maintenance day": "2026-02-26",
      });
      expect(s.maintenanceFreq).toBe("Quarterly");
      expect(findDueReports([s], [], TODAY)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it("a known frequency still schedules and never warns", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const s = siteFromAirtable({
        "maintenence freq": "Monthly",
        "maintenance day": "2026-04-26",
      });
      expect(findDueReports([s], [], TODAY)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps 'None' and a blank cell SILENT — intentional no-schedule, not a mistake", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(findDueReports([siteFromAirtable({ "maintenence freq": "None" })], [], TODAY)).toEqual(
        [],
      );
      expect(findDueReports([siteFromAirtable({})], [], TODAY)).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  // B5 regression: results must not depend on the machine's local timezone.
  it("uses UTC date math (B5) — result identical regardless of process.env.TZ", () => {
    const args: Parameters<typeof findDueReports> = [
      [site({ maintenanceDay: "2026-04-26" })],
      [],
      new Date("2026-05-26T07:00:00Z"), // 00:00 PDT
    ];
    const original = process.env.TZ;

    process.env.TZ = "UTC";
    const utcResult = findDueReports(...args);

    process.env.TZ = "America/Los_Angeles";
    const pdtResult = findDueReports(...args);

    process.env.TZ = "Asia/Tokyo";
    const jstResult = findDueReports(...args);

    process.env.TZ = original;

    expect(utcResult).toHaveLength(1);
    expect(pdtResult).toEqual(utcResult);
    expect(jstResult).toEqual(utcResult);
  });
});

describe("reportPeriodKey", () => {
  it("returns the UTC YYYY-MM of the due date", () => {
    expect(reportPeriodKey(new Date("2026-05-26T12:00:00Z"))).toBe("2026-05");
  });

  it("uses UTC, not local time, near a month boundary", () => {
    // 2026-06-01T00:00 UTC is still May 31 in PDT — must report 2026-06, not 2026-05.
    expect(reportPeriodKey(new Date("2026-06-01T00:30:00Z"))).toBe("2026-06");
  });

  it("zero-pads single-digit months", () => {
    expect(reportPeriodKey(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });

  it("matches the dueDate that findDueReports produces (stable dedup key)", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-03-01T12:00:00.000Z" })], TODAY);
    expect(due).toHaveLength(1);
    // dueDate = 2026-04-01 → period 2026-04
    expect(reportPeriodKey(due[0]!.dueDate)).toBe("2026-04");
  });

  it("throws on an Invalid Date instead of minting a NaN-NaN key", () => {
    expect(() => reportPeriodKey(new Date("not-a-date"))).toThrow(TypeError);
  });
});

describe("nextDueDate", () => {
  it("returns the anchor + frequency when nothing has been sent (Monthly)", () => {
    const s = site({ maintenanceFreq: "Monthly", maintenanceDay: "2026-06-30" });
    expect(nextDueDate(s, [], "Maintenance", TODAY)).toEqual(new Date("2026-07-30T00:00:00.000Z"));
  });

  it("uses the last Sent at over the anchor", () => {
    const s = site({ maintenanceFreq: "Monthly", maintenanceDay: "2026-01-01" });
    const sent = report({ reportType: "Maintenance", sentAt: "2026-06-01T12:00:00.000Z" });
    // Time-of-day is carried through from the Sent at, exactly as findDueReports does
    // (the writer formats to a date-only YYYY-MM-DD, so the time is dropped on store).
    expect(nextDueDate(s, [sent], "Maintenance", TODAY)).toEqual(
      new Date("2026-07-01T12:00:00.000Z"),
    );
  });

  it("is due today (UTC midnight) when there's no anchor and nothing sent", () => {
    const s = site({ maintenanceFreq: "Monthly", maintenanceDay: null });
    expect(nextDueDate(s, [], "Maintenance", TODAY)).toEqual(new Date("2026-05-26T00:00:00.000Z"));
  });

  it("computes the Testing schedule from the testing anchor + Quarterly", () => {
    const s = site({ testingFreq: "Quarterly", testingDay: "2026-06-30" });
    expect(nextDueDate(s, [], "Testing", TODAY)).toEqual(new Date("2026-09-30T00:00:00.000Z"));
  });

  it("returns null when the frequency is None", () => {
    expect(nextDueDate(site({ maintenanceFreq: "None" }), [], "Maintenance", TODAY)).toBeNull();
  });

  it("returns null for a pre-launch status (launch period — not live yet)", () => {
    const s = site({
      status: "launch period",
      maintenanceFreq: "Monthly",
      maintenanceDay: "2026-06-30",
    });
    expect(nextDueDate(s, [], "Maintenance", TODAY)).toBeNull();
  });

  it("returns null for an ineligible status", () => {
    const s = site({
      status: "deprecated",
      maintenanceFreq: "Monthly",
      maintenanceDay: "2026-06-30",
    });
    expect(nextDueDate(s, [], "Maintenance", TODAY)).toBeNull();
  });

  it("returns null for an unrecognized raw frequency (coerced to None at the read boundary)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = siteFromAirtable({
      "maintenence freq": "monthly",
      "maintenance day": "2026-06-30",
    });
    expect(nextDueDate(s, [], "Maintenance", TODAY)).toBeNull();
    warn.mockRestore();
  });
});
