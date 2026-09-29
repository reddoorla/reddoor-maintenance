import { describe, it, expect } from "vitest";
import {
  onboardingStatus,
  ONBOARDING_LABELS,
  missingOnboarding,
} from "../../src/dashboard/onboarding.js";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import { ANALYTICS_OPT_OUT_KEYS, SEARCH_CONSOLE_OPT_OUT_KEYS } from "../../src/fleet/opt-outs.js";
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
  it("returns 0/6 when nothing is set", () => {
    const s = onboardingStatus(row());
    expect(s.score).toBe(0);
    expect(s.total).toBe(6);
    expect(s.checks).toEqual({
      firstAudit: false,
      recipients: false,
      schedule: false,
      poc: false,
      analytics: false,
      searchConsole: false,
    });
  });

  it("returns 6/6 when all six checks pass", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
        ga4PropertyId: "123456789",
        searchConsoleProperty: "sc-domain:acme.example.com",
      }),
    );
    expect(s.score).toBe(6);
    expect(s.checks).toEqual({
      firstAudit: true,
      recipients: true,
      schedule: true,
      poc: true,
      analytics: true,
      searchConsole: true,
    });
  });

  it("satisfies the Search Console check with a property or an explicit 'no search console' opt-out", () => {
    expect(
      onboardingStatus(row({ searchConsoleProperty: "sc-domain:acme.example.com" })).checks
        .searchConsole,
    ).toBe(true);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: [" No Search Console "] })).checks
        .searchConsole,
    ).toBe(true);
    expect(onboardingStatus(row({ searchConsoleProperty: " " })).checks.searchConsole).toBe(false);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: ["no analytics"] })).checks.searchConsole,
    ).toBe(false);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: ["no search console"] })).checks.analytics,
    ).toBe(false);
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

  it.each([
    ...SEARCH_CONSOLE_OPT_OUT_KEYS.map(
      (k) => ["searchConsole", "search-console-unrecorded", k] as const,
    ),
    ...ANALYTICS_OPT_OUT_KEYS.map((k) => ["analytics", "no-analytics", k] as const),
  ])("the setup check and the cockpit agree on the %s opt-out spelled %j", (check, signal, key) => {
    const site = row({
      status: "maintained",
      ga4PropertyId: null,
      searchConsoleProperty: null,
      acceptedWatchConditions: [key],
    });
    expect(onboardingStatus(site).checks[check]).toBe(true);
    expect(assignTier(site, [], new Date("2026-09-29T00:00:00Z")).watchSignals).not.toContain(
      signal,
    );
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
      searchConsole: 'Search Console property recorded (or a "no search console" opt-out)',
    });
  });
});

describe("missingOnboarding", () => {
  it("returns the labels of all six checks when nothing is set", () => {
    expect(missingOnboarding(row())).toEqual([
      "First audit",
      "Report recipients",
      "Maintenance schedule",
      "Point of contact",
      'GA4 property (or a "no analytics" opt-out)',
      'Search Console property recorded (or a "no search console" opt-out)',
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
          acceptedWatchConditions: ["no analytics", "no search console"],
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
        searchConsoleProperty: "sc-domain:acme.example.com",
      }),
    );
    // firstAudit + schedule + analytics + searchConsole pass → recipients + poc remain, in order.
    expect(missing).toEqual(["Report recipients", "Point of contact"]);
  });
});
