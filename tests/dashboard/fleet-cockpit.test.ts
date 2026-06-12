import { describe, it, expect } from "vitest";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AttentionItem } from "../../src/reports/digest.js";

const NOW = new Date("2026-06-11T12:00:00Z");

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: "t@x.com",
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastLighthouseAuditAt: "2026-06-10T12:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    depsOutdated: null,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    dashboardToken: "tok",
    ...over,
  };
}

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:recSITE",
    kind: "vuln",
    siteName: "Acme Co",
    title: "1 critical/high vuln",
    severity: "critical",
    metric: 1,
    ...over,
  };
}

describe("assignTier", () => {
  it("is 'attention' when the site has any attention item", () => {
    const r = assignTier(site(), [item()], NOW);
    expect(r.tier).toBe("attention");
    expect(r.watchReasons).toEqual([]);
  });

  it("is 'watch' on a Lighthouse score in [75,85) with no attention items", () => {
    const r = assignTier(site({ pScore: 80 }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toContain("Performance 80");
  });

  it("is 'watch' when the last audit is older than 30 days", () => {
    const r = assignTier(site({ lastLighthouseAuditAt: "2026-04-01T00:00:00Z" }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons.some((s) => /ago/.test(s))).toBe(true);
  });

  it("does NOT treat a never-audited (null) site as audit-stale", () => {
    const r = assignTier(site({ lastLighthouseAuditAt: null }), [], NOW);
    expect(r.tier).toBe("healthy");
  });

  it("is 'healthy' when clean and recently audited", () => {
    expect(assignTier(site(), [], NOW).tier).toBe("healthy");
  });

  it("a score below the floor (handled as an attention item) is NOT double-counted as watch", () => {
    // pScore 60 would be an attention item upstream; assignTier sees the item → attention.
    const r = assignTier(
      site({ pScore: 60 }),
      [item({ kind: "lighthouse", severity: "warning" })],
      NOW,
    );
    expect(r.tier).toBe("attention");
  });
});
