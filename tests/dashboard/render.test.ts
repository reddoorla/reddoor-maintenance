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
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
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
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    completedOn: "2026-05-01",
    lighthouse: { performance: 87, accessibility: 95, bestPractices: 90, seo: 100 },
    gaUsersCurrent: 2100,
    gaUsersPrevious: 1900,
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

  it("renders all 4 lighthouse scores under their correct labels (positional)", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pScore: 12, rScore: 34, bpScore: 56, seoScore: 78 }),
      [],
    );
    const perfIdx = html.indexOf(">Performance<");
    const accIdx = html.indexOf(">Accessibility<");
    const bpIdx = html.indexOf(">Best Practices<");
    const seoIdx = html.indexOf(">SEO<");
    expect(perfIdx).toBeGreaterThan(-1);
    expect(accIdx).toBeGreaterThan(-1);
    expect(bpIdx).toBeGreaterThan(-1);
    expect(seoIdx).toBeGreaterThan(-1);
    expect(html.slice(perfIdx, accIdx)).toContain(">12<");
    expect(html.slice(accIdx, bpIdx)).toContain(">34<");
    expect(html.slice(bpIdx, seoIdx)).toContain(">56<");
    expect(html.slice(seoIdx)).toContain(">78<");
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
