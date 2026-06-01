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

  // H10 regression: swapping data.lighthouse.performance and .accessibility in
  // the template would still pass the score-presence test above. This pins the
  // POSITIONAL contract by checking that each score sits under its labeled
  // section. Each chunk of the template runs from one section label to the next.
  it("places each score under the correct section label (positional)", async () => {
    const { html } = await renderReportHtml(
      baseData({ lighthouse: { performance: 12, accessibility: 34, bestPractices: 56, seo: 78 } }),
    );
    const perfIdx = html.indexOf(">Performance<");
    const readIdx = html.indexOf(">Readability<");
    const bpIdx = html.indexOf(">Best Practices<");
    const seoIdx = html.indexOf(">Site Structure<");

    expect(perfIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(perfIdx);
    expect(bpIdx).toBeGreaterThan(readIdx);
    expect(seoIdx).toBeGreaterThan(bpIdx);

    // The first occurrence of ">12<" must be between the Performance label
    // and the next label (Readability). Likewise for the others.
    const firstPerfScore = html.indexOf(">12<");
    const firstReadScore = html.indexOf(">34<");
    const firstBpScore = html.indexOf(">56<");
    const firstSeoScore = html.indexOf(">78<");

    expect(firstPerfScore).toBeGreaterThan(perfIdx);
    expect(firstPerfScore).toBeLessThan(readIdx);

    expect(firstReadScore).toBeGreaterThan(readIdx);
    expect(firstReadScore).toBeLessThan(bpIdx);

    expect(firstBpScore).toBeGreaterThan(bpIdx);
    expect(firstBpScore).toBeLessThan(seoIdx);

    expect(firstSeoScore).toBeGreaterThan(seoIdx);
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

  it("reserves the header box and sets a placeholder when dimensions are supplied", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({ headerWidth: 600, headerHeight: 800, headerBgColor: "#cfc3a8" }),
    );
    expect(warnings).toEqual([]);
    // Explicit height reserves space (stops reflow); MJML emits it as a style/attr.
    expect(html).toContain("800px");
    // Placeholder color shows while the image loads or if the client blocks images.
    expect(html).toContain("#cfc3a8");
    // Alt text for blocked-image clients.
    expect(html).toContain('alt="Acme Co maintenance report"');
  });

  it("falls back to a bare header (no placeholder color) when dimensions are absent", async () => {
    const { html } = await renderReportHtml(baseData());
    expect(html).toContain('alt="Acme Co maintenance report"');
    expect(html).not.toContain("container-background-color");
  });

  it("renders the testing checklist when reportType is Testing", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Testing" }));
    expect(html).toContain("Desktop Browsers");
    expect(html).toContain("Animation Functionality");
    // Maintenance-only blurred-tests CID should NOT appear.
    expect(html).not.toContain("rd-blurred-tests-jpg");
  });

  it("renders the blurred-tests placeholder when reportType is Maintenance", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Maintenance" }));
    expect(html).toContain("rd-blurred-tests-jpg");
    expect(html).not.toContain("Desktop Browsers");
  });

  it("references the check.png CID in checklist rows (no external CDN URL)", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Maintenance" }));
    expect(html).toContain("cid:rd-check-png");
    expect(html).not.toContain("d3eq0h5l8sxf6t.cloudfront.net");
  });

  it("shows Last Tested date on Maintenance reports (US format MM.DD.YYYY)", async () => {
    const { html } = await renderReportHtml(
      baseData({ reportType: "Maintenance", lastTestedDate: new Date("2025-03-15T00:00:00Z") }),
    );
    expect(html).toContain("03.15.2025");
  });

  it("omits the NOTES section when commentary is null", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: null }));
    expect(html).not.toContain(">NOTES<");
  });

  it("renders the NOTES section when commentary is non-empty", async () => {
    const { html } = await renderReportHtml(
      baseData({ commentary: "Migrated DNS to Cloudflare." }),
    );
    expect(html).toContain(">NOTES<");
    expect(html).toContain("Migrated DNS to Cloudflare.");
  });

  it("preserves newlines in commentary as <br/>", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: "Line one.\nLine two." }));
    expect(html).toContain("Line one.<br/>Line two.");
  });

  it("formats GA user counts with thousands separators", async () => {
    const { html } = await renderReportHtml(
      baseData({ gaUsersCurrent: 12345, gaUsersPrevious: 6789 }),
    );
    expect(html).toContain("12,345 Users");
    expect(html).toContain("Last Period: 6,789");
  });

  it("uses the site name in the preview text", async () => {
    const { html } = await renderReportHtml(baseData({ siteName: "Med Solutions of Texas" }));
    expect(html).toContain("Checked up on Med Solutions of Texas");
  });
});
