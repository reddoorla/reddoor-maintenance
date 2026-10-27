import { describe, it, expect } from "vitest";
import { renderCockpitHtml, renderSitesHtml } from "./render.js";
import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import { mapRow } from "../../../src/fleet/site-fields.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { gatingFields } from "../../../src/reports/checklist.js";

const BASE = "https://reddoor-maintenance.netlify.app";
const NOW = new Date("2026-06-11T12:00:00Z");

/** An all-pass Maintenance gating-evidence map, so pending-approval fixtures below
 *  stay health-clean and keep testing exactly what they tested before healthBlockers
 *  was folded into approveBlockers (health-gate phase 8) — the cockpit's
 *  collectPreflightBlocked collector now reads this too. */
const healthCleanEvidence = () =>
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
    ]),
  );

/** Build a real model from site rows so render tests exercise the true shape. */
function model(
  sites: Parameters<typeof buildCockpitModel>[0],
  reports: Parameters<typeof buildCockpitModel>[1] = [],
  prior: Parameters<typeof buildCockpitModel>[2] = {},
) {
  return buildCockpitModel(sites, reports, prior, BASE, NOW);
}

/** Dates a site's vuln key past DIRECT_VULN_WAIT_DAYS, so its vuln has stopped waiting. */
function escalated(id: string, metric = 99) {
  return { [`vuln:${id}`]: { metric, firstFlaggedAt: "2026-05-01" } };
}

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:acme.example.com",
    searchConsoleOutcome: "resolved",
    searchConsoleResolved: "sc-domain:acme.example.com",
    searchConsoleCheckedAt: new Date().toISOString(),
    // The roster identities the sweeps need (#889); without them a maintained
    // row watches for "Git repo / Netlify ID not recorded".
    gitRepo: "reddoorla/acme",
    netlifyId: "11111111-2222-3333-4444-555555555555",
    // Send-clean: the cockpit now runs collectPreflightBlocked, so a pending
    // report on a site missing its header image would tier the site "watch"
    // and change the verdict these tests assert.
    headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
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
  it("includes a sensible page title", () => {
    const html = renderCockpitHtml(model([]));
    expect(html).toMatch(/<title>[^<]*Reddoor[^<]*<\/title>/);
  });
});

