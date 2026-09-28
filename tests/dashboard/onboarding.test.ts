import { describe, it, expect } from "vitest";
import {
  onboardingStatus,
  ONBOARDING_LABELS,
  missingOnboarding,
} from "../../src/dashboard/onboarding.js";
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
  it("returns 0/5 when nothing is set", () => {
    const s = onboardingStatus(row());
    expect(s.score).toBe(0);
    expect(s.total).toBe(5);
    expect(s.checks).toEqual({
      firstAudit: false,
      recipients: false,
      schedule: false,
      poc: false,
      analytics: false,
    });
  });

  it("returns 5/5 when all five checks pass", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
        ga4PropertyId: "123456789",
      }),
    );
    expect(s.score).toBe(5);
    expect(s.checks).toEqual({
      firstAudit: true,
      recipients: true,
      schedule: true,
      poc: true,
      analytics: true,
    });
  });

  it("satisfies the analytics check with a GA4 property or an explicit 'no analytics' opt-out", () => {
    expect(onboardingStatus(row({ ga4PropertyId: "123456789" })).checks.analytics).toBe(true);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: ["no analytics"] })).checks.analytics,
    ).toBe(true);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: [" No Analytics "] })).checks.analytics,
    ).toBe(true);
    expect(onboardingStatus(row({ ga4PropertyId: "  " })).checks.analytics).toBe(false);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: ["no custom domain"] })).checks.analytics,
    ).toBe(false);
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

describe("ONBOARDING_LABELS", () => {
  it("provides a human label for every onboarding check", () => {
    expect(ONBOARDING_LABELS).toEqual({
      firstAudit: "First audit",
      recipients: "Report recipients",
      schedule: "Maintenance schedule",
      poc: "Point of contact",
      analytics: 'GA4 property (or a "no analytics" opt-out)',
    });
  });
});

describe("missingOnboarding", () => {
  it("returns the labels of all five checks when nothing is set", () => {
    expect(missingOnboarding(row())).toEqual([
      "First audit",
      "Report recipients",
      "Maintenance schedule",
      "Point of contact",
      'GA4 property (or a "no analytics" opt-out)',
    ]);
  });

  it("returns an empty array when the site is fully onboarded", () => {
    expect(
      missingOnboarding(
        row({
          lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
          reportRecipientsTo: "tucker@reddoorla.com",
          maintenanceFreq: "Monthly",
          pointOfContact: "Tucker",
          acceptedWatchConditions: ["no analytics"],
        }),
      ),
    ).toEqual([]);
  });

  it("returns only the labels of the unchecked items, in check order", () => {
    const missing = missingOnboarding(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        maintenanceFreq: "Monthly",
        ga4PropertyId: "123456789",
      }),
    );
    // firstAudit + schedule + analytics pass → recipients + poc remain, in declaration order.
    expect(missing).toEqual(["Report recipients", "Point of contact"]);
  });
});
