import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const BASE = "https://reddoor-maintenance.netlify.app";
const NOW = new Date("2026-06-11T12:00:00Z");

/** Build a real model from site rows so render tests exercise the true shape. */
function model(
  sites: Parameters<typeof buildCockpitModel>[0],
  reports: Parameters<typeof buildCockpitModel>[1] = [],
) {
  return buildCockpitModel(sites, reports, {}, BASE, NOW);
}

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    reportRecipientsTo: "tucker@reddoorla.com",
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  });
}

describe("renderCockpitHtml — document shell", () => {
  it("returns a full HTML document", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
  });

  it("includes a sensible page title", () => {
    const html = renderCockpitHtml(model([]));
    expect(html).toMatch(/<title>[^<]*Reddoor[^<]*<\/title>/);
  });
});

describe("renderCockpitHtml — card per site", () => {
  it('emits one <article class="card"> per site', () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "rec1", name: "Acme Co" }),
        siteRow({ id: "rec2", name: "Beta Inc" }),
        siteRow({ id: "rec3", name: "Gamma LLC" }),
      ]),
    );
    const cards = html.match(/<article class="card"/g) ?? [];
    expect(cards).toHaveLength(3);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links the site name to /s/<slug> with no token (operator-only dashboard)", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "CalTex" })]));
    expect(html).toContain('href="/s/caltex"');
    expect(html).not.toContain("?t=");
  });
});

describe("renderCockpitHtml — header row (setup + audited)", () => {
  it("shows '4/4' when the site is fully onboarded", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain(">4/4<");
  });

  it("shows the partial fraction when the site is missing some onboarding signals", () => {
    const html = renderCockpitHtml(
      model([siteRow({ pointOfContact: null, reportRecipientsTo: null })]),
    );
    expect(html).toContain(">2/4<");
  });

  it("renders the lighthouse-audited timestamp as a relative-time string", () => {
    const audited = renderCockpitHtml(model([siteRow()]));
    expect(audited).toMatch(/(just now|\d+[mhdw]o? ago)/);

    const never = renderCockpitHtml(model([siteRow({ lastLighthouseAuditAt: null })]));
    expect(never).toMatch(/Audited[^<]*<[^>]*>\s*—\s*</);
  });
});

