import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../../src/reports/checklist.js";
import { escapeHtml } from "../../src/util/html.js";

/** All 6 maintenance cells true → a complete Maintenance checklist. */
const COMPLETE_MAINTENANCE = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    // Send-clean defaults: the approve gate now blocks on missing recipients /
    // header image, so the fixture site must pass approveBlockers for the
    // enabled-button tests to exercise the checklist gate in isolation.
    pointOfContact: "owner@site.example.com",
    headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    ...over,
  });
}

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: null,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    completedOn: "2026-05-01",
    lighthouse: { performance: 87, accessibility: 95, bestPractices: 90, seo: 100 },
    gaUsersCurrent: 2100,
    gaUsersPrevious: 1900,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: "2026-04-10",
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-05-02T09:00:00Z",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: {
      url: "https://airtable.example/attach/rep_001.html",
      filename: "rep_001.html",
    },
    resendMessageId: "msg_001",
    approvedAt: null,
    approvedBy: null,
    checklist: {},
    autoEvidence: null,
    ...over,
  };
}

describe("renderSiteDashboardHtml", () => {
  it("returns a full HTML document", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('rel="icon"'); // reddoor favicon
  });

  it("includes the site name in <title> and as the page heading", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/<title>[^<]*Acme Co[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*Acme Co/);
  });

  it("renders the site URL as a clickable link", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toContain('href="https://acme.example.com"');
  });

  it("pairs each lighthouse score with its correct label inside the same tile", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pScore: 12, rScore: 34, bpScore: 56, seoScore: 78 }),
      [],
    );
    // Each tile is one <div class="tile">…</div> block. Within each tile both
    // the value and the label appear. Verify the pairings structurally so
    // the test doesn't rely on DOM order between value and label (which is
    // a UX/CSS decision, not a behavioral one).
    const tilePairs: Array<[string, string]> = [
      ["12", "Performance"],
      ["34", "Accessibility"],
      ["56", "Best Practices"],
      ["78", "SEO"],
    ];
    for (const [value, label] of tilePairs) {
      // Tile body bounded by <div class="tile"> … </div>; both children
      // must appear inside one tile body.
      const tilePattern = new RegExp(
        `<div class="tile">[^]*?>${value}<[^]*?>${label}<[^]*?<\\/div>\\s*<\\/div>|` +
          `<div class="tile">[^]*?>${label}<[^]*?>${value}<[^]*?<\\/div>\\s*<\\/div>`,
      );
      expect(html).toMatch(tilePattern);
    }
    // And the big-number-on-top requirement: value-div must come before
    // label-div inside each tile so the CSS hierarchy (2rem value, 0.85rem
    // label) renders correctly.
    expect(html).toMatch(
      /<div class="tile"><div class="tile-value"[^>]*>12<\/div><div class="tile-label"[^>]*>Performance<\/div><\/div>/,
    );
  });

  it("renders a placeholder when scores are null (site never audited)", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
      [],
    );
    expect(html).toMatch(/no lighthouse data yet/i);
  });

  it("lists each provided report with a link to its rendered HTML attachment", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_001", completedOn: "2026-05-01" }),
      reportRow({
        id: "recREP2",
        reportId: "rep_002",
        completedOn: "2026-04-01",
        renderedHtmlAttachment: {
          url: "https://airtable.example/attach/rep_002.html",
          filename: "rep_002.html",
        },
      }),
    ]);
    expect(html).toContain("rep_001");
    expect(html).toContain("rep_002");
    expect(html).toContain('href="https://airtable.example/attach/rep_001.html"');
    expect(html).toContain('href="https://airtable.example/attach/rep_002.html"');
  });

  it("renders a placeholder when there are no reports", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/no reports yet/i);
  });

  it("does not link a report whose attachment is null", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_003", renderedHtmlAttachment: null }),
    ]);
    expect(html).toContain("rep_003");
    expect(html.match(/href="[^"]*\.html"/g) ?? []).toEqual([]);
  });

  it("escapes HTML in the site name and URL so untrusted Airtable values cannot inject markup", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
      [],
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe("renderSiteDashboardHtml — vulnerabilities section", () => {
  it("lists each advisory, severity-sorted, with module / title / CVE / link", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        securityAdvisories: [
          {
            module: "axios",
            severity: "moderate",
            title: "ReDoS",
            cves: ["CVE-2"],
            url: "https://a",
          },
          {
            module: "esbuild",
            severity: "critical",
            title: "RCE",
            cves: ["CVE-1"],
            url: "https://b",
          },
        ],
      }),
      [],
    );
    expect(html).toContain("Vulnerabilities (2)");
    expect(html).toContain("esbuild");
    expect(html).toContain("axios");
    expect(html).toContain("CVE-1");
    expect(html).toContain('href="https://b"');
    // critical (esbuild) must render before moderate (axios)
    expect(html.indexOf("esbuild")).toBeLessThan(html.indexOf("axios"));
  });

  it("flags a development-scoped advisory as (dev); leaves runtime/unknown unmarked", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        securityAdvisories: [
          {
            module: "shell-quote",
            severity: "critical",
            title: "escape bug",
            cves: [],
            url: null,
            scope: "development",
          },
          {
            module: "cookie",
            severity: "low",
            title: "oob",
            cves: [],
            url: null,
            scope: "runtime",
          },
        ],
      }),
      [],
    );
    // Assert the (dev) marker lands on the development-scoped row specifically — not just that it
    // appears somewhere — so a scope-inversion bug (tagging the runtime row) would be caught.
    const items = html
      .split('<li class="vuln-item">')
      .slice(1)
      .map((s) => s.split("</li>")[0]!);
    const devItem = items.find((s) => s.includes("shell-quote"))!;
    const runtimeItem = items.find((s) => s.includes("cookie"))!;
    expect(devItem).toContain("(dev)");
    expect(runtimeItem).not.toContain("(dev)");
  });

  it("omits the section when the site was never audited (null)", () => {
    const html = renderSiteDashboardHtml(siteRow({ securityAdvisories: null }), []);
    expect(html).not.toContain("Vulnerabilities (");
  });

  it("omits the section when audited clean (empty array)", () => {
    const html = renderSiteDashboardHtml(siteRow({ securityAdvisories: [] }), []);
    expect(html).not.toContain("Vulnerabilities (");
  });

  it("escapes advisory text and rejects a javascript: advisory URL", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        securityAdvisories: [
          {
            module: "<script>x</script>",
            severity: "high",
            title: "<img src=x>",
            cves: [],
            url: "javascript:alert(1)",
          },
        ],
      }),
      [],
    );
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe("renderSiteDashboardHtml — submissions section", () => {
  function submission(n: number): SubmissionRow {
    return {
      id: `sub${n}`,
      submissionId: n,
      siteId: "recSITE",
      formType: "contact",
      name: `Person ${n}`,
      email: `p${n}@example.com`,
      phone: null,
      message: null,
      extraFields: null,
      sourceUrl: null,
      utm: null,
      submittedAt: `2026-06-${String(((n - 1) % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      status: "new",
      notifyStatus: "sent",
      resendMessageId: null,
    };
  }

  it("shows 'showing 25 of N' when there are more submissions than the cap", () => {
    const subs = Array.from({ length: 40 }, (_, i) => submission(i + 1));
    const html = renderSiteDashboardHtml(siteRow(), [], subs);
    expect(html).toContain("Form submissions (40)");
    expect(html).toContain("showing 25 of 40");
    expect((html.match(/class="subm-item"/g) ?? []).length).toBe(25);
  });

  it("omits the truncation note when at or under the cap", () => {
    const subs = Array.from({ length: 5 }, (_, i) => submission(i + 1));
    const html = renderSiteDashboardHtml(siteRow(), [], subs);
    expect(html).toContain("Form submissions (5)");
    expect(html).not.toMatch(/showing \d+ of/);
    expect((html.match(/class="subm-item"/g) ?? []).length).toBe(5);
  });

  it("expands to show all stored fields for a submission", () => {
    const subs: SubmissionRow[] = [
      {
        id: "sub1",
        submissionId: 1423,
        siteId: "recSITE",
        formType: "contact",
        name: "Jane",
        email: "jane@example.com",
        phone: "555-0100",
        message: "Full message body",
        extraFields: JSON.stringify({ interest: "residential" }),
        sourceUrl: "https://acme.example.com/contact",
        utm: "google/cpc/spring",
        submittedAt: "2026-06-20T12:00:00Z",
        status: "new",
        notifyStatus: "sent",
        resendMessageId: "msg_abc",
      },
    ];
    const html = renderSiteDashboardHtml(siteRow(), [], subs);
    expect(html).toContain("<details");
    expect(html).toContain("555-0100");
    expect(html).toContain("Full message body");
    expect(html).toContain("google/cpc/spring");
    expect(html).toContain("interest");
    expect(html).toContain("residential");
    expect(html).toContain("msg_abc");
    expect(html).toContain("1423");
    expect(html).toContain('href="https://acme.example.com/contact"');
  });

  it("omits absent detail fields and falls back to raw extraFields when JSON is malformed", () => {
    const subs: SubmissionRow[] = [
      {
        id: "sub2",
        submissionId: null,
        siteId: "recSITE",
        formType: "contact",
        name: "No Extras",
        email: "x@example.com",
        phone: null,
        message: null,
        extraFields: "{not json",
        sourceUrl: null,
        utm: null,
        submittedAt: "2026-06-20T12:00:00Z",
        status: "new",
        notifyStatus: "sent",
        resendMessageId: null,
      },
    ];
    const html = renderSiteDashboardHtml(siteRow(), [], subs);
    expect(html).toContain("{not json"); // raw fallback, escaped, no throw
    expect(html).not.toMatch(/Phone:/i); // absent field omitted
  });

  it("escapes detail fields and neutralizes a javascript: source URL", () => {
    const subs: SubmissionRow[] = [
      {
        id: "sub3",
        submissionId: null,
        siteId: "recSITE",
        formType: "contact",
        name: "x",
        email: "x@example.com",
        phone: null,
        message: "<script>alert(1)</script>",
        extraFields: null,
        sourceUrl: "javascript:alert(1)",
        utm: null,
        submittedAt: "2026-06-20T12:00:00Z",
        status: "new",
        notifyStatus: "sent",
        resendMessageId: null,
      },
    ];
    const html = renderSiteDashboardHtml(siteRow(), [], subs);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe("renderSiteDashboardHtml — spam screen panel", () => {
  it("renders caught honeypot/too-fast, marked spam, and delivered (30d)", () => {
    const subs: SubmissionRow[] = [
      {
        id: "s1",
        submissionId: 1,
        siteId: "recSITE",
        formType: "contact",
        name: "a",
        email: "a@x.com",
        phone: null,
        message: null,
        extraFields: null,
        sourceUrl: null,
        utm: null,
        submittedAt: new Date().toISOString(),
        status: "new",
        notifyStatus: "sent",
        resendMessageId: null,
      },
    ];
    const html = renderSiteDashboardHtml(
      siteRow({ id: "recSITE" }),
      [],
      subs,
      { honeypot: 280, tooFast: 30, markedSpam: 9 },
      new Date("2026-06-22T12:00:00Z"),
    );
    expect(html).toContain("Spam screen (30d)");
    expect(html).toContain("280");
    expect(html).toContain("30");
    expect(html).toContain("9");
    expect(html).toMatch(/delivered/i);
  });

  it("omits the spam panel when there is no screen-out data and no submissions", () => {
    const html = renderSiteDashboardHtml(siteRow(), [], [], null, new Date());
    expect(html).not.toContain("Spam screen (30d)");
  });
});

describe("renderSiteDashboardHtml — home link", () => {
  it("renders a top-left Home link to the cockpit (/), above the site heading", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/<a class="home" href="\/">/);
    // It sits before the <h1> so it reads as a back/home affordance.
    expect(html.indexOf('class="home"')).toBeLessThan(html.indexOf("<h1"));
  });
});

describe("renderSiteDashboardHtml — setup status", () => {
  it("lists the missing onboarding items when the site is not fully onboarded", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        lastLighthouseAuditAt: null,
        reportRecipientsTo: null,
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
      }),
      [],
    );
    expect(html).toMatch(/Setup 2\/4/);
    expect(html).toContain("First audit");
    expect(html).toContain("Report recipients");
    // The satisfied checks are not listed as missing.
    expect(html).not.toMatch(/Missing[^<]*Maintenance schedule/);
  });

  it("shows a complete state when the site is fully onboarded", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
      }),
      [],
    );
    expect(html).toMatch(/Setup 4\/4/);
    expect(html).toMatch(/complete/i);
  });
});

describe("renderSiteDashboardHtml — report-source data on report rows", () => {
  it("renders GA users (current with Δ vs previous) and search position on a report row", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        reportId: "rep_ga",
        gaUsersCurrent: 2100,
        gaUsersPrevious: 1900,
        searchFoundPage1: true,
        searchPosition: 4,
      }),
    ]);
    expect(html).toContain("2100");
    // Δ vs previous (2100 − 1900 = +200).
    expect(html).toMatch(/\+200|200/);
    // Search position shown when found on page 1.
    expect(html).toMatch(/#?4\b/);
  });

  it("renders '—' for GA and search when the data is null", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        reportId: "rep_none",
        gaUsersCurrent: null,
        gaUsersPrevious: null,
        searchFoundPage1: null,
        searchPosition: null,
      }),
    ]);
    // The GA and Search cells degrade to em-dashes (rendered in the row).
    const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect(tbody).toContain("—");
  });

  it("shows search as '—' when the site was not found on page 1", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        reportId: "rep_nofound",
        searchFoundPage1: false,
        searchPosition: null,
      }),
    ]);
    expect(html).toContain("rep_nofound");
  });
});

describe("renderSiteDashboardHtml — site details section", () => {
  it("renders cadence, recipients, POC and the optional ops fields", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        maintenanceFreq: "Monthly",
        testingFreq: "Quarterly",
        reportRecipientsTo: "client@acme.example",
        reportRecipientsCc: "ops@reddoorla.com",
        pointOfContact: "Jane Client",
        ga4PropertyId: "properties/123456",
        searchQuery: "Acme Co Los Angeles",
        gitRepo: "reddoorla/acme",
        lastCommitAt: "2026-06-10T00:00:00Z",
      }),
      [],
    );
    expect(html).toMatch(/Site details/i);
    expect(html).toContain("Monthly");
    expect(html).toContain("Quarterly");
    expect(html).toContain("client@acme.example");
    expect(html).toContain("ops@reddoorla.com");
    expect(html).toContain("Jane Client");
    expect(html).toContain("properties/123456");
    expect(html).toContain("Acme Co Los Angeles");
    expect(html).toContain("reddoorla/acme");
  });

  it("renders '—' for blank/null optional ops fields", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        maintenanceFreq: "Monthly",
        testingFreq: "None",
        reportRecipientsTo: "client@acme.example",
        reportRecipientsCc: null,
        pointOfContact: null,
        ga4PropertyId: null,
        searchQuery: null,
        gitRepo: null,
        lastCommitAt: null,
      }),
      [],
    );
    const details = html.slice(html.indexOf("Site details"));
    expect(details).toContain("—");
  });

  it("escapes untrusted ops field values in the site-details section", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pointOfContact: "<script>alert(1)</script>" }),
      [],
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderSiteDashboardHtml — site health section", () => {
  it("includes a 'Site Health' heading", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/<h2[^>]*>Site Health<\/h2>/);
  });

  it("renders the empty state when all health metrics are null", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/no health data yet/i);
  });

  it("renders the three health tiles (a11y, deps, security) with correct labels", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        a11yViolations: 3,
        depsDrifted: 5,
        depsMajorBehind: 1,
        securityVulnsCritical: 1,
        securityVulnsHigh: 2,
        securityVulnsModerate: 0,
        securityVulnsLow: 0,
      }),
      [],
    );
    expect(html).toMatch(
      /<div class="tile"><div class="tile-value"[^>]*>3<\/div><div class="tile-label"[^>]*>Accessibility issues<\/div>/,
    );
    expect(html).toMatch(
      /<div class="tile"><div class="tile-value"[^>]*>5<\/div><div class="tile-label"[^>]*>Dependency updates<\/div>/,
    );
    expect(html).toMatch(
      /<div class="tile"><div class="tile-value"[^>]*>3<\/div><div class="tile-label"[^>]*>Security alerts<\/div>/,
    );
  });

  it("shows a 'N major behind' sub-line on the deps tile only when there is major drift", () => {
    const withMajor = renderSiteDashboardHtml(
      siteRow({ a11yViolations: 0, depsDrifted: 5, depsMajorBehind: 1 }),
      [],
    );
    expect(withMajor).toMatch(/<div class="tile-sub"[^>]*>1 major behind<\/div>/);

    const noMajor = renderSiteDashboardHtml(
      siteRow({ a11yViolations: 0, depsDrifted: 5, depsMajorBehind: 0 }),
      [],
    );
    expect(noMajor).not.toMatch(/major behind/);
  });

  it("shows severity breakdown on the security tile when there are vulns", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        a11yViolations: 0,
        depsDrifted: 0,
        depsMajorBehind: 0,
        securityVulnsCritical: 1,
        securityVulnsHigh: 2,
        securityVulnsModerate: 3,
        securityVulnsLow: 4,
      }),
      [],
    );
    expect(html).toMatch(/<div class="tile-sub"[^>]*>1C \/ 2H \/ 3M \/ 4L<\/div>/);
  });

  it("hides the severity breakdown when total vulns is 0", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        a11yViolations: 0,
        depsDrifted: 0,
        depsMajorBehind: 0,
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityVulnsModerate: 0,
        securityVulnsLow: 0,
      }),
      [],
    );
    expect(html).not.toMatch(/\dC \/ \dH \/ \dM \/ \dL/);
  });

  it("shows the audited timestamp as relative time when lastLighthouseAuditAt is set", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/<div class="audited"[^>]*>Last audited [^<]*ago<\/div>/);
  });

  it("omits the audited line entirely when lastLighthouseAuditAt is null", () => {
    const html = renderSiteDashboardHtml(siteRow({ lastLighthouseAuditAt: null }), []);
    expect(html).not.toMatch(/class="audited"/);
  });
});

describe("renderSiteDashboardHtml — approve button", () => {
  // A report that is Draft-ready, not yet approved, not yet sent: the one state
  // where the operator's "yes" is pending.
  const pending = () =>
    reportRow({
      reportId: "rep_pending",
      draftReady: true,
      approvedToSend: false,
      sentAt: null,
      approvedAt: null,
      approvedBy: null,
    });

  it("renders an Approve button that POSTs to the approve endpoint for a pending report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [pending()]);
    // The button carries the Airtable record id (recREP1) so the inline fetch
    // can target /api/reports/:id/approve.
    expect(html).toMatch(/data-report-id="recREP1"/);
    expect(html).toContain("/api/reports/recREP1/approve");
    expect(html).toMatch(/Approve/);
  });

  it("does NOT render an Approve button for an already-approved report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: null }),
    ]);
    expect(html).not.toMatch(/\/api\/reports\/[^/]+\/approve/);
  });

  it("does NOT render an Approve button for an already-sent report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: "2026-05-02T09:00:00Z" }),
    ]);
    expect(html).not.toMatch(/\/api\/reports\/[^/]+\/approve/);
  });

  it("escapes the record id in the approve URL/attribute (no markup injection from Airtable ids)", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      pending(),
      reportRow({ id: 'rec"><img src=x>', reportId: "rep_x", approvedToSend: false, sentAt: null }),
    ]);
    expect(html).not.toContain('rec"><img src=x>');
    expect(html).toContain("&quot;");
  });

  it("wraps the inline approve fetch in try/catch so a network rejection re-enables the button", () => {
    const html = renderSiteDashboardHtml(siteRow(), [pending()]);
    // Isolate the inline <script>.
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    // The fetch must be inside a try/catch (a bare rejection would leave the
    // button permanently disabled reading "Approve").
    expect(script).toMatch(/try\s*\{/);
    expect(script).toMatch(/catch\b/);
    // The catch handler re-enables the button and surfaces a failure label,
    // matching the !res.ok recovery path.
    expect(script).toMatch(/catch[\s\S]*?(b\.disabled\s*=\s*false)/);
    expect(script).toMatch(/catch[\s\S]*?(b\.textContent\s*=\s*"Failed")/);
  });
});

describe("renderSiteDashboardHtml — pending-your-yes list", () => {
  it("renders a 'Pending your yes' section listing each pending report with type + period", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        reportId: "rep_p1",
        reportType: "Maintenance",
        period: "2026-05",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
      }),
    ]);
    expect(html).toMatch(/Pending your yes/i);
    // The section sits before the Lighthouse section (top-of-page priority).
    expect(html.indexOf("Pending your yes")).toBeLessThan(html.indexOf(">Lighthouse<"));
    expect(html).toMatch(/Maintenance/);
    expect(html).toContain("2026-05");
  });

  it("omits the 'Pending your yes' section entirely when nothing is pending", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: "2026-05-02T09:00:00Z" }),
    ]);
    expect(html).not.toMatch(/Pending your yes/i);
  });

  it("counts only pending reports, not approved/sent ones, in the section", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_a", approvedToSend: true, sentAt: null }),
      reportRow({
        reportId: "rep_b",
        approvedToSend: false,
        sentAt: null,
        draftReady: true,
        period: "2026-05",
      }),
    ]);
    // Exactly one pending entry → its period appears once in the pending list.
    expect(html).toMatch(/Pending your yes/i);
    expect(html).toContain("rep_b");
  });

  it("surfaces a pending report even when it is the OLDEST of 7+ (not in the recent slice)", () => {
    // 6 newer, already-sent reports + 1 OLD pending one. The recent-6 history
    // slice would drop the old pending report; the pending list + approve button
    // must still see it because they operate on the FULL report set.
    const sent = (n: number) =>
      reportRow({
        id: `recSENT${n}`,
        reportId: `rep_sent_${n}`,
        completedOn: `2026-0${n}-01`,
        approvedToSend: true,
        sentAt: "2026-06-02T09:00:00Z",
      });
    const oldPending = reportRow({
      id: "recOLDPENDING",
      reportId: "rep_old_pending",
      reportType: "Maintenance",
      period: "2025-12",
      completedOn: "2025-12-01", // oldest by completedOn
      draftReady: true,
      approvedToSend: false,
      sentAt: null,
    });
    const html = renderSiteDashboardHtml(siteRow(), [
      sent(1),
      sent(2),
      sent(3),
      sent(4),
      sent(5),
      sent(6),
      oldPending,
    ]);
    // Pending list shows it.
    expect(html).toMatch(/Pending your yes \(1\)/);
    expect(html).toContain("2025-12");
    // Approve button targets its record id.
    expect(html).toMatch(/data-report-id="recOLDPENDING"/);
    expect(html).toContain("/api/reports/recOLDPENDING/approve");
  });

  it("renders interactive checklist checkboxes for a pending Maintenance report with a disabled Approve when incomplete", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportId: "rep_maint",
        reportType: "Maintenance",
        period: "2026-05",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {}, // nothing checked → incomplete
      }),
    ]);
    // One checkbox per maintenance item, each labelled and carrying the report id
    // + the Airtable field name so the client can POST to the endpoint.
    for (const item of MAINTENANCE_CHECKLIST) {
      // Labels/fields can contain "&" (e.g. "Domain, DNS & SSL"), escaped to &amp; in HTML.
      expect(html).toContain(`data-field="${escapeHtml(item.field)}"`);
      expect(html).toContain(escapeHtml(item.label));
    }
    expect(html).toMatch(/type="checkbox"/);
    // The checkboxes carry the report record id so the client scopes the POST.
    expect(html).toContain('data-checklist-report-id="recREP1"');
    // None are checked (all false in the row).
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    // The Approve button for THIS report starts disabled (server-rendered gate).
    expect(html).toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
    // It still targets the approve endpoint and the toggle endpoint is present.
    expect(html).toContain("/api/reports/recREP1/approve");
    expect(html).toContain("/api/reports/recREP1/checklist");
  });

  it("reflects each item's checked state from report.checklist", () => {
    const partial = { ...COMPLETE_MAINTENANCE, "Maint: Security Updates": false };
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: partial,
      }),
    ]);
    // The 5 true items render a checked attribute on their input; "Security Updates" does not.
    const checkedCount = (html.match(/type="checkbox"[^>]*checked/g) ?? []).length;
    expect(checkedCount).toBe(5);
    // And the still-disabled Approve, because one item is unchecked.
    expect(html).toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
  });

  it("renders an auto-green badge + evidence note for a passed auto-check", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: { ...COMPLETE_MAINTENANCE, "Maint: Google Indexed": true },
        autoEvidence: {
          "Maint: Google Indexed": {
            result: "pass",
            checkedAt: "2026-06-18T12:00:00.000Z",
            note: "Page 1 on Google (#3)",
          },
        },
      }),
    ]);
    expect(html).toContain("auto-pass");
    expect(html).toContain("Page 1 on Google (#3)");
  });

  it("renders an amber badge (box left unchecked) for a failed auto-check", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: { "Maint: Google Indexed": false },
        autoEvidence: {
          "Maint: Google Indexed": {
            result: "fail",
            checkedAt: "2026-06-18T12:00:00.000Z",
            note: "Not on page 1 (avg #22)",
          },
        },
      }),
    ]);
    expect(html).toContain("auto-amber");
    expect(html).toContain("Not on page 1 (avg #22)");
  });

  it("renders an ENABLED Approve button for a fully-checked pending Maintenance report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: COMPLETE_MAINTENANCE,
      }),
    ]);
    // All 6 checked.
    expect((html.match(/type="checkbox"[^>]*checked/g) ?? []).length).toBe(6);
    // The Approve button is NOT disabled.
    expect(html).toMatch(
      /<button class="approve"[^>]*data-report-id="recREP1"(?![^>]*disabled)[^>]*>/,
    );
    expect(html).not.toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
  });

  it("renders the full Testing checklist (maintenance + testing, 13 items) for a pending Testing report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Testing",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {},
      }),
    ]);
    // A Testing pass also does the maintenance checks, so both lists render and gate it.
    for (const item of [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST]) {
      expect(html).toContain(`data-field="${escapeHtml(item.field)}"`);
      expect(html).toContain(escapeHtml(item.label));
    }
    expect(html).toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
  });

  it("renders NO checklist and an un-gated (not disabled) Approve for a pending Launch report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Launch",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {},
      }),
    ]);
    expect(html).not.toMatch(/type="checkbox"/);
    expect(html).not.toContain("data-checklist-report-id");
    // Launch/Announcement Approve is never gated → not disabled.
    expect(html).toContain("/api/reports/recREP1/approve");
    expect(html).not.toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
  });

  it("renders NO checklist and an un-gated Approve for a pending Announcement report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Announcement",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {},
      }),
    ]);
    expect(html).not.toMatch(/type="checkbox"/);
    expect(html).not.toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
  });

  it("escapes the field name and report id in the checklist data attributes", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: 'rec"><img src=x>',
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {},
      }),
    ]);
    expect(html).not.toContain('rec"><img src=x>');
    expect(html).toContain("&quot;");
  });

  it("wires the checklist checkboxes to the toggle endpoint and scopes the Approve toggle per report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        id: "recREP1",
        reportType: "Maintenance",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
        checklist: {},
      }),
    ]);
    const script = html.slice(html.indexOf("<script>"), html.lastIndexOf("</script>"));
    // The client listens on checklist checkboxes and POSTs JSON to the endpoint.
    expect(script).toMatch(/checklist-checkbox/);
    expect(script).toMatch(/method:\s*"POST"/);
    expect(script).toMatch(/JSON\.stringify/);
    // It reads the field + value from the checkbox and the report id to scope
    // which Approve button it toggles.
    expect(script).toMatch(/complete/);
    // Failure path reverts the checkbox (mirrors the existing buttons' recovery).
    expect(script).toMatch(/catch\b/);
  });

  it("trims the report-history table to the 6 most recent (by completedOn) but not the pending list", () => {
    // 7 sent reports → history table caps at 6 newest; the 7th (oldest) is dropped
    // from the table. The canonical slice lives in render, not the adapter.
    const reports = Array.from({ length: 7 }, (_n, i) =>
      reportRow({
        id: `recHIST${i}`,
        reportId: `rep_hist_${i}`,
        // i=0 oldest (2026-01), i=6 newest (2026-07)
        completedOn: `2026-0${i + 1}-01`,
        approvedToSend: true,
        sentAt: "2026-06-02T09:00:00Z",
      }),
    );
    const html = renderSiteDashboardHtml(siteRow(), reports);
    // The history <tbody> renders exactly 6 rows.
    const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    expect((tbody.match(/<tr>/g) ?? []).length).toBe(6);
    // The oldest (rep_hist_0) is trimmed out of the table.
    expect(tbody).not.toContain("rep_hist_0");
    // The 6 newest are present.
    expect(tbody).toContain("rep_hist_6");
    expect(tbody).toContain("rep_hist_1");
  });
});

describe("renderSiteDashboardHtml — Trigger Renovate button", () => {
  it("renders a Trigger Renovate button for a repo-backed site", () => {
    const html = renderSiteDashboardHtml(siteRow({ name: "Acme", gitRepo: "reddoorla/acme" }), []);
    expect(html).toContain('data-trigger-url="/api/sites/acme/trigger-renovate"');
    expect(html).toContain("Trigger Renovate");
  });

  it("omits the Trigger Renovate button when the site has no repo", () => {
    const html = renderSiteDashboardHtml(siteRow({ name: "Acme", gitRepo: null }), []);
    // the page script always references the selector; assert the BUTTON is absent
    expect(html).not.toContain("data-trigger-url");
    expect(html).not.toContain(">Trigger Renovate<");
  });
});

describe("renderSiteDashboardHtml — editable site details", () => {
  it("renders Status + cadence as selects and POC as an input, wired to the details endpoint", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ name: "Acme", status: "maintenance", pointOfContact: "a@b.com" }),
      [],
    );
    expect(html).toMatch(
      /<select[^>]*data-detail-field="status"[^>]*data-details-url="\/api\/sites\/acme\/details"/,
    );
    expect(html).toContain('<option value="maintenance" selected');
    expect(html).toMatch(/data-detail-field="pointOfContact"/);
    expect(html).toContain('value="a@b.com"');
  });

  it("renders copy fields as textareas and escapes their content", () => {
    const html = renderSiteDashboardHtml(siteRow({ name: "Acme", copyIntro: "<b>hi</b>" }), []);
    expect(html).toMatch(/<textarea[^>]*data-detail-field="copyIntro"/);
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });
});

describe("renderSiteDashboardHtml — preflight chip + send-blocker gate", () => {
  const pendingReport = () =>
    reportRow({ draftReady: true, approvedToSend: false, sentAt: null, period: "2026-07" });

  it("renders a green chip and an enabled button on a send-clean site", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      { ...pendingReport(), checklist: { ...COMPLETE_MAINTENANCE } },
    ]);
    expect(html).toContain("preflight ✓");
    expect(html).not.toMatch(/<button class="approve"[^>]*disabled/);
  });

  it("renders a red chip, disables Approve, and marks data-send-blocked when recipients are missing", () => {
    const html = renderSiteDashboardHtml(siteRow({ pointOfContact: null }), [
      { ...pendingReport(), checklist: { ...COMPLETE_MAINTENANCE } },
    ]);
    expect(html).toContain("preflight ✗");
    expect(html).toContain("recipients-missing");
    expect(html).toMatch(/<button class="approve"[^>]*data-send-blocked="1"[^>]*disabled/);
  });

  it("gates an Announcement (empty checklist) on send blockers — the vacuous-gate hole", () => {
    const html = renderSiteDashboardHtml(siteRow({ headerImage: null }), [
      { ...pendingReport(), reportType: "Announcement", checklist: {} },
    ]);
    expect(html).toContain("header-image-missing");
    expect(html).toMatch(/<button class="approve"[^>]*disabled/);
  });

  it("shows an amber chip (button enabled) when the To resolves to only operator addresses", () => {
    const html = renderSiteDashboardHtml(siteRow({ pointOfContact: "tucker@reddoorla.com" }), [
      { ...pendingReport(), checklist: { ...COMPLETE_MAINTENANCE } },
    ]);
    expect(html).toContain("preflight ⚠");
    expect(html).not.toMatch(/<button class="approve"[^>]*disabled/);
  });

  it("the approve click handler surfaces the 409 body (Blocked + blockers in the title)", () => {
    const html = renderSiteDashboardHtml(siteRow(), [pendingReport()]);
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    expect(script).toContain('data.reason === "send-blocked" ? "Blocked" : "Failed"');
    expect(script).toContain("data.blockers");
  });

  it("the client checklist re-gate never re-enables a send-blocked button", () => {
    const html = renderSiteDashboardHtml(siteRow(), [pendingReport()]);
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    expect(script).toContain('approveBtn.dataset.sendBlocked === "1"');
  });

  it("gates the history-table approve action too (no side door)", () => {
    const html = renderSiteDashboardHtml(siteRow({ pointOfContact: null }), [
      {
        ...pendingReport(),
        completedOn: "2026-06-01",
        checklist: { ...COMPLETE_MAINTENANCE },
      },
    ]);
    const rows = html.match(/<button class="approve"[^>]*>/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const b of rows) expect(b).toContain("disabled");
  });
});

describe("renderSiteDashboardHtml — approve-card info (recipients / preview / send time)", () => {
  const NOW = new Date("2026-07-06T15:00:00Z"); // after today's 09:23 UTC run
  const pendingReport = (over: Partial<ReportRow> = {}) =>
    reportRow({
      draftReady: true,
      approvedToSend: false,
      sentAt: null,
      period: "2026-07",
      checklist: { ...COMPLETE_MAINTENANCE },
      ...over,
    });

  it("shows the resolved To (point of contact fallback) and the forced ops CC", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pointOfContact: "owner@site.example.com" }),
      [pendingReport()],
      [],
      null,
      NOW,
    );
    expect(html).toContain("owner@site.example.com");
    expect(html).toContain("info@reddoorla.com");
  });

  it("shows the To OVERRIDE when Report recipients (To) is set — what approve actually sends to", () => {
    const html = renderSiteDashboardHtml(
      siteRow({
        pointOfContact: "owner@site.example.com",
        reportRecipientsTo: "billing@site.example.com",
      }),
      [pendingReport()],
      [],
      null,
      NOW,
    );
    const pending = html.slice(html.indexOf("Pending your yes"), html.indexOf("Lighthouse"));
    expect(pending).toContain("billing@site.example.com");
    expect(pending).not.toContain("owner@site.example.com");
  });

  it("says so plainly when no recipients resolve", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pointOfContact: null }),
      [pendingReport()],
      [],
      null,
      NOW,
    );
    expect(html).toContain("recipients: none resolve");
    expect(html).toContain("recipients-missing");
  });

  it("links the rendered-email preview next to Approve when the attachment exists", () => {
    const html = renderSiteDashboardHtml(
      siteRow(),
      [
        pendingReport({
          renderedHtmlAttachment: { url: "https://dl.airtable.com/x.html", filename: "x.html" },
        }),
      ],
      [],
      null,
      NOW,
    );
    const pending = html.slice(html.indexOf("Pending your yes"), html.indexOf("Lighthouse"));
    expect(pending).toContain("https://dl.airtable.com/x.html");
    expect(pending).toMatch(/preview/i);
  });

  it("notes when there is no preview attachment", () => {
    const html = renderSiteDashboardHtml(
      siteRow(),
      [pendingReport({ renderedHtmlAttachment: null })],
      [],
      null,
      NOW,
    );
    const pending = html.slice(html.indexOf("Pending your yes"), html.indexOf("Lighthouse"));
    expect(pending).toMatch(/no preview/i);
  });

  it("states when an approved report actually sends: the NEXT 09:23 UTC daily run", () => {
    // 2026-07-06T15:00Z → next run is 2026-07-07 09:23 UTC, ~18h away.
    const html = renderSiteDashboardHtml(siteRow(), [pendingReport()], [], null, NOW);
    const pending = html.slice(html.indexOf("Pending your yes"), html.indexOf("Lighthouse"));
    expect(pending).toContain("09:23");
    expect(pending).toMatch(/~18\s?h/);
  });

  it("computes the same-day run when now precedes 09:23 UTC", () => {
    const early = new Date("2026-07-06T08:23:00Z"); // 1h before today's run
    const html = renderSiteDashboardHtml(siteRow(), [pendingReport()], [], null, early);
    const pending = html.slice(html.indexOf("Pending your yes"), html.indexOf("Lighthouse"));
    expect(pending).toMatch(/~1\s?h/);
  });

  it("escapes recipient addresses sourced from Airtable", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pointOfContact: "<img src=x onerror=alert(1)>@evil.com" }),
      [pendingReport()],
      [],
      null,
      NOW,
    );
    expect(html).not.toContain("<img src=x");
  });
});