describe("renderCockpitHtml — card per site", () => {
  // #672 step 3: the cards merged into Sites' table, one row per site.
  it("emits one Sites row per site, each with its card's health", () => {
    const html = renderSitesHtml(
      model([
        siteRow({ id: "rec1", name: "Acme Co" }),
        siteRow({ id: "rec2", name: "Beta Inc" }),
        siteRow({ id: "rec3", name: "Gamma LLC" }),
      ]),
    );
    const rows = html.match(/<tr class="fleet-row"/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(html.match(/<td class="health">\s*<span class="pill /g) ?? []).toHaveLength(3);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links the site name to /s/<slug> with no token (operator-only dashboard)", () => {
    const html = renderSitesHtml(model([siteRow({ name: "CalTex" })]));
    expect(html).toContain('href="/s/caltex"');
    expect(html).not.toContain("?t=");
  });
});

describe("renderCockpitHtml — header row (setup + audited)", () => {
  it("shows '6/6' when the site is fully onboarded", () => {
    const html = renderSitesHtml(model([siteRow()]));
    expect(html).toContain(">6/6<");
  });

  it("shows the partial fraction when the site is missing some onboarding signals", () => {
    const html = renderSitesHtml(
      model([siteRow({ pointOfContact: null, reportRecipientsTo: null })]),
    );
    expect(html).toContain(">4/6<");
  });

  // #672 step 3: on Sites the table's Last audit column carries it, as a date.
  it("renders the lighthouse-audited time in the Last audit column", () => {
    const audited = renderSitesHtml(model([siteRow()]));
    expect(audited).toMatch(
      /<td><span title="2026-05-27T18:00:00Z">2026-05-27<\/span><\/td>\s*<td class="health">/,
    );

    const never = renderSitesHtml(model([siteRow({ lastLighthouseAuditAt: null })]));
    expect(never).toMatch(/<td>—<\/td>\s*<td class="health">/);
  });
});

describe("renderCockpitHtml — metrics row", () => {
  it("renders the four lighthouse scores", () => {
    const html = renderSitesHtml(
      model([siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 })]),
    );
    expect(html).toContain(">73<");
    expect(html).toContain(">78<");
  });

  it("renders an em-dash placeholder for null lighthouse scores", () => {
    const html = renderSitesHtml(
      model([siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null })]),
    );
    expect(html).not.toContain(">null<");
    // #672 step 3: Sites' score columns.
    expect(html).toMatch(/(<td class="num">—<\/td>\s*){4}/);
  });

  it("renders the a11y violation count", () => {
    const html = renderSitesHtml(model([siteRow({ a11yViolations: 3 })]));
    expect(html).toMatch(/<span class="metric a11y">3<\/span>/);
  });

  it("marks an a11y count from a partial run with its route coverage (#910)", () => {
    const partial = renderSitesHtml(
      model([siteRow({ a11yViolations: 0, a11yRoutesScanned: 1, a11yRoutesTotal: 2 })]),
    );
    const complete = renderSitesHtml(
      model([siteRow({ a11yViolations: 0, a11yRoutesScanned: 2, a11yRoutesTotal: 2 })]),
    );
    expect(partial).toMatch(/<span class="metric a11y">0 \(1\/2 routes\)<\/span>/);
    expect(complete).toMatch(/<span class="metric a11y">0<\/span>/);
  });

  it("marks a run that scanned no routes as partial, and an unknown scanned count as nothing", () => {
    const none = renderSitesHtml(
      model([siteRow({ a11yViolations: 0, a11yRoutesScanned: 0, a11yRoutesTotal: 2 })]),
    );
    const unknown = renderSitesHtml(
      model([siteRow({ a11yViolations: 0, a11yRoutesScanned: null, a11yRoutesTotal: 2 })]),
    );
    expect(none).toMatch(/<span class="metric a11y">0 \(0\/2 routes\)<\/span>/);
    expect(unknown).toMatch(/<span class="metric a11y">0<\/span>/);
  });

  it("renders '—' for a never-audited a11y count", () => {
    const html = renderSitesHtml(model([siteRow({ a11yViolations: null })]));
    expect(html).toMatch(/<span class="metric a11y">—<\/span>/);
  });

  it("renders deps as 'N drifted (M major)' when there is drift", () => {
    const html = renderSitesHtml(model([siteRow({ depsDrifted: 5, depsMajorBehind: 1 })]));
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
  });

  it("renders deps with '(0 major)' when there is non-major drift only", () => {
    const html = renderSitesHtml(model([siteRow({ depsDrifted: 5, depsMajorBehind: 0 })]));
    expect(html).toMatch(/<span class="metric deps">5 drifted \(0 major\)<\/span>/);
  });

  it("renders deps as '0' when clean", () => {
    const html = renderSitesHtml(model([siteRow({ depsDrifted: 0, depsMajorBehind: 0 })]));
    expect(html).toMatch(/<span class="metric deps">0<\/span>/);
  });

  it("renders deps as '—' when never audited", () => {
    const html = renderSitesHtml(model([siteRow({ depsDrifted: null, depsMajorBehind: null })]));
    expect(html).toMatch(/<span class="metric deps">—<\/span>/);
  });

  it("appends the outdated-install count to deps when it was determined", () => {
    const html = renderSitesHtml(
      model([siteRow({ depsDrifted: 5, depsMajorBehind: 1, depsOutdated: 3 })]),
    );
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\) · 3 outdated<\/span>/);
  });

  it("shows the outdated count even when declared-range drift is clean", () => {
    const html = renderSitesHtml(
      model([siteRow({ depsDrifted: 0, depsMajorBehind: 0, depsOutdated: 2 })]),
    );
    expect(html).toMatch(/<span class="metric deps">0 · 2 outdated<\/span>/);
  });

  it("appends the registry-major count (majors behind npm) to the outdated part when known", () => {
    const html = renderSitesHtml(
      model([
        siteRow({ depsDrifted: 5, depsMajorBehind: 1, depsOutdated: 3, depsMajorOutdated: 2 }),
      ]),
    );
    expect(html).toMatch(
      /<span class="metric deps">5 drifted \(1 major\) · 3 outdated \(2 major\)<\/span>/,
    );
  });

  it("omits the registry-major part when not determined (null), keeping the bare outdated count", () => {
    const html = renderSitesHtml(
      model([
        siteRow({ depsDrifted: 0, depsMajorBehind: 0, depsOutdated: 2, depsMajorOutdated: null }),
      ]),
    );
    expect(html).toMatch(/<span class="metric deps">0 · 2 outdated<\/span>/);
  });

  it("omits the outdated part when it wasn't determined (null), not implying clean", () => {
    const html = renderSitesHtml(
      model([siteRow({ depsDrifted: 5, depsMajorBehind: 1, depsOutdated: null })]),
    );
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
    expect(html).not.toContain("outdated");
  });

  it("renders security as 'C/H/M/L' format when there are vulns", () => {
    const html = renderSitesHtml(
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
    const html = renderSitesHtml(
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
    const html = renderSitesHtml(
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
    const html = renderSitesHtml(
      model([siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 90 })]),
    );
    // #672 step 3: on Sites the table's column headers name the bare numbers.
    for (const label of ["Perf", "Access", "BP", "SEO"]) {
      expect(html).toMatch(new RegExp(`<th class="num"><a href="[^"]*">${label}</a>`));
    }
  });
});

describe("renderCockpitHtml — setup chip tooltip", () => {
  it("lists the missing onboarding items in the setup chip title when incomplete", () => {
    const html = renderSitesHtml(
      model([siteRow({ pointOfContact: null, reportRecipientsTo: null })]),
    );
    expect(html).toContain('title="Missing: Report recipients, Point of contact"');
  });

  it("says the setup is complete in the title when fully onboarded", () => {
    const html = renderSitesHtml(model([siteRow()]));
    expect(html).toContain('title="Setup complete"');
  });

  it("escapes the setup title text", () => {
    // A site missing only the audit still produces a stable, escaped title;
    // assert the chip carries a title attribute on the setup span.
    const html = renderSitesHtml(model([siteRow({ lastLighthouseAuditAt: null })]));
    expect(html).toMatch(/<span class="setup" title="Missing: First audit">/);
  });
});