describe("renderCockpitHtml — metrics row", () => {
  it("renders the four lighthouse scores", () => {
    const html = renderCockpitHtml(
      model([siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 })]),
    );
    expect(html).toContain(">73<");
    expect(html).toContain(">78<");
  });

  it("renders an em-dash placeholder for null lighthouse scores", () => {
    const html = renderCockpitHtml(
      model([siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null })]),
    );
    expect(html).not.toContain(">null<");
    expect(html).toMatch(/<span class="score perf">—<\/span>/);
  });

  it("renders the a11y violation count", () => {
    const html = renderCockpitHtml(model([siteRow({ a11yViolations: 3 })]));
    expect(html).toMatch(/<span class="metric a11y">3<\/span>/);
  });

  it("renders '—' for a never-audited a11y count", () => {
    const html = renderCockpitHtml(model([siteRow({ a11yViolations: null })]));
    expect(html).toMatch(/<span class="metric a11y">—<\/span>/);
  });

  it("renders deps as 'N drifted (M major)' when there is drift", () => {
    const html = renderCockpitHtml(model([siteRow({ depsDrifted: 5, depsMajorBehind: 1 })]));
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
  });

  it("renders deps with '(0 major)' when there is non-major drift only", () => {
    const html = renderCockpitHtml(model([siteRow({ depsDrifted: 5, depsMajorBehind: 0 })]));
    expect(html).toMatch(/<span class="metric deps">5 drifted \(0 major\)<\/span>/);
  });

  it("renders deps as '0' when clean", () => {
    const html = renderCockpitHtml(model([siteRow({ depsDrifted: 0, depsMajorBehind: 0 })]));
    expect(html).toMatch(/<span class="metric deps">0<\/span>/);
  });

  it("renders deps as '—' when never audited", () => {
    const html = renderCockpitHtml(model([siteRow({ depsDrifted: null, depsMajorBehind: null })]));
    expect(html).toMatch(/<span class="metric deps">—<\/span>/);
  });

  it("appends the outdated-install count to deps when it was determined", () => {
    const html = renderCockpitHtml(
      model([siteRow({ depsDrifted: 5, depsMajorBehind: 1, depsOutdated: 3 })]),
    );
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\) · 3 outdated<\/span>/);
  });

  it("shows the outdated count even when declared-range drift is clean", () => {
    const html = renderCockpitHtml(
      model([siteRow({ depsDrifted: 0, depsMajorBehind: 0, depsOutdated: 2 })]),
    );
    expect(html).toMatch(/<span class="metric deps">0 · 2 outdated<\/span>/);
  });

  it("omits the outdated part when it wasn't determined (null), not implying clean", () => {
    const html = renderCockpitHtml(
      model([siteRow({ depsDrifted: 5, depsMajorBehind: 1, depsOutdated: null })]),
    );
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
    expect(html).not.toContain("outdated");
  });

  it("renders security as 'C/H/M/L' format when there are vulns", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          securityVulnsCritical: 1,
          securityVulnsHigh: 2,
          securityVulnsModerate: 3,
          securityVulnsLow: 4,
        }),
      ]),
    );
    expect(html).toMatch(/<span class="metric sec">1C\/2H\/3M\/4L<\/span>/);
  });

  it("renders security as '0' when clean", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          securityVulnsCritical: 0,
          securityVulnsHigh: 0,
          securityVulnsModerate: 0,
          securityVulnsLow: 0,
        }),
      ]),
    );
    expect(html).toMatch(/<span class="metric sec">0<\/span>/);
  });

  it("renders security as '—' when never audited", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          securityVulnsCritical: null,
          securityVulnsHigh: null,
          securityVulnsModerate: null,
          securityVulnsLow: null,
        }),
      ]),
    );
    expect(html).toMatch(/<span class="metric sec">—<\/span>/);
  });
});

describe("renderCockpitHtml — escaping & safety", () => {
  it("escapes HTML in site names and URLs", () => {
    const html = renderCockpitHtml(
      model([siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" })]),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe("renderCockpitHtml — summary bar", () => {
  it("shows the three tier counts", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1 }),
        siteRow({ id: "w", name: "Mid", pScore: 80 }),
        siteRow({ id: "g", name: "Good" }),
      ]),
    );
    expect(html).toMatch(/1[^<]*needs attention/i);
    expect(html).toMatch(/1[^<]*watch/i);
    expect(html).toMatch(/1[^<]*healthy/i);
  });

  it("renders filter chips with data-filter hooks", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    for (const f of ["all", "vulns", "lighthouse", "delivery", "stale", "pending"]) {
      expect(html).toContain(`data-filter="${f}"`);
    }
  });

  it("renders the headline counts (vulns / lighthouse / delivery / pending)", () => {
    const html = renderCockpitHtml(
      model(
        [
          siteRow({
            id: "a",
            name: "Bad",
            securityVulnsCritical: 2,
            securityVulnsHigh: 1,
            pScore: 60,
          }),
        ],
        [],
      ),
    );
    expect(html).toMatch(/3[^<]*vuln/i); // criticalHighVulns = 3
  });
});

describe("renderCockpitHtml — approve strip", () => {
  it("renders an approve button per pending report, mirroring the per-site endpoint", () => {
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [
        {
          id: "r1",
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
        } as never,
      ],
      {},
      BASE,
      NOW,
    );
    const html = renderCockpitHtml(m);
    expect(html).toContain("Acme Co");
    expect(html).toContain('data-approve-url="/api/reports/r1/approve"');
    expect(html).toContain('class="approve"');
    expect(html).toMatch(/your daily yes|approve \(1\)/i);
  });

  it("renders no approve strip when nothing is pending", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    // No rendered strip element (the .approve-strip CSS in STYLES is always present).
    expect(html).not.toContain('<section class="approve-strip"');
  });
});

