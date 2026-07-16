// tests/alerts/digest-collectors.test.ts
import { describe, it, expect } from "vitest";
import {
  collectTurnstileGuardrailAlerts,
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
  collectAnalyticsFailures,
  collectPreflightBlocked,
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

  it("does NOT flag exhausted below the threshold (attempts 2 → normal vuln item)", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 1, securityVulnsHigh: 0, securityAutoFixAttempts: 2 })],
      BASE,
    );
    expect(items[0]!.autoFixExhausted).toBeUndefined();
    expect(items[0]!.title).toBe("1 critical/high vuln");
    expect(items[0]!.severity).toBe("critical");
  });

  it("flags exhausted at the threshold (attempts 3): forced-critical, flag set, escalated title", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 2, securityAutoFixAttempts: 3 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "vuln:rec_site_acme",
      kind: "vuln",
      severity: "critical", // forced critical even though it's high-only
      metric: 2,
      autoFixExhausted: true,
    });
    expect(items[0]!.title).toBe("2 critical/high vulns — auto-fix failed (3×)");
  });

  it("does not flag exhausted when there are no vulns even if a stale counter remains", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 0, securityAutoFixAttempts: 9 })],
      BASE,
    );
    expect(items).toEqual([]);
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
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
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

describe("collectAnalyticsFailures", () => {
  it("flags a site with a recent analyticsSoftFailAt: key, kind, severity warning, dashboard url", () => {
    const recent = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
    const items = collectAnalyticsFailures(
      [site({ id: "rec1", analyticsSoftFailAt: recent })],
      BASE,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "analytics:rec1",
      kind: "analytics",
      siteName: "Acme Co",
      severity: "warning",
      metric: 1,
      url: `${BASE}/s/acme-co`,
    });
  });

  it("skips a site whose enrichment is clean (null analyticsSoftFailAt)", () => {
    expect(collectAnalyticsFailures([site({ analyticsSoftFailAt: null })], BASE, NOW)).toEqual([]);
  });

  it("skips a stale soft-fail (older than 45 days — a site that stopped being drafted)", () => {
    const stale = new Date(NOW.getTime() - 46 * 24 * 60 * 60 * 1000).toISOString();
    expect(collectAnalyticsFailures([site({ analyticsSoftFailAt: stale })], BASE, NOW)).toEqual([]);
  });

  it("keeps a soft-fail just inside the 45-day window", () => {
    const justInside = new Date(NOW.getTime() - (45 * 24 * 60 * 60 * 1000 - 60_000)).toISOString();
    expect(
      collectAnalyticsFailures([site({ id: "rec1", analyticsSoftFailAt: justInside })], BASE, NOW),
    ).toHaveLength(1);
  });

  it("keeps an UNPARSEABLE timestamp (fail-safe: don't drop a real failure on a parse glitch)", () => {
    expect(
      collectAnalyticsFailures([site({ analyticsSoftFailAt: "not-a-date" })], BASE, NOW),
    ).toHaveLength(1);
  });

  it("emits one item PER failing site (the fleet-wide breadth is the signal)", () => {
    const recent = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const items = collectAnalyticsFailures(
      [
        site({ id: "recA", name: "A site", analyticsSoftFailAt: recent }),
        site({ id: "recB", name: "B site", analyticsSoftFailAt: recent }),
        site({ id: "recC", name: "C site", analyticsSoftFailAt: null }),
      ],
      BASE,
      NOW,
    );
    expect(items.map((i) => i.key).sort()).toEqual(["analytics:recA", "analytics:recB"]);
  });
});