describe("renderCockpitHtml — escaping & safety", () => {
  it("escapes HTML in site names and URLs", () => {
    const html = renderSitesHtml(
      model([siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" })]),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script>");
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

  it("shows the blue waiting state when only an approval is pending", () => {
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
          withdrawnAt: null,
          deliveryStatus: "pending",
          autoEvidence: healthCleanEvidence(),
        } as never,
      ],
      {},
      BASE,
      NOW,
    );
    const html = renderCockpitHtml(m);
    expect(html).toContain('class="verdict soft"');
    expect(html).toContain("1 waiting on you");
    expect(html).not.toContain("✓ All clear");
  });
});

describe("renderCockpitHtml — verdict bar (replaces the summary tally)", () => {
  it("shows the amber watch headline when a watch site outranks a pending approval", () => {
    // Mid (watch-band Lighthouse → watch) + Acme (pending approval → blue) + Good
    // (healthy). Worst band is watch → amber headline; the approval + healthy counts
    // ride in the meta line.
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
          withdrawnAt: null,
          deliveryStatus: "pending",
          autoEvidence: healthCleanEvidence(),
        } as never,
      ],
      {},
      BASE,
      NOW,
    );
    const html = renderCockpitHtml(m);
    expect(html).toContain('class="verdict watch"');
    expect(html).toContain("1 to watch");
    expect(html).toContain("1 waiting on your yes");
    expect(html).toContain("1 healthy");
    expect(html).not.toContain("✓ All clear");
  });

  it("an accepted Best-Practices watch leaves the band but shows a muted accepted chip", () => {
    const html = renderSitesHtml(
      model([
        siteRow({
          id: "a",
          name: "Accepted",
          bpScore: 78,
          acceptedWatchConditions: ["Best Practices"],
        }),
      ]),
    );
    // Accepted → the site is healthy → verdict stays All clear (out of the Watch band)…
    const home = renderCockpitHtml(
      model([
        siteRow({
          id: "a",
          name: "Accepted",
          bpScore: 78,
          acceptedWatchConditions: ["Best Practices"],
        }),
      ]),
    );
    expect(home).toContain('class="verdict ok"');
    expect(home).toContain("✓ All clear");
    // …but the condition is still on record as a muted chip, on its Sites row.
    expect(html).toContain('class="chip accepted">✓ accepted: Best Practices 78');
  });

  it("the same BP-78 site shows the amber watch verdict when NOT accepted", () => {
    const m = model([siteRow({ id: "b", name: "Watched", bpScore: 78 })]);
    expect(renderCockpitHtml(m)).toContain('class="verdict watch"');
    // The chips are on the Sites row since #672 step 3.
    const row = renderSitesHtml(m);
    expect(row).toContain("Best Practices 78");
    expect(row).not.toContain("chip accepted");
  });
});

describe("renderCockpitHtml — generic accept matcher + accept-key discoverability", () => {
  const netlify = (over: Partial<WebsiteRow> = {}) =>
    siteRow({
      id: "nl",
      name: "NetlifyOnly",
      status: "maintained",
      url: "https://x.netlify.app",
      ...over,
    });

  it("mutes the no-custom-domain watch when accepted via the alias 'netlify'", () => {
    const m = model([netlify({ acceptedWatchConditions: ["netlify"] })]);
    // #672 step 3: the verdict is on `/`; the chip on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(home).toContain('class="verdict ok"');
    expect(home).toContain("✓ All clear");
    expect(html).toContain('class="chip accepted">✓ accepted: on *.netlify.app (no custom domain)');
  });

  it("still mutes the no-custom-domain watch via canonical 'no custom domain' (back-compat)", () => {
    const m = model([netlify({ acceptedWatchConditions: ["no custom domain"] })]);
    // #672 step 3: the verdict is on `/`; the chip on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(home).toContain('class="verdict ok"');
    expect(html).toContain('class="chip accepted">✓ accepted: on *.netlify.app (no custom domain)');
  });

  it("surfaces the canonical accept token on an un-accepted Setup gap, without a Watch", () => {
    // #672 step 2: no custom domain is a roster gap, so it is on the Setup
    // checklist and the verdict stays clear.
    const html = renderCockpitHtml(model([netlify()]));
    expect(html).toContain('class="verdict ok"');
    // The operator can see the EXACT string that would mute this gap.
    expect(html).toMatch(
      /<ul class="setup-gaps"[^>]*>\s*<li[^>]*>\s*<span aria-hidden="true">☐<\/span> on \*\.netlify\.app \(no custom domain\) · accept: "no custom domain"/,
    );
  });

  it("keys Lighthouse acceptance on the label and tolerates a changed score (78 muted)", () => {
    const m = model([
      siteRow({ id: "p", name: "Perf78", pScore: 78, acceptedWatchConditions: ["performance"] }),
    ]);
    // #672 step 3: the verdict is on `/`; the chip on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(home).toContain('class="verdict ok"');
    expect(html).toContain("✓ accepted: Performance 78");
  });

  it("re-alarms (attention, NOT muted) when the accepted category drops below the floor", () => {
    // pScore 72 < 75 arrives as an AttentionItem ABOVE the accept logic → broken; the
    // accepted "performance" key can never mute a sub-floor score.
    const m = model([
      siteRow({ id: "p", name: "Perf72", pScore: 72, acceptedWatchConditions: ["performance"] }),
    ]);
    const html = renderCockpitHtml(m);
    expect(html).toContain('class="verdict attention"');
    expect(html).toMatch(/1 needs attention/);
    // The chips are on the Sites row since #672 step 3.
    expect(renderSitesHtml(m)).toContain('class="pill attention"');
    expect(renderSitesHtml(m)).not.toContain("chip accepted");
  });

  it("mutes only the accepted conditions among several simultaneous watches", () => {
    const m = model([
      siteRow({
        id: "m",
        name: "Multi",
        status: "maintained",
        url: "https://x.netlify.app",
        bpScore: 78,
        acceptedWatchConditions: ["best practices"],
      }),
    ]);
    // #672 step 3: the verdict is on `/`; the chip on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    // BP muted, so no watch is left: netlify is a Setup gap (#672 step 2), still
    // open with its accept token surfaced.
    expect(home).toContain('class="verdict ok"');
    expect(html).toContain("✓ accepted: Best Practices 78");
    expect(html).toContain('accept: "no custom domain"');
  });
});

