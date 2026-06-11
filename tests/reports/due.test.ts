import { describe, it, expect } from "vitest";
import { findDueReports, reportPeriodKey } from "../../src/reports/due.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec_site_1",
    name: "Acme",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "ops@acme.example.com",
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: null,
    ...over,
  };
}

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "rec_report_1",
    reportId: "Acme — Maintenance — 2026-04-01",
    siteId: "rec_site_1",
    reportType: "Maintenance",
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

  it("includes sites with status=launch period or hosting (also eligible)", () => {
    const due = findDueReports(
      [
        site({ id: "rec_a", status: "launch period", maintenanceDay: "2026-01-01" }),
        site({ id: "rec_b", status: "hosting", maintenanceDay: "2026-01-01" }),
      ],
      [],
      TODAY,
    );
    expect(due).toHaveLength(2);
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
