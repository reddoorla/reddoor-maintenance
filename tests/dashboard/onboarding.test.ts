import { describe, it, expect } from "vitest";
import { onboardingStatus } from "../../src/dashboard/onboarding.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recX",
    name: "Acme",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "None",
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
    dashboardToken: "tok",
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    renovateFailingCis: null,
    defaultBranchCi: null,
    lastCommitAt: null,
    githubSignalsAt: null,
    ...over,
  };
}

describe("onboardingStatus", () => {
  it("returns 0/4 when nothing is set", () => {
    const s = onboardingStatus(row());
    expect(s.score).toBe(0);
    expect(s.total).toBe(4);
    expect(s.checks).toEqual({
      firstAudit: false,
      recipients: false,
      schedule: false,
      poc: false,
    });
  });

  it("returns 4/4 when all four checks pass", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
      }),
    );
    expect(s.score).toBe(4);
    expect(s.checks).toEqual({
      firstAudit: true,
      recipients: true,
      schedule: true,
      poc: true,
    });
  });

  it("treats maintenanceFreq 'None' as schedule-not-set", () => {
    expect(onboardingStatus(row({ maintenanceFreq: "None" })).checks.schedule).toBe(false);
    expect(onboardingStatus(row({ maintenanceFreq: "Monthly" })).checks.schedule).toBe(true);
    expect(onboardingStatus(row({ maintenanceFreq: "Quarterly" })).checks.schedule).toBe(true);
    expect(onboardingStatus(row({ maintenanceFreq: "Yearly" })).checks.schedule).toBe(true);
  });

  it("treats empty-string fields as not-set", () => {
    expect(onboardingStatus(row({ reportRecipientsTo: "" })).checks.recipients).toBe(false);
    expect(onboardingStatus(row({ pointOfContact: "  " })).checks.poc).toBe(false);
  });

  it("counts partial onboarding correctly", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
      }),
    );
    expect(s.score).toBe(2);
  });
});