describe("mapRow — tolerant Accepted Watch Conditions parse", () => {
  it("parses a comma/newline string to the same array a Multiple-Select yields", () => {
    const asArray = mapRow({
      id: "r1",
      fields: { "Accepted Watch Conditions": ["no custom domain", "performance"] },
    });
    const asString = mapRow({
      id: "r2",
      fields: { "Accepted Watch Conditions": "no custom domain,\nperformance" },
    });
    expect(asArray.acceptedWatchConditions).toEqual(["no custom domain", "performance"]);
    expect(asString.acceptedWatchConditions).toEqual(asArray.acceptedWatchConditions);
  });

  it("trims and drops empties from a delimited string", () => {
    const row = mapRow({
      id: "r3",
      fields: { "Accepted Watch Conditions": " netlify , ,\n stale \n" },
    });
    expect(row.acceptedWatchConditions).toEqual(["netlify", "stale"]);
  });

  it("defaults to an empty array for a missing or other-typed field", () => {
    expect(mapRow({ id: "r4", fields: {} }).acceptedWatchConditions).toEqual([]);
    expect(
      mapRow({ id: "r5", fields: { "Accepted Watch Conditions": 42 } }).acceptedWatchConditions,
    ).toEqual([]);
  });

  it("drops non-string ARRAY elements instead of crashing the cockpit build downstream", () => {
    // A collaborator/attachment-shaped field passes Array.isArray with object
    // elements; assignTier calls .trim() on every entry, so one misconfigured row
    // must not take down the whole fleet cockpit. Strings survive, junk is dropped,
    // and the array branch now trims + drops empties like the string branch.
    const row = mapRow({
      id: "r6",
      fields: {
        "Accepted Watch Conditions": [
          { id: "usr123", name: "Someone" },
          " netlify ",
          42,
          "",
          "stale",
        ],
      },
    });
    expect(row.acceptedWatchConditions).toEqual(["netlify", "stale"]);
  });
});

describe("needs-you feed", () => {
  it("renders one Open-only row per pending approval and no Approve button", () => {
    const sites = [siteRow({ id: "recSITE", name: "Acme" })];
    // A pending-approval report for sites[0] — same fixture shape the verdict-bar
    // test uses to populate model.pending (draftReady + !approvedToSend + !sentAt).
    const reports = [
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
        withdrawnAt: null,
        autoEvidence: healthCleanEvidence(),
        deliveryStatus: "pending",
      } as never,
    ];
    const html = renderCockpitHtml(model(sites, reports));
    expect(html).toContain('href="/s/acme"');
    expect(html).toContain("Open ▸");
    expect(html).toContain("Waiting on your yes");
    expect(html).not.toContain("data-approve-url"); // approve action no longer on the home page
    expect(html).not.toContain(">Approve<");
  });

  it("omits the feed entirely when nothing needs the operator", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).not.toContain("Needs you (");
  });
});

describe("inbox lane", () => {
  it("renders submissions + spam inside one collapsed details", () => {
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [],
      {},
      BASE,
      NOW,
      [
        {
          id: "s1",
          siteId: "recSITE",
          formType: "contact",
          name: "Jane",
          email: "jane@x.com",
          submittedAt: "2026-06-10T12:00:00Z",
        } as never,
      ],
      { honeypot: 3, tooFast: 2, markedSpam: 1 }, // caught 5 · through 1
    );
    const html = renderCockpitHtml(m);
    expect(html).toContain('<details class="inbox">');
    expect(html).toContain("📥 Submissions (1 new)");
    expect(html).toContain('href="/submissions"');
    // "after the fleet panel": the panel moved to Sites (#672 step 3).
  });

  it("omits the inbox entirely with no submissions and no spam", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).not.toContain('class="inbox"');
  });
});

