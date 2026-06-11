import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: "tok",
    ...over,
  };
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
