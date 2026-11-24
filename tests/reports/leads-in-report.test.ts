import { describe, it, expect } from "vitest";
import { leadsSection } from "../../src/reports/email-sections.js";
import { renderReportHtml } from "../../src/reports/render.js";
import type { ReportData } from "../../src/reports/types.js";

/** P1-127: the client report's LEADS block. */
const base = (over: Partial<ReportData> = {}): ReportData =>
  ({
    siteName: "Acme",
    siteUrl: "https://acme.example.com",
    reportType: "Maintenance",
    completedOn: new Date("2026-11-24T20:00:00Z"),
    lighthouse: { performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
    lastTestedDate: null,
    commentary: null,
    ...over,
  }) as ReportData;

describe("leadsSection", () => {
  it("states the last 30 days in big red and the change against the 30 before", () => {
    const html = leadsSection({ current: 12, previous: 8, periodDays: 30, background: "white" });
    expect(html).toContain(">LEADS<");
    expect(html).toContain(">12 Leads<");
    expect(html).toContain("▲ 50% vs the previous 30 days (8 → 12)");
    expect(html).toContain("leaving out spam, newsletter sign-ups and RSVPs");
  });

  it("reads the trend in the right direction (current vs previous, not swapped)", () => {
    const html = leadsSection({ current: 4, previous: 10, periodDays: 30, background: "white" });
    expect(html).toContain(">4 Leads<");
    expect(html).toContain("▼ 60% vs the previous 30 days (10 → 4)");
  });

  it("says one Lead, and shows a real zero", () => {
    expect(leadsSection({ current: 1, previous: 2, background: "white" })).toContain(">1 Lead<");
    expect(leadsSection({ current: 0, previous: 0, background: "white" })).toContain(">0 Leads<");
  });

  it("renders nothing when the counts were not read", () => {
    expect(leadsSection({ current: undefined, previous: 3, background: "white" })).toBe("");
    expect(leadsSection({ current: 3, previous: undefined, background: "white" })).toBe("");
  });
});

describe("the maintenance report with leads", () => {
  it("carries the LEADS block after ANALYTICS when the row has counts", async () => {
    const { html } = await renderReportHtml(
      base({
        gaUsersCurrent: 217,
        gaUsersPrevious: 206,
        gaPeriodDays: 30,
        leadsCurrent: 12,
        leadsPrevious: 8,
      }),
    );
    expect(html).toContain(">12 Leads<");
    expect(html.indexOf(">LEADS<")).toBeGreaterThan(html.indexOf(">ANALYTICS<"));
  });

  it("has no LEADS block when the row has none", async () => {
    const { html } = await renderReportHtml(base());
    expect(html).not.toContain(">LEADS<");
  });
});
