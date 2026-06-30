import { describe, it, expect } from "vitest";
import { buildLaunchMjml } from "../../src/reports/launch-email/template.js";
import type { ReportData } from "../../src/reports/types.js";

function baseData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Launch",
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

describe("buildLaunchMjml contact heading", () => {
  it("renders the first contact line ('Just hit reply.') as a red bold heading", () => {
    const mjml = buildLaunchMjml(baseData());
    expect(mjml).toContain(
      `<mj-text color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" line-height="30px">Just hit reply.</mj-text>`,
    );
  });
});