describe("renderCockpitHtml — region order", () => {
  it("composes the regions in order: verdict → needs-you → inbox (the fleet panel moved to Sites, #672 step 3)", () => {
    // A model that populates ALL four regions at once: a pending-approval report
    // (→ needs-you feed, verdict warns) plus a new submission and spam (→ inbox).
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
          withdrawnAt: null,
          deliveryStatus: "pending",
        } as never,
      ],
      {},
      BASE,
      NOW,
      [
        {
          id: "s1",
          siteId: "recSITE",
          formType: "contact",
          name: "Jane",
          email: "jane@x.com",
          submittedAt: "2026-06-10T12:00:00Z",
        } as never,
      ],
      { honeypot: 3, tooFast: 2, markedSpam: 1 },
    );
    const html = renderCockpitHtml(m);
    const iVerdict = html.indexOf('class="verdict');
    const iFeed = html.indexOf('class="needs-you');
    const iInbox = html.indexOf('class="inbox');
    expect(iVerdict).toBeGreaterThan(-1);
    expect(iFeed).toBeGreaterThan(iVerdict);
    expect(iInbox).toBeGreaterThan(iFeed);
  });
});

describe("renderCockpitHtml — inbox lane submissions cap", () => {
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

  it("caps the lane at 10 rows, keeps the true total in the summary, and links onward", () => {
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
    expect(html).toContain("📥 Submissions (13 new)"); // true total, not the capped count
    expect(html).toContain("+3 more — view all submissions");
    expect(html).toContain('href="/submissions"');
  });

  it("renders every row and a plain 'View all' link when at or under the cap", () => {
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
    expect(html).toContain("📥 Submissions (4 new)");
    expect(html).not.toMatch(/\+\d+ more/);
    expect(html).toContain("View all submissions →");
  });
});

describe("renderCockpitHtml — cockpit cards", () => {
  it("puts a status pill and the site's attention chips on the card, with data-signals", () => {
    const html = renderSitesHtml(
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
        escalated("a"),
      ),
    );
    expect(html).toMatch(/class="pill attention"/);
    expect(html).toContain('data-signals="'); // present on the card
    expect(html).toMatch(/2 critical\/high|3 critical\/high/); // vuln chip text from the collector title
    expect(html).toMatch(/Lighthouse Performance 60/); // lighthouse chip
  });

  it("renders a pre-live 'launch period' site with a muted pre-launch pill, never broken", () => {
    const m = model([
      siteRow({
        id: "p",
        name: "Launching",
        status: "launching",
        pScore: 60, // sub-floor Lighthouse — expected pre-launch noise, stays muted
        deployStatus: "error", // errored deploy — also expected pre-launch
      }),
    ]);
    // #672 step 3: the verdict is on `/`; the pill and tags on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(html).toMatch(/class="pill pre-launch"/);
    expect(html).not.toMatch(/class="pill broken"/);
    // The fleet's only non-green site is pre-launch → calm verdict, not broken.
    expect(home).toContain('class="verdict ok"');
    expect(home).toContain("✓ All clear");
    expect(home).toContain("1 pre-launch");
    expect(home).not.toMatch(/site[s]? broken/);
  });

  it("a launch-period site with an EXHAUSTED vuln pierces the mute (red pill, not pre-launch)", () => {
    // A pre-exhaustion vuln stays muted while Renovate self-patches it — only the
    // exhausted vuln is the genuine alarm that pierces the pre-launch mute.
    const html = renderSitesHtml(
      model([
        siteRow({
          id: "p",
          name: "Launching",
          status: "launching",
          securityVulnsCritical: 2,
          securityAutoFixAttempts: 3, // auto-fix exhausted → genuine alarm
        }),
      ]),
    );
    expect(html).toMatch(/class="pill attention"/);
    expect(html).not.toMatch(/class="pill pre-launch"/);
    expect(html).not.toContain("✓ All clear");
  });

  it("renders a NEW badge for a freshly-flagged item and WORSE for a risen metric", () => {
    const newHtml = renderSitesHtml(
      model([siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1, pScore: 60 })]), // prior {} → NEW
    );
    expect(newHtml).toMatch(/class="badge">NEW/);

    const worse = buildCockpitModel(
      [siteRow({ id: "a", name: "Bad", securityVulnsCritical: 3 })],
      [],
      escalated("a", 1),
      BASE,
      NOW,
    );
    expect(renderSitesHtml(worse)).toMatch(/class="badge">WORSE/);
  });

  it("shows the watch reasons on a watch-tier card", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toMatch(/Performance 80/);
  });

  // "includes the filter script with the data-filter wiring": its behaviour is the DOM tests' now (cockpit/tests/fleet/sites.dom.test.ts: the signal filters).
});

