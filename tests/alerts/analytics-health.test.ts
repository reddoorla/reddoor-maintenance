import { describe, it, expect } from "vitest";
import {
  assessAnalyticsAlert,
  composeAnalyticsAlertEmail,
} from "../../src/alerts/analytics-health.js";

describe("assessAnalyticsAlert", () => {
  it("fires when a majority of analytics-configured sites soft-failed (the SPOF signature)", () => {
    expect(assessAnalyticsAlert({ softFailedSites: 6, configuredSites: 10 }).fire).toBe(true);
    expect(assessAnalyticsAlert({ softFailedSites: 5, configuredSites: 10 }).fire).toBe(true); // exactly half
    expect(assessAnalyticsAlert({ softFailedSites: 10, configuredSites: 10 }).fire).toBe(true); // all
    expect(assessAnalyticsAlert({ softFailedSites: 2, configuredSites: 3 }).fire).toBe(true);
  });

  it("does NOT fire for a single/minority failure (a per-site issue, not a fleet outage)", () => {
    expect(assessAnalyticsAlert({ softFailedSites: 1, configuredSites: 10 }).fire).toBe(false);
    expect(assessAnalyticsAlert({ softFailedSites: 4, configuredSites: 10 }).fire).toBe(false); // <half
    expect(assessAnalyticsAlert({ softFailedSites: 1, configuredSites: 1 }).fire).toBe(false);
  });

  it("does NOT fire when fewer than 2 sites are configured (can't tell SPOF from a one-off)", () => {
    expect(assessAnalyticsAlert({ softFailedSites: 1, configuredSites: 1 }).fire).toBe(false);
    expect(assessAnalyticsAlert({ softFailedSites: 0, configuredSites: 0 }).fire).toBe(false);
  });

  it("includes the counts and the GA_SUBJECT hint in the reason when firing", () => {
    const { fire, reason } = assessAnalyticsAlert({ softFailedSites: 8, configuredSites: 9 });
    expect(fire).toBe(true);
    expect(reason).toContain("8 of 9");
    expect(reason).toContain("GA_SUBJECT");
    // No reason text when it doesn't fire.
    expect(assessAnalyticsAlert({ softFailedSites: 1, configuredSites: 9 }).reason).toBe("");
  });
});

describe("composeAnalyticsAlertEmail", () => {
  it("builds a subject with the ratio and an HTML body linking the dashboard + runbook", () => {
    const { subject, html } = composeAnalyticsAlertEmail(
      { softFailedSites: 7, configuredSites: 9 },
      "https://dash.reddoor.test/",
    );
    expect(subject).toContain("7/9");
    expect(html).toContain("https://dash.reddoor.test/");
    expect(html).toContain("ga-search-role-account-cutover.md");
    expect(html).toContain("7 of 9");
  });

  it("escapes a hostile dashboard URL into the body", () => {
    const { html } = composeAnalyticsAlertEmail(
      { softFailedSites: 5, configuredSites: 5 },
      'https://x/"><script>alert(1)</script>',
    );
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
