import { describe, it, expect } from "vitest";
import { renderReportHtml } from "../../src/reports/render.js";
import type { ReportData } from "../../src/reports/types.js";

function baseData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Maintenance",
    completedOn: new Date("2026-06-01T12:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    gaUsersCurrent: 2341,
    gaUsersPrevious: 2112,
    lastTestedDate: new Date("2024-12-10T00:00:00Z"),
    commentary: null,
    headerImageCid: "acme-header",
    ...over,
  };
}

describe("renderReportHtml", () => {
  it("renders without MJML warnings on default data", async () => {
    const { warnings } = await renderReportHtml(baseData());
    expect(warnings).toEqual([]);
  });

  it("interpolates all four Lighthouse scores (no hardcoded 90s)", async () => {
    const { html } = await renderReportHtml(
      baseData({ lighthouse: { performance: 12, accessibility: 34, bestPractices: 56, seo: 78 } }),
    );
    expect(html).toContain(">12<");
    expect(html).toContain(">34<");
    expect(html).toContain(">56<");
    expect(html).toContain(">78<");
    expect(html).not.toContain(">90<");
  });

  it("labels the third score 'Best Practices' (not duplicate 'Performance')", async () => {
    const { html } = await renderReportHtml(baseData());
    expect(html).toContain("Best Practices");
    expect(html.match(/>Performance</g)?.length ?? 0).toBe(1);
  });

  it("uses cid:headerImageCid for the header image src", async () => {
    const { html } = await renderReportHtml(baseData({ headerImageCid: "client-xyz-header" }));
    expect(html).toContain('src="cid:client-xyz-header"');
  });

  it("renders the testing checklist when reportType is Testing", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Testing" }));
    expect(html).toContain("Desktop Browsers");
    expect(html).toContain("Animation Functionality");
    expect(html).not.toContain("blurredTests");
  });

  it("renders the blurred-tests placeholder when reportType is Maintenance", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Maintenance" }));
    expect(html).toContain("blurredTests");
    expect(html).not.toContain("Desktop Browsers");
  });

  it("shows Last Tested date on Maintenance reports", async () => {
    const { html } = await renderReportHtml(
      baseData({ reportType: "Maintenance", lastTestedDate: new Date("2025-03-15T00:00:00Z") }),
    );
    expect(html).toContain("15.03.2025");
  });

  it("omits the NOTES section when commentary is null", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: null }));
    expect(html).not.toContain(">NOTES<");
  });

  it("renders the NOTES section when commentary is non-empty", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: "Migrated DNS to Cloudflare." }));
    expect(html).toContain(">NOTES<");
    expect(html).toContain("Migrated DNS to Cloudflare.");
  });

  it("preserves newlines in commentary as <br/>", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: "Line one.\nLine two." }));
    expect(html).toContain("Line one.<br/>Line two.");
  });

  it("formats GA user counts with thousands separators", async () => {
    const { html } = await renderReportHtml(baseData({ gaUsersCurrent: 12345, gaUsersPrevious: 6789 }));
    expect(html).toContain("12,345 Users");
    expect(html).toContain("Last Period: 6,789");
  });

  it("uses the site name in the preview text", async () => {
    const { html } = await renderReportHtml(baseData({ siteName: "Med Solutions of Texas" }));
    expect(html).toContain("Checked up on Med Solutions of Texas");
  });
});
