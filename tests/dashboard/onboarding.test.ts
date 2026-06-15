import { describe, it, expect } from "vitest";
import { onboardingStatus } from "../../src/dashboard/onboarding.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recX",
    name: "Acme",
    ...over,
  });
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
