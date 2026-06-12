import { describe, it, expect } from "vitest";
import { assignTier, buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AttentionItem } from "../../src/reports/digest.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";

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

const BASE = "https://reddoor-maintenance.netlify.app";

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recRPT",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-05",
    periodStart: null,
    periodEnd: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    deliveryStatus: "pending",
    ...over,
  } as ReportRow;
}

describe("buildCockpitModel", () => {
  it("only includes dashboardToken-visible sites", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Visible", dashboardToken: "t" }),
        site({ id: "b", name: "Hidden", dashboardToken: null }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.site.name)).toEqual(["Visible"]);
  });

  it("tiers a vuln site as attention and a clean site as healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Bad", securityVulnsCritical: 2, securityVulnsHigh: 1 }),
        site({ id: "b", name: "Good" }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const bad = m.cards.find((c) => c.site.name === "Bad")!;
    const good = m.cards.find((c) => c.site.name === "Good")!;
    expect(bad.tier).toBe("attention");
    expect(bad.items).toHaveLength(1);
    expect(good.tier).toBe("healthy");
    expect(m.summary).toMatchObject({ attention: 1, healthy: 1, criticalHighVulns: 3 });
  });

  it("tags items NEW/WORSE from the prior snapshot but never returns a written snapshot", () => {
    const prior: DigestSnapshot = { "vuln:a": { metric: 1, firstFlaggedAt: "2026-06-01" } };
    const m = buildCockpitModel(
      [site({ id: "a", name: "Bad", securityVulnsCritical: 3, securityVulnsHigh: 0 })], // metric 3 > prior 1
      [],
      prior,
      BASE,
      NOW,
    );
    expect(m.cards[0]!.items[0]!.status).toBe("worse");
    // model has no `next`/snapshot field — read-only contract
    expect((m as Record<string, unknown>).next).toBeUndefined();
  });

  it("sorts attention worst-first: critical before warning, then higher total metric", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "WarnOnly", securityVulnsCritical: 0, securityVulnsHigh: 5 }),
        site({ id: "b", name: "CritLow", securityVulnsCritical: 1, securityVulnsHigh: 0 }),
        site({ id: "c", name: "CritHigh", securityVulnsCritical: 4, securityVulnsHigh: 0 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const attn = m.cards.filter((c) => c.tier === "attention").map((c) => c.site.name);
    expect(attn).toEqual(["CritHigh", "CritLow", "WarnOnly"]);
  });

  it("orders tiers attention → watch → healthy, alphabetical within watch/healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "h2", name: "Zeta" }),
        site({ id: "h1", name: "Alpha" }),
        site({ id: "w", name: "Mid", pScore: 80 }),
        site({ id: "a", name: "Bad", securityVulnsCritical: 1 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.tier)).toEqual(["attention", "watch", "healthy", "healthy"]);
    expect(m.cards.map((c) => c.site.name)).toEqual(["Bad", "Mid", "Alpha", "Zeta"]);
  });

  it("builds pending entries from draft-ready∧¬approved∧¬sent reports, resolving the site name", () => {
    const m = buildCockpitModel(
      [site({ id: "recSITE", name: "Acme Co" })],
      [
        report({ id: "r1", siteId: "recSITE", period: "2026-05" }),
        report({ id: "r2", siteId: "recSITE", approvedToSend: true }), // already approved → excluded
        report({ id: "r3", siteId: "recSITE", sentAt: "2026-05-02" }), // already sent → excluded
      ],
      {},
      BASE,
      NOW,
    );
    expect(m.pending).toEqual([
      {
        reportId: "r1",
        siteName: "Acme Co",
        slug: "acme-co",
        reportType: "Maintenance",
        period: "2026-05",
      },
    ]);
    expect(m.summary.pending).toBe(1);
  });

  it("counts lighthouse-below-floor and delivery failures in the summary", () => {
    const m = buildCockpitModel(
      [site({ id: "a", name: "Slow", pScore: 60, bpScore: 50 })],
      [report({ id: "rb", siteId: "a", deliveryStatus: "bounced" })],
      {},
      BASE,
      NOW,
    );
    expect(m.summary.lighthouseBelowFloor).toBe(2); // pScore + bpScore both < 75
    expect(m.summary.deliveryFailures).toBe(1);
  });
});

describe("assignTier — structured watchSignals", () => {
  it("tags 'lighthouse' for a watch-band score and 'stale' for an old audit", () => {
    const both = assignTier(
      site({ pScore: 80, lastLighthouseAuditAt: "2026-01-01T00:00:00Z" }),
      [],
      NOW,
    );
    expect(both.watchSignals).toContain("lighthouse");
    expect(both.watchSignals).toContain("stale");
  });

  it("is empty for attention and healthy sites", () => {
    expect(assignTier(site(), [item()], NOW).watchSignals).toEqual([]);
    expect(assignTier(site(), [], NOW).watchSignals).toEqual([]);
  });
});