describe("renderCockpitHtml — filter signals & all-clear", () => {
  it("a watch-band Lighthouse site carries the 'lighthouse' filter signal", () => {
    // pScore 80 ∈ [75,85) with the other categories healthy → watch via Lighthouse.
    const html = renderSitesHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toMatch(/data-signals="[^"]*lighthouse[^"]*"/);
  });

  it("a commit-stale site carries the 'stale' filter signal (not the lighthouse one)", () => {
    // Healthy scores but the last commit is >30d before NOW → watch via staleness only.
    const html = renderSitesHtml(
      model([siteRow({ id: "s", name: "Stale", lastCommitAt: "2026-01-01T00:00:00Z" })]),
    );
    expect(html).toMatch(/data-signals="[^"]*stale[^"]*"/);
    expect(html).not.toMatch(/data-signals="[^"]*lighthouse[^"]*"/);
  });

  it("tags a maintained site with no GA4 property with the no-analytics signal, and offers the filter", () => {
    const html = renderSitesHtml(
      model([siteRow({ id: "n", name: "NoGa", status: "maintained", ga4PropertyId: null })]),
    );
    expect(html).toMatch(/data-signals="[^"]*no-analytics[^"]*"/);
    expect(html).toContain('data-filter="no-analytics"');
    expect(html).toContain("GA4 property not recorded");
  });

  it("#943: tags a maintained site whose lookup matched no Search Console property, names the host, and offers the filter", () => {
    const html = renderSitesHtml(
      model([
        siteRow({
          id: "g",
          name: "NoGsc",
          status: "maintained",
          url: "https://nogsc.example.com",
          searchConsoleOutcome: "no-property",
          searchConsoleCheckedAt: "2026-06-01T09:00:00Z",
        }),
      ]),
    );
    expect(html).toMatch(/data-signals="[^"]*search-console-no-property[^"]*"/);
    expect(html).toContain('data-filter="search-console-no-property"');
    expect(html).not.toContain("search-console-unrecorded");
    expect(html).toContain("Search Console: no property matched nogsc.example.com");
  });

  it("tags a maintained site missing its Git repo / Netlify ID with their signals, and offers both filters (#889)", () => {
    const html = renderSitesHtml(
      model([
        siteRow({ id: "r", name: "NoIds", status: "maintained", gitRepo: null, netlifyId: null }),
      ]),
    );
    expect(html).toMatch(/data-signals="[^"]*no-git-repo[^"]*"/);
    expect(html).toMatch(/data-signals="[^"]*no-netlify-id[^"]*"/);
    expect(html).toContain('data-filter="no-git-repo"');
    expect(html).toContain('data-filter="no-netlify-id"');
    expect(html).toContain("Git repo not recorded");
    expect(html).toContain("Netlify ID not recorded");
  });

  it("tags a maintained site whose roster url fails with url-unresolved, and offers the filter (#912)", () => {
    const html = renderSitesHtml(
      model([
        siteRow({
          id: "u",
          name: "Unresolved",
          status: "maintained",
          urlResolves: "fail",
          urlStatus: "404",
          urlCheckedAt: new Date().toISOString(),
        }),
      ]),
    );
    expect(html).toMatch(/data-signals="[^"]*url-unresolved[^"]*"/);
    expect(html).toContain('data-filter="url-unresolved"');
  });

  it("tags a maintenance site still on *.netlify.app with the no-domain signal", () => {
    const html = renderSitesHtml(
      model([
        siteRow({
          id: "nd",
          name: "NoDomain",
          status: "maintained",
          url: "https://x.netlify.app",
        }),
      ]),
    );
    expect(html).toMatch(/data-signals="[^"]*no-domain[^"]*"/);
  });

  it("a broken site keeps its watch tags, so it stays under those filter chips (#941)", () => {
    const m = model([
      siteRow({
        id: "r",
        name: "Broken",
        status: "maintained",
        defaultBranchCi: "failing",
        searchConsoleOutcome: "no-property",
        searchConsoleCheckedAt: "2026-06-01T09:00:00Z",
      }),
    ]);
    // #672 step 3: the verdict is on `/`; the pill and tags on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(html).toMatch(/class="pill attention"/);
    expect(html).toMatch(/data-signals="[^"]*\bci\b[^"]*"/);
    expect(html).toMatch(/data-signals="[^"]*\bsearch-console-no-property\b[^"]*"/);
    // Tagged, not re-tiered: the verdict still counts it once, as attention (CI red, P1-78b).
    expect(home).toMatch(/1 needs attention/);
    expect(home).not.toMatch(/\d+ watching/);
  });

  it("renders the amber watch verdict when a watch-band site is the worst", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toContain('class="verdict watch"');
    expect(html).toContain("1 to watch");
    expect(html).not.toContain("✓ All clear");
  });

  it("renders the red broken verdict for a sub-floor Lighthouse site", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "b", name: "Down", pScore: 40 })]));
    expect(html).toContain('class="verdict attention"');
    expect(html).toMatch(/1 needs attention/);
    expect(html).not.toContain("✓ All clear");
  });

  it("keeps a vuln Renovate is still inside its wait for off the verdict (2026-10-05)", () => {
    // The operator's rule: a "just wait" item is not a watch item until waiting fails.
    const html = renderCockpitHtml(
      model(
        [siteRow({ id: "v", name: "Patch", securityVulnsHigh: 1, securityAutoFixAttempts: 1 })],
        [],
        { "vuln:v": { metric: 1, firstFlaggedAt: "2026-06-10" } },
      ),
    );
    expect(html).toContain("✓ All clear");
    expect(html).not.toContain('class="verdict watch"');
  });

  it("surfaces a vuln whose wait failed, short of exhaustion, as the amber watch verdict", () => {
    // Past its threshold but not exhausted: amber, not green, and not the red broken band.
    const html = renderCockpitHtml(
      model(
        [siteRow({ id: "v", name: "Patch", securityVulnsHigh: 1, securityAutoFixAttempts: 1 })],
        [],
        escalated("v", 1),
      ),
    );
    expect(html).toContain('class="verdict attention"');
    expect(html).toContain("1 needs attention");
    expect(html).not.toContain("✓ All clear");
    expect(html).not.toContain('class="verdict warn"');
  });

  it("escalates an exhausted vuln to the red broken verdict", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "v", name: "Stuck", securityVulnsHigh: 1, securityAutoFixAttempts: 3 }),
      ]),
    );
    expect(html).toContain('class="verdict attention"');
    expect(html).toMatch(/1 needs attention/);
  });

  // "the fleet-browse filter script has no pending/submissions branch (they moved off the cards)": its behaviour is the DOM tests' now (cockpit/tests/fleet/sites.dom.test.ts: the signal filters).
});

