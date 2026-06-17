// tests/alerts/digest-collectors.test.ts
import { describe, it, expect } from "vitest";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
} from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const BASE = "https://reddoor-maintenance.netlify.app";

/** Minimal WebsiteRow — only the fields the collector reads matter; the rest are nulled. */
function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "rec_site_acme",
    maintenanceFreq: "Monthly",
    ...over,
  });
}

describe("collectVulnAlerts", () => {
  it("flags a site with critical vulns: key, metric=critical+high, severity critical, dashboard url", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 2, securityVulnsHigh: 1 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "vuln:rec_site_acme",
      kind: "vuln",
      siteName: "Acme Co",
      severity: "critical",
      metric: 3,
      url: `${BASE}/s/acme-co`,
    });
  });

  it("severity is 'warning' when there are high but zero critical", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 4 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe("warning");
    expect(items[0]!.metric).toBe(4);
  });

  it("treats null counts as zero (never audited) and skips the site", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: null, securityVulnsHigh: null })],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("skips a clean site (critical+high == 0)", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 0 })],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("ignores moderate/low — only critical+high count toward the threshold and metric", () => {
    const items = collectVulnAlerts(
      [
        site({
          securityVulnsCritical: 0,
          securityVulnsHigh: 0,
          securityVulnsModerate: 9,
          securityVulnsLow: 9,
        }),
      ],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("strips a trailing slash from baseUrl (no //s/ in the link)", () => {
    const items = collectVulnAlerts([site({ securityVulnsHigh: 1 })], `${BASE}/`);
    expect(items[0]!.url).toBe(`${BASE}/s/acme-co`);
    expect(items[0]!.url).not.toContain("//s/");
  });

  it("title states the critical/high count for the operator's glance", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 1, securityVulnsHigh: 2 })],
      BASE,
    );
    expect(items[0]!.title).toMatch(/3/);
    expect(items[0]!.title).toMatch(/critical\/high/i);
  });
});

describe("collectLighthouseAlerts", () => {
  it("flags a category below 75: key, kind, metric=100-score, severity warning, dashboard url", () => {
    const items = collectLighthouseAlerts([site({ pScore: 60 })], BASE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "lighthouse:rec_site_acme:performance",
      kind: "lighthouse",
      siteName: "Acme Co",
      severity: "warning",
      metric: 40, // 100 - 60
      url: `${BASE}/s/acme-co`,
    });
    expect(items[0]!.title).toBe("Lighthouse Performance 60 (below 75)");
  });

  it("threshold boundary: 74 flags, 75 does NOT, 76 does NOT", () => {
    expect(collectLighthouseAlerts([site({ pScore: 74 })], BASE)).toHaveLength(1);
    expect(collectLighthouseAlerts([site({ pScore: 75 })], BASE)).toEqual([]);
    expect(collectLighthouseAlerts([site({ pScore: 76 })], BASE)).toEqual([]);
  });

  it("skips a null score (never audited)", () => {
    const items = collectLighthouseAlerts([site({ pScore: null })], BASE);
    expect(items).toEqual([]);
  });

  it("metric is 100 - score so a lower score sorts as a deeper deficit", () => {
    const items = collectLighthouseAlerts([site({ rScore: 30 })], BASE);
    expect(items[0]!.metric).toBe(70); // 100 - 30
  });

  it("emits one item per category below 75 for a single site (all four)", () => {
    const items = collectLighthouseAlerts(
      [site({ pScore: 50, rScore: 60, bpScore: 70, seoScore: 40 })],
      BASE,
    );
    expect(items.map((i) => i.key)).toEqual([
      "lighthouse:rec_site_acme:performance",
      "lighthouse:rec_site_acme:accessibility",
      "lighthouse:rec_site_acme:best-practices",
      "lighthouse:rec_site_acme:seo",
    ]);
    // Each carries the right deficit metric.
    expect(items.map((i) => i.metric)).toEqual([50, 40, 30, 60]);
  });

  it("flags only the categories below 75, leaving the healthy ones out", () => {
    const items = collectLighthouseAlerts(
      [site({ pScore: 95, rScore: 70, bpScore: 90, seoScore: 74 })],
      BASE,
    );
    expect(items.map((i) => i.key)).toEqual([
      "lighthouse:rec_site_acme:accessibility",
      "lighthouse:rec_site_acme:seo",
    ]);
  });

  it("titles each category with its human label and the below-75 framing", () => {
    const items = collectLighthouseAlerts(
      [site({ pScore: 10, rScore: 20, bpScore: 30, seoScore: 40 })],
      BASE,
    );
    expect(items.map((i) => i.title)).toEqual([
      "Lighthouse Performance 10 (below 75)",
      "Lighthouse Accessibility 20 (below 75)",
      "Lighthouse Best Practices 30 (below 75)",
      "Lighthouse SEO 40 (below 75)",
    ]);
  });

  it("groups by the site name for the (component-3) render", () => {
    const items = collectLighthouseAlerts([site({ name: "Brown & Co", pScore: 50 })], BASE);
    expect(items[0]!.siteName).toBe("Brown & Co");
  });

  it("strips a trailing slash from baseUrl (no //s/ in the link)", () => {
    const items = collectLighthouseAlerts([site({ pScore: 50 })], `${BASE}/`);
    expect(items[0]!.url).toBe(`${BASE}/s/acme-co`);
    expect(items[0]!.url).not.toContain("//s/");
  });

  it("emits items per site across multiple sites", () => {
    const items = collectLighthouseAlerts(
      [
        site({ id: "rec_a", name: "Acme Co", pScore: 50 }),
        site({ id: "rec_b", name: "Beta Ltd", seoScore: 60 }),
      ],
      BASE,
    );
    expect(items.map((i) => i.key)).toEqual([
      "lighthouse:rec_a:performance",
      "lighthouse:rec_b:seo",
    ]);
  });
});

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "rec_report_1",
    reportId: "Acme Co — Maintenance — 2026-06",
    siteId: "rec_site_acme",
    reportType: "Maintenance",
    period: "2026-06",
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
    sentAt: "2026-06-01T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "bounced",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    ...over,
  };
}

