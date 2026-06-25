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
    expect(html).toContain('rel="icon"'); // reddoor favicon
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

describe("renderCockpitHtml — lighthouse score labels", () => {
  it("labels each of the four lighthouse scores using the metric-label pattern", () => {
    const html = renderCockpitHtml(
      model([siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 90 })]),
    );
    // Same metric-label treatment the health cluster already uses, so the bare
    // numbers read as Perf / Access / BP / SEO.
    for (const label of ["Perf", "Access", "BP", "SEO"]) {
      expect(html).toContain(`<span class="metric-label">${label}</span>`);
    }
  });
});

describe("renderCockpitHtml — setup chip tooltip", () => {
  it("lists the missing onboarding items in the setup chip title when incomplete", () => {
    const html = renderCockpitHtml(
      model([siteRow({ pointOfContact: null, reportRecipientsTo: null })]),
    );
    expect(html).toContain('title="Missing: Report recipients, Point of contact"');
  });

  it("says the setup is complete in the title when fully onboarded", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('title="Setup complete"');
  });

  it("escapes the setup title text", () => {
    // A site missing only the audit still produces a stable, escaped title;
    // assert the chip carries a title attribute on the setup span.
    const html = renderCockpitHtml(model([siteRow({ lastLighthouseAuditAt: null })]));
    expect(html).toMatch(/<span class="setup" title="Missing: First audit">/);
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

describe("verdict bar", () => {
  it("shows All clear when nothing needs the operator", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).toContain("✓ All clear");
    expect(html).toContain("↻ Audit fleet");
    expect(html).not.toContain("needs attention</span>"); // old summary tally gone
  });

  it("shows the per-site need count when something is wrong", () => {
    // A single pending-approval report deterministically yields ONE Needs-you feed
    // item (avoids coupling to the vuln auto-fix-exhausted plumbing). Mirrors the
    // pending ReportRow the approve-strip test builds below.
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme" })],
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
    expect(html).toMatch(/⚠ 1 site needs you/);
    expect(html).not.toContain("✓ All clear");
  });
});

describe("renderCockpitHtml — verdict bar (replaces the summary tally)", () => {
  it("sums the per-site Needs-you count across slipping + approval sites", () => {
    // Mid (watch-band Lighthouse → slipping) + Acme (pending approval) each land on
    // the feed; Good is healthy → 2 sites need the operator. (A non-exhausted vuln is
    // gated off the feed, so the count is feed-driven, not tier-driven.)
    const m = buildCockpitModel(
      [
        siteRow({ id: "w", name: "Mid", pScore: 80 }),
        siteRow({ id: "recSITE", name: "Acme" }),
        siteRow({ id: "g", name: "Good" }),
      ],
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
    expect(html).toMatch(/⚠ 2 sites need you/);
    expect(html).not.toContain("✓ All clear");
  });

  it("houses the ↻ Audit fleet button (filter chips moved out of the verdict)", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("↻ Audit fleet");
    expect(html).toContain('class="refresh-fleet"');
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

describe("renderCockpitHtml — submissions strip cap", () => {
  /** Minimal new-submission row; buildCockpitModel only reads id/siteId/formType/name/email/submittedAt. */
  function sub(siteId: string, n: number) {
    return {
      id: `sub${n}`,
      siteId,
      formType: "contact",
      name: `Person ${n}`,
      email: `p${n}@example.com`,
      // Descending timestamps so n=1 is newest.
      submittedAt: `2026-06-${String(20 - (n % 20)).padStart(2, "0")}T12:00:00Z`,
    } as never;
  }

  it("caps the strip at 10 rows, keeps the true total in the heading, and links onward", () => {
    const newSubs = Array.from({ length: 13 }, (_, i) => sub("recSITE", i + 1));
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [],
      {},
      BASE,
      NOW,
      newSubs,
    );
    const html = renderCockpitHtml(m);
    const rendered = (html.match(/data-signal="submissions"/g) ?? []).length;
    expect(rendered).toBe(10);
    expect(html).toContain("New submissions (13)"); // true total, not the capped count
    expect(html).toContain("+3 more");
  });

  it("renders every row and no '+more' line when at or under the cap", () => {
    const newSubs = Array.from({ length: 4 }, (_, i) => sub("recSITE", i + 1));
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [],
      {},
      BASE,
      NOW,
      newSubs,
    );
    const html = renderCockpitHtml(m);
    expect((html.match(/data-signal="submissions"/g) ?? []).length).toBe(4);
    expect(html).toContain("New submissions (4)");
    expect(html).not.toMatch(/\+\d+ more/);
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

  it("tags a maintenance site still on *.netlify.app with the no-domain signal", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          id: "nd",
          name: "NoDomain",
          status: "maintenance",
          url: "https://x.netlify.app",
        }),
      ]),
    );
    expect(html).toMatch(/data-signals="[^"]*no-domain[^"]*"/);
  });

  it("renders the ok verdict when nothing needs attention", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('class="verdict ok"');
    expect(html).toContain("✓ All clear");
  });

  it("renders the warn verdict when a site is on the Needs-you feed", () => {
    // A watch-band Lighthouse site (slipping) is a deterministic feed item — the
    // verdict tracks the feed, so warn shows.
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toContain('class="verdict warn"');
    expect(html).not.toContain("✓ All clear");
  });

  it("the filter script short-circuits 'pending' so it never hides triage cards", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    // The pending branch must return before the card-hiding loop.
    expect(html).toMatch(/f === 'pending'[^]*?return;/);
  });
});

