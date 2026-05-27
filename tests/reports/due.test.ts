import { describe, it, expect } from "vitest";
import { findDueReports } from "../../src/reports/due.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec_site_1",
    name: "Acme",
    url: "https://acme.example.com",
    pointOfContact: "ops@acme.example.com",
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
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
  });

  it("does NOT flag as due when last Sent at + freq is in the future", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-05-01T12:00:00.000Z" })], TODAY);
    expect(due).toEqual([]);
  });

  it("DOES flag as due when last Sent at + freq has passed", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-03-01T12:00:00.000Z" })], TODAY);
    expect(due).toHaveLength(1);
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
  });
});
