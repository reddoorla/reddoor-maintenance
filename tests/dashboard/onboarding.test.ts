import { describe, it, expect } from "vitest";
import {
  onboardingStatus,
  ONBOARDING_LABELS,
  missingOnboarding,
} from "../../src/dashboard/onboarding.js";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import { ANALYTICS_OPT_OUT_KEYS, SEARCH_CONSOLE_OPT_OUT_KEYS } from "../../src/fleet/opt-outs.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-29T12:00:00Z");
const RESOLVED: Partial<WebsiteRow> = {
  searchConsoleOutcome: "resolved",
  searchConsoleResolved: "sc-domain:acme.example.com",
  searchConsoleCheckedAt: "2026-09-20T09:00:00Z",
};

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
        ...RESOLVED,
      }),
      NOW,
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

  it("#943: the Search Console check passes on a fresh resolved lookup or the opt-out, never on the record alone", () => {
    const sc = (over: Partial<WebsiteRow>) =>
      onboardingStatus(row({ maintenanceFreq: "Monthly", ...over }), NOW).checks.searchConsole;
    expect(sc(RESOLVED)).toBe(true);
    expect(sc({ acceptedWatchConditions: [" No Search Console "] })).toBe(true);
    expect(sc({ searchConsoleProperty: "sc-domain:acme.example.com" })).toBe(false);
    expect(sc({ ...RESOLVED, searchConsoleCheckedAt: "2026-08-01T00:00:00Z" })).toBe(false);
    expect(sc({ ...RESOLVED, searchConsoleOutcome: "soft-fail" })).toBe(false);
    expect(sc({ ...RESOLVED, searchConsoleOutcome: "no-property" })).toBe(false);
    expect(
      sc({
        ...RESOLVED,
        searchConsoleOutcome: "no-property",
        acceptedWatchConditions: ["no search console"],
      }),
    ).toBe(true);
    expect(sc({ acceptedWatchConditions: ["no analytics"] })).toBe(false);
    expect(
      onboardingStatus(row({ acceptedWatchConditions: ["no search console"] }), NOW).checks
        .analytics,
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
      (k) => ["searchConsole", "search-console-no-property", k] as const,
    ),
    ...ANALYTICS_OPT_OUT_KEYS.map((k) => ["analytics", "no-analytics", k] as const),
  ])("the setup check and the cockpit agree on the %s opt-out spelled %j", (check, signal, key) => {
    const site = row({
      status: "maintained",
      ga4PropertyId: null,
      searchConsoleProperty: null,
      searchConsoleOutcome: "no-property",
      searchConsoleCheckedAt: "2026-09-28T09:00:00Z",
      acceptedWatchConditions: [key],
    });
    expect(onboardingStatus(site, NOW).checks[check]).toBe(true);
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
      searchConsole:
        'Search Console queried within the report cadence (or a "no search console" opt-out)',
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
      'Search Console: no report lookup on record (or a "no search console" opt-out)',
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
        ...RESOLVED,
      }),
      NOW,
    );
    // firstAudit + schedule + analytics + searchConsole pass → recipients + poc remain, in order.
    expect(missing).toEqual(["Report recipients", "Point of contact"]);
  });
});

describe("#943: the missing Search Console label says what the evidence is", () => {
  const scLabel = (over: Partial<WebsiteRow>) =>
    missingOnboarding(row({ maintenanceFreq: "Monthly", ...over }), NOW).find((l) =>
      l.startsWith("Search Console"),
    );

  it("names the host that matched no property, and the lookup's date", () => {
    expect(
      scLabel({
        url: "https://www.acme.example.com/",
        searchConsoleOutcome: "no-property",
        searchConsoleCheckedAt: "2026-09-28T09:00:00Z",
      }),
    ).toBe("Search Console: no property matched www.acme.example.com (lookup 2026-09-28)");
  });

  it("says unknown for a soft-fail", () => {
    expect(
      scLabel({
        searchConsoleOutcome: "soft-fail",
        searchConsoleCheckedAt: "2026-09-28T09:00:00Z",
      }),
    ).toBe("Search Console: unknown, the last lookup errored (2026-09-28)");
  });

  it("says stale, with the window, for a resolved lookup past it", () => {
    expect(scLabel({ ...RESOLVED, searchConsoleCheckedAt: "2026-08-01T00:00:00Z" })).toBe(
      "Search Console: last resolved lookup 2026-08-01, older than 45 days",
    );
  });

  it("is absent when the lookup is fresh", () => {
    expect(scLabel(RESOLVED)).toBeUndefined();
  });
});