describe("collectPreflightBlocked", () => {
  const site = (over: Partial<WebsiteRow> = {}) =>
    makeWebsiteRow({
      id: "recS1",
      name: "Acme Co",
      pointOfContact: "owner@acme.example.com",
      headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
      ...over,
    });
  const draft = (over: Partial<ReportRow> = {}): ReportRow =>
    ({
      id: "recR1",
      reportId: "rep_1",
      siteId: "recS1",
      reportType: "Announcement",
      period: "2026-07",
      periodStart: null,
      periodEnd: null,
      completedOn: null,
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
      gaUsersCurrent: null,
      gaUsersPrevious: null,
      searchFoundPage1: null,
      searchPosition: null,
      lastTestedDate: null,
      commentary: null,
      subjectOverride: null,
      draftReady: true,
      approvedToSend: false,
      sentAt: null,
      approvedAt: null,
      approvedBy: null,
      deliveryStatus: "pending",
      renderedHtmlAttachment: null,
      resendMessageId: null,
      checklist: {},
      autoEvidence: null,
      ...over,
    }) as ReportRow;

  it("emits nothing for send-clean drafts", () => {
    const items = collectPreflightBlocked([draft()], new Map([["recS1", site()]]), "https://d");
    expect(items).toEqual([]);
  });

  it("warns on a pending draft with blockers; critical when already approved", () => {
    const blockedSite = site({ pointOfContact: null });
    const sitesById = new Map([["recS1", blockedSite]]);
    const pending = collectPreflightBlocked([draft()], sitesById, "https://d");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      key: "preflight:recR1:pending",
      kind: "preflight",
      severity: "warning",
      siteName: "Acme Co",
    });
    expect(pending[0]!.title).toContain("recipients-missing");

    const approved = collectPreflightBlocked(
      [draft({ approvedToSend: true })],
      sitesById,
      "https://d",
    );
    expect(approved[0]!.severity).toBe("critical");
    expect(approved[0]!.title).toContain("will fail at send");
    // The approved state rides the key so the pending→approved escalation
    // re-news as a fresh critical instead of diffing "standing".
    expect(approved[0]!.key).toBe("preflight:recR1:approved");
    expect(approved[0]!.key).not.toBe(pending[0]!.key);
  });

  it("skips sent reports", () => {
    const sitesById = new Map([["recS1", site({ pointOfContact: null })]]);
    expect(
      collectPreflightBlocked([draft({ sentAt: "2026-07-01" })], sitesById, "https://d"),
    ).toEqual([]);
  });

  it("surfaces a dangling Site link as site-not-found (the send fails exactly that way)", () => {
    const sitesById = new Map([["recS1", site()]]);
    const items = collectPreflightBlocked(
      [draft({ siteId: "recGHOST", approvedToSend: true })],
      sitesById,
      "https://d",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "preflight",
      severity: "critical",
      siteName: "(unlinked site)",
      url: "https://d",
    });
    expect(items[0]!.title).toContain("site-not-found");
  });
});

describe("collectTurnstileGuardrailAlerts", () => {
  const NOW = new Date("2026-07-16T00:00:00.000Z");
  const fresh = "2026-07-15T08:00:00.000Z"; // < 3 days old
  const stale = "2026-07-01T08:00:00.000Z"; // > 3 days old

  it("alarms (critical) ONLY for requireTurnstile + fresh widget fail", () => {
    const sites = [
      makeWebsiteRow({
        id: "recGATED",
        name: "Gated",
        requireTurnstile: true,
        turnstileWidget: "fail",
        functionHealthCheckedAt: fresh,
      }),
      // flag off — a failing widget alone is not an alarm (nothing buckets)
      makeWebsiteRow({
        id: "recOFF",
        name: "Off",
        requireTurnstile: false,
        turnstileWidget: "fail",
        functionHealthCheckedAt: fresh,
      }),
      // gated but widget confirmed present
      makeWebsiteRow({
        id: "recOK",
        name: "Ok",
        requireTurnstile: true,
        turnstileWidget: "pass",
        functionHealthCheckedAt: fresh,
      }),
      // gated, widget state unknown → assignTier's watch, not an alarm
      makeWebsiteRow({
        id: "recNULL",
        name: "Unknown",
        requireTurnstile: true,
        turnstileWidget: null,
        functionHealthCheckedAt: fresh,
      }),
    ];
    const items = collectTurnstileGuardrailAlerts(sites, BASE, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "turnstile:recGATED",
      kind: "turnstile",
      siteName: "Gated",
      severity: "critical",
      metric: 1,
    });
  });

  it("downgrades a STALE fail to no item (assignTier raises the watch instead); unparseable stamp keeps the item", () => {
    const staleFail = makeWebsiteRow({
      id: "recSTALE",
      name: "Stale",
      requireTurnstile: true,
      turnstileWidget: "fail",
      functionHealthCheckedAt: stale,
    });
    expect(collectTurnstileGuardrailAlerts([staleFail], BASE, NOW)).toHaveLength(0);

    // an unparseable checked-at must NOT silently drop a real failure
    const junkStamp = makeWebsiteRow({
      id: "recJUNK",
      name: "Junk",
      requireTurnstile: true,
      turnstileWidget: "fail",
      functionHealthCheckedAt: "not-a-date",
    });
    expect(collectTurnstileGuardrailAlerts([junkStamp], BASE, NOW)).toHaveLength(1);
  });
});