describe("renderCockpitHtml — GitHub-signal chips & filters (slice 2b)", () => {
  it("a Renovate-failing card carries the prs signal + its chip", () => {
    const html = renderSitesHtml(
      model([siteRow({ id: "a", name: "Reno", renovateFailingCis: 2 })]),
    );
    expect(html).toMatch(/data-signals="[^"]*prs[^"]*"/);
    expect(html).toMatch(/2 Renovate PRs failing CI/);
  });

  it("a CI-red card carries the ci signal + its chip", () => {
    const html = renderSitesHtml(
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
    const html = renderSitesHtml(
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
  it("leaves Trigger Renovate to the site page: Sites carries none (#672 step 3)", () => {
    // The button lives on /s/:slug (the brief: "already lives on /s/:slug"), where
    // the site page's tests cover it; the merged cards dropped their copy.
    const html = renderSitesHtml(
      model([
        siteRow({ name: "Has Repo", gitRepo: "reddoorla/hasrepo" }),
        siteRow({ name: "No Repo", gitRepo: null }),
      ]),
    );
    expect(html).toContain(">Has Repo<"); // the repo-backed site is on the page
    expect(html).not.toContain("trigger-renovate");
  });
});

describe("fleet browse panel", () => {
  it("renders one table of sites with the signal filters, and no tier groups (#672 step 3)", () => {
    const html = renderSitesHtml(model([siteRow({ name: "Acme" }), siteRow({ name: "Beta" })]));
    expect(html.match(/<table class="fleet">/g) ?? []).toHaveLength(1);
    expect(html.match(/<tr class="fleet-row"/g) ?? []).toHaveLength(2);
    expect(html).toContain('class="signal-filters" role="group"');
    expect(html).not.toContain('details class="tier"');
  });

  it("offers signal filters but not pending/submissions", () => {
    const html = renderSitesHtml(model([siteRow({ name: "Acme" })]));
    expect(html).toContain('data-filter="vulns"');
    expect(html).not.toContain('data-filter="pending"');
    expect(html).not.toContain('data-filter="submissions"');
  });
});

describe("renderCockpitHtml — Audit fleet button + live status", () => {
  it("renders a fleet audit button wired to POST /api/fleet/refresh", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('class="refresh-fleet"');
    expect(html).toContain('data-refresh-url="/api/fleet/refresh"');
    expect(html).toContain("↻ Audit fleet");
  });

  // "wires localStorage resume so a mid-run reload keeps following": its behaviour is the DOM tests' now (cockpit.dom: resumes a run saved by an earlier page load).
  // "the spinner client carries the eta/run-link detail wiring": its behaviour is the DOM tests' now (cockpit.dom: renders each run, eta and view-run link).
  // "escapes interpolated values and refuses a run link that is not a GitHub URL": its behaviour is the DOM tests' now (cockpit.dom: escaping and github.com-only run links).
});

describe("deploy badge", () => {
  it("renders a green ready badge linking to the deploy log", () => {
    const html = renderSitesHtml(
      model([
        siteRow({
          deployStatus: "ready",
          lastDeployAt: "2026-06-10T12:00:00Z",
          deployLogUrl: "https://acme.netlify.app",
        }),
      ]),
    );
    expect(html).toContain("metric deploy ready");
    // safeUrl returns the parsed URL's href, which normalizes a bare origin
    // to carry a trailing slash — not the caller's raw string.
    expect(html).toContain('href="https://acme.netlify.app/"');
    expect(html).toContain("ready");
  });

  it("renders a red failed badge", () => {
    const html = renderSitesHtml(model([siteRow({ deployStatus: "error" })]));
    expect(html).toContain("metric deploy failed");
  });

  it("renders a grey unknown badge when there is no deploy status", () => {
    const html = renderSitesHtml(model([siteRow({ deployStatus: null })]));
    expect(html).toContain("metric deploy unknown");
  });

  it("does not emit a link for a non-http deploy URL (dead-link guard)", () => {
    // The deploy badge is on the Sites row since #672 step 3.
    const html = renderSitesHtml(
      model([siteRow({ deployStatus: "ready", deployLogUrl: "javascript:alert(1)" })]),
    );
    expect(html).toContain('class="metric deploy ready"'); // the badge is there, unlinked
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).not.toContain('href="#"');
  });
});

describe("renderCockpitHtml — archived lane + status honesty", () => {
  it("renders an archived count term and a collapsed Archived lane for a legacy row", () => {
    const m = model([
      siteRow({ id: "a", name: "Acme" }),
      // Synthetic since stage 3 (no cell can diverge from its canonical value
      // any more): the lane MIRRORS the raw Status cell, so a row whose raw
      // cell says "legacy" must render "legacy", never the canonical value.
      siteRow({ id: "l", name: "Old & Legacy", status: "archived", statusRaw: "legacy" }),
    ]);
    // #672 step 3: the verdict is on `/`; the pill and tags on the site's Sites row.
    const home = renderCockpitHtml(m);
    const html = renderSitesHtml(m);
    expect(home).toContain("1 archived");
    expect(html).toContain("🗄 Archived (1)");
    expect(html).toContain("Old &amp; Legacy"); // escaped site name
    expect(html).toContain('<span class="muted">legacy</span>');
    expect(html).not.toContain('<span class="muted">archived</span>');
    expect(html).toContain('href="/s/old-legacy"');
    // The archived row is a roster entry, never a fleet card: one row with health.
    expect(html.match(/<td class="health">\s*<span class="pill /g) ?? []).toHaveLength(1);
  });

  it("labels each archived row from its OWN raw cell, not from the shared canonical one", () => {
    // A RENDERER contract test, and deliberately synthetic: since stage 3 no
    // cell can produce `status !== statusRaw`, so these rows are built
    // by hand rather than through mapRow. What it still catches is a renderer
    // that starts labelling from `status` — the change that once relabelled all
    // 12 live archived rows and was caught only on the combined tree.
    const html = renderSitesHtml(
      model([
        siteRow({ id: "a", name: "Acme" }),
        siteRow({ id: "l", name: "Old Legacy", status: "archived", statusRaw: "legacy" }),
        siteRow({ id: "d", name: "Dead Site", status: "archived", statusRaw: "deprecated" }),
      ]),
    );
    expect(html).toContain("🗄 Archived (2)");
    expect(html).toContain('<span class="muted">legacy</span>');
    expect(html).toContain('<span class="muted">deprecated</span>');
  });

  it("labels the archived lane from a RAW cell driven through mapRow", () => {
    // End-to-end through the real read seam: the lane is driven by real mapRow
    // output, and the label still comes from the raw cell.
    const record = (id: string, name: string, status: string) =>
      mapRow({ id, fields: { Name: name, Status: status } });
    const html = renderSitesHtml(
      model([
        record("recL", "Old Site", "archived"),
        record("recD", "Dead Site", "archived"),
        record("recM", "Acme", "maintained"),
      ]),
    );
    expect(html).toContain("🗄 Archived (2)");
    expect(html).toContain('<span class="muted">archived</span>');
    expect(html.match(/<td class="health">\s*<span class="pill /g) ?? []).toHaveLength(1);
  });

  it("a RETIRED cell is no longer archived — it surfaces instead of being absorbed", () => {
    // The behaviour change stage 3 introduced, pinned at the surface an operator
    // actually looks at. Before, a "legacy" cell was quietly folded into the
    // Archived lane. Now nothing translates it, so it is an unrecognized status:
    // it must NOT be counted as archived, because being counted there is exactly
    // how a stale value would go unnoticed.
    const record = (id: string, name: string, status: string) =>
      mapRow({ id, fields: { Name: name, Status: status } });
    const m = model([record("recL", "Stale Site", "legacy"), record("recM", "Acme", "maintained")]);
    // The Archived lane is on Sites since #672 step 3; the count stays on `/`.
    expect(renderSitesHtml(m)).not.toContain("🗄 Archived");
    expect(renderCockpitHtml(m)).not.toContain("1 archived");
  });

  it("renders neither the archived term nor the lane when nothing is archived", () => {
    const m = model([siteRow({ id: "a", name: "Acme" })]);
    expect(renderCockpitHtml(m)).not.toContain("1 archived");
    // The Archived lane is on Sites since #672 step 3.
    expect(renderSitesHtml(m)).not.toContain("🗄 Archived");
    expect(renderSitesHtml(m)).not.toContain('class="archived"');
  });

  it("renders an amber verdict + feed reason for a typo'd Status cell", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "a", name: "Acme" }),
        siteRow({ id: "t", name: "Typo Site", status: "maintenence " as WebsiteRow["status"] }),
      ]),
    );
    expect(html).toContain('class="verdict watch"');
    expect(html).toContain("1 to watch");
    expect(html).toContain("is not a recognized value");
    expect(html).toContain('href="/s/typo-site"');
  });
});

describe("renderCockpitHtml — Recently lane", () => {
  it("renders a Recently row for a report_sent_with_override event", () => {
    const m = {
      ...model([]),
      recent: [
        {
          type: "report_sent_with_override" as const,
          summary: "sent with override — client asked",
          siteName: "Acme Co",
          slug: "acme-co",
          url: null,
          ts: "2026-07-06T09:30:00.000Z",
        },
      ],
    };
    const html = renderSitesHtml(m);
    expect(html).toContain("sent with override");
  });
});

// Tim and Erik reach the cockpit through Google sign-in and run audits from
// /audits; until now that page was reachable only by typing the URL.
// "links to the prospect audits page as a visible button": the shell's nav replaces it (cockpit/tests/shell/shell.ssr.test.ts).