describe("renderCockpitHtml — GitHub-signal chips & filters (slice 2b)", () => {
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
});

describe("renderCockpitHtml — spam roll-up", () => {
  it("shows fleet caught + through totals when spam data is present", () => {
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [],
      {},
      BASE,
      NOW,
      [],
      {
        honeypot: 560,
        tooFast: 52,
        markedSpam: 24,
      },
    );
    const html = renderCockpitHtml(m);
    expect(html).toMatch(/spam/i);
    expect(html).toContain("612"); // caught = honeypot + too-fast
    expect(html).toContain("24"); // through = marked spam
  });

  it("omits the roll-up when there is no spam data", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).not.toMatch(/spam caught/i);
  });
});

describe("renderCockpitHtml — auto-fix-exhausted vuln", () => {
  it("tags the card with the auto-fix-failed signal and a stuck chip", () => {
    const html = renderCockpitHtml(
      model([siteRow({ name: "Stuck Co", securityVulnsCritical: 2, securityAutoFixAttempts: 3 })]),
    );
    // data-signals carries BOTH the base vuln token and the new one
    expect(html).toMatch(/data-signals="[^"]*\bvulns\b[^"]*"/);
    expect(html).toMatch(/data-signals="[^"]*\bauto-fix-failed\b[^"]*"/);
    // the chip renders with the distinct stuck class + escalated text
    expect(html).toContain("chip critical stuck");
    expect(html).toContain("auto-fix failed (3×)");
  });
});

describe("renderCockpitHtml — Trigger Renovate button", () => {
  it("shows a Trigger Renovate button only for repo-backed sites", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ name: "Has Repo", gitRepo: "reddoorla/hasrepo" }),
        siteRow({ name: "No Repo", gitRepo: null }),
      ]),
    );
    expect(html).toContain('data-trigger-url="/api/sites/has-repo/trigger-renovate"');
    expect(html).not.toContain("/api/sites/no-repo/trigger-renovate");
    expect(html).toContain("Trigger Renovate");
  });
});

describe("renderCockpitHtml — Audit fleet button + live status", () => {
  it("renders a fleet audit button wired to POST /api/fleet/refresh", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('class="refresh-fleet"');
    expect(html).toContain('data-refresh-url="/api/fleet/refresh"');
    expect(html).toContain("↻ Audit fleet");
  });

  it("includes the live-status panel scaffold and the poll endpoint", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('id="rf-status"');
    expect(html).toContain("/api/fleet/refresh/status?since=");
  });

  it("wires localStorage resume so a mid-run reload keeps following", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("reddoor:fleet-refresh");
    expect(html).toMatch(/localStorage/);
  });

  it("the spinner client carries the phase/eta/run-link detail wiring", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("view run"); // run link shown while running
    expect(html).toContain("rf-sub"); // the detail sub-line class
    expect(html).toContain("auditing the fleet"); // phase humanization
    expect(html).toContain("~48m"); // lighthouse ETA
    expect(html).toContain("~2m"); // security ETA
  });
});