describe("renderCockpitHtml — cockpit cards", () => {
  it("puts a status pill and the site's attention chips on the card, with data-signals", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          id: "a",
          name: "Bad",
          securityVulnsCritical: 2,
          securityVulnsHigh: 1,
          pScore: 60,
        }),
      ]),
    );
    expect(html).toMatch(/class="pill attention"/);
    expect(html).toContain('data-signals="'); // present on the card
    expect(html).toMatch(/2 critical\/high|3 critical\/high/); // vuln chip text from the collector title
    expect(html).toMatch(/Lighthouse Performance 60/); // lighthouse chip
  });

  it("renders a NEW badge for a freshly-flagged item and WORSE for a risen metric", () => {
    const newHtml = renderCockpitHtml(
      model([siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1 })]), // prior {} → NEW
    );
    expect(newHtml).toMatch(/class="badge">NEW/);

    const worse = buildCockpitModel(
      [siteRow({ id: "a", name: "Bad", securityVulnsCritical: 3 })],
      [],
      { "vuln:a": { metric: 1, firstFlaggedAt: "2026-06-01" } },
      BASE,
      NOW,
    );
    expect(renderCockpitHtml(worse)).toMatch(/class="badge">WORSE/);
  });

  it("shows the watch reasons on a watch-tier card", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toMatch(/Performance 80/);
  });

  it("includes the filter script with the data-filter wiring", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("data-filter");
    expect(html).toMatch(/querySelectorAll|addEventListener/);
  });
});

describe("renderCockpitHtml — filter signals & all-clear", () => {
  it("a watch-band Lighthouse site carries the 'lighthouse' filter signal", () => {
    // pScore 80 ∈ [75,85) with the other categories healthy → watch via Lighthouse.
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toMatch(/data-signals="[^"]*lighthouse[^"]*"/);
  });

  it("a commit-stale site carries the 'stale' filter signal (not the lighthouse one)", () => {
    // Healthy scores but the last commit is >30d before NOW → watch via staleness only.
    const html = renderCockpitHtml(
      model([siteRow({ id: "s", name: "Stale", lastCommitAt: "2026-01-01T00:00:00Z" })]),
    );
    expect(html).toMatch(/data-signals="[^"]*stale[^"]*"/);
    expect(html).not.toMatch(/data-signals="[^"]*lighthouse[^"]*"/);
  });

  it("renders the all-clear banner when nothing needs attention", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("all-clear");
    expect(html).toMatch(/all clear/i);
  });

  it("omits the all-clear banner when a site is on the attention tier", () => {
    const html = renderCockpitHtml(
      model([siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1 })]),
    );
    expect(html).not.toMatch(/class="all-clear"/);
  });

  it("the filter script short-circuits 'pending' so it never hides triage cards", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    // The pending branch must return before the card-hiding loop.
    expect(html).toMatch(/f === 'pending'[^]*?return;/);
  });
});

describe("renderCockpitHtml — GitHub-signal chips & filters (slice 2b)", () => {
  it("renders prs/ci filter chips", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('data-filter="prs"');
    expect(html).toContain('data-filter="ci"');
  });

  it("a Renovate-failing card carries the prs signal + its chip", () => {
    const html = renderCockpitHtml(
      model([siteRow({ id: "a", name: "Reno", renovateFailingCis: 2 })]),
    );
    expect(html).toMatch(/data-signals="[^"]*prs[^"]*"/);
    expect(html).toMatch(/2 Renovate PRs failing CI/);
  });

  it("a CI-red card carries the ci signal + its chip", () => {
    const html = renderCockpitHtml(
      model([siteRow({ id: "b", name: "CiRed", defaultBranchCi: "failing" })]),
    );
    expect(html).toMatch(/data-signals="[^"]*ci[^"]*"/);
    expect(html).toMatch(/Default-branch CI failing/);
  });

  it("the summary headline shows the PRs-failing and CI-red counts", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "a", name: "Reno", renovateFailingCis: 2, defaultBranchCi: "failing" }),
      ]),
    );
    expect(html).toMatch(/2 PRs failing/);
    expect(html).toMatch(/1 CI red/);
  });
});