describe("collectDeliveryFailures", () => {
  const byId = new Map<string, WebsiteRow>([["rec_site_acme", site()]]);

  it("flags a bounced report: key delivery:<reportId-recordId>, metric 1, severity warning, site url", () => {
    const items = collectDeliveryFailures([report({ deliveryStatus: "bounced" })], byId, BASE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "delivery:rec_report_1",
      kind: "delivery",
      siteName: "Acme Co",
      severity: "warning",
      metric: 1,
      url: `${BASE}/s/acme-co`,
    });
  });

  it("ranks a complaint above a bounce: severity critical", () => {
    const items = collectDeliveryFailures([report({ deliveryStatus: "complained" })], byId, BASE);
    expect(items[0]!.severity).toBe("critical");
  });

  it("ignores delivered and pending reports (only bounced/complained qualify)", () => {
    const items = collectDeliveryFailures(
      [
        report({ id: "rec_a", deliveryStatus: "delivered" }),
        report({ id: "rec_b", deliveryStatus: "pending" }),
      ],
      byId,
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("skips an orphan report whose site is not in the map (no broken link)", () => {
    const items = collectDeliveryFailures(
      [report({ siteId: "rec_missing", deliveryStatus: "bounced" })],
      byId,
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("keys on the report record id so two failures on the same site stay distinct", () => {
    const items = collectDeliveryFailures(
      [
        report({ id: "rec_x", deliveryStatus: "bounced" }),
        report({ id: "rec_y", deliveryStatus: "complained" }),
      ],
      byId,
      BASE,
    );
    expect(items.map((i) => i.key)).toEqual(["delivery:rec_x", "delivery:rec_y"]);
  });

  it("title names the failure mode for the operator", () => {
    const bounced = collectDeliveryFailures([report({ deliveryStatus: "bounced" })], byId, BASE);
    const complained = collectDeliveryFailures(
      [report({ id: "rec_c", deliveryStatus: "complained" })],
      byId,
      BASE,
    );
    expect(bounced[0]!.title).toMatch(/bounce/i);
    expect(complained[0]!.title).toMatch(/complaint|complained/i);
  });
});

// A fixed "now" + helpers for the GitHub-signals staleness gate (shared by the
// Renovate + CI describes). Fresh = swept just now; stale = >3 days before NOW.
const NOW = new Date("2026-06-11T12:00:00Z");
const FRESH = "2026-06-11T06:00:00Z"; // 6h ago — well within the 3-day window
const STALE = "2026-06-07T00:00:00Z"; // ~4.5 days before NOW — past the 3-day floor

describe("collectRenovateAlerts (persisted field)", () => {
  it("flags a site with failing Renovate PRs: key, kind, metric=count, warning, dashboard url", () => {
    const items = collectRenovateAlerts(
      [site({ id: "rec1", name: "Acme Co", renovateFailingCis: 3, githubSignalsAt: FRESH })],
      BASE,
      NOW,
    );
    expect(items).toEqual([
      {
        key: "renovate:rec1",
        kind: "renovate",
        siteName: "Acme Co",
        title: "3 Renovate PRs failing CI",
        url: `${BASE}/s/acme-co`,
        severity: "warning",
        metric: 3,
      },
    ]);
  });

  it("singularizes one and skips zero/null", () => {
    expect(
      collectRenovateAlerts(
        [site({ renovateFailingCis: 1, githubSignalsAt: FRESH })],
        BASE,
        NOW,
      )[0]!.title,
    ).toBe("1 Renovate PR failing CI");
    expect(
      collectRenovateAlerts([site({ renovateFailingCis: 0, githubSignalsAt: FRESH })], BASE, NOW),
    ).toEqual([]);
    expect(
      collectRenovateAlerts(
        [site({ renovateFailingCis: null, githubSignalsAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores a site whose GitHub-signals sweep is >3 days stale (phantom count never clears)", () => {
    expect(
      collectRenovateAlerts([site({ renovateFailingCis: 3, githubSignalsAt: STALE })], BASE, NOW),
    ).toEqual([]);
  });

  it("ignores a site that was never swept (null githubSignalsAt → no signal to trust)", () => {
    expect(
      collectRenovateAlerts([site({ renovateFailingCis: 3, githubSignalsAt: null })], BASE, NOW),
    ).toEqual([]);
  });
});

describe("collectCiAlerts (persisted field)", () => {
  it("flags a site whose default-branch CI is failing", () => {
    const items = collectCiAlerts(
      [site({ id: "rec1", name: "Acme Co", defaultBranchCi: "failing", githubSignalsAt: FRESH })],
      BASE,
      NOW,
    );
    expect(items).toEqual([
      {
        key: "ci:rec1",
        kind: "ci",
        siteName: "Acme Co",
        title: "Default-branch CI failing",
        url: `${BASE}/s/acme-co`,
        severity: "warning",
        metric: 1,
      },
    ]);
  });

  it("ignores passing/pending/none/null", () => {
    for (const v of ["passing", "pending", "none", null]) {
      expect(
        collectCiAlerts([site({ defaultBranchCi: v, githubSignalsAt: FRESH })], BASE, NOW),
      ).toEqual([]);
    }
  });

  it("ignores a failing CI whose GitHub-signals sweep is >3 days stale (phantom 🔴 never clears)", () => {
    expect(
      collectCiAlerts([site({ defaultBranchCi: "failing", githubSignalsAt: STALE })], BASE, NOW),
    ).toEqual([]);
  });

  it("ignores a failing CI on a never-swept site (null githubSignalsAt)", () => {
    expect(
      collectCiAlerts([site({ defaultBranchCi: "failing", githubSignalsAt: null })], BASE, NOW),
    ).toEqual([]);
  });

  it("flags a failing CI exactly at the freshness boundary (just under 3 days)", () => {
    // 3 days minus a minute before NOW — still fresh, so the alert fires.
    const justFresh = new Date(NOW.getTime() - (3 * 24 * 60 * 60 * 1000 - 60_000)).toISOString();
    const items = collectCiAlerts(
      [site({ id: "rec1", defaultBranchCi: "failing", githubSignalsAt: justFresh })],
      BASE,
      NOW,
    );
    expect(items).toHaveLength(1);
  });
});
