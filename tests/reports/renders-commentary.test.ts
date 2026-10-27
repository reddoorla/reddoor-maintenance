import { describe, it, expect } from "vitest";
import { renderReportHtml, rendersCommentary } from "../../src/reports/render.js";
import type { ReportData, ReportType } from "../../src/reports/types.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";

/**
 * Which report templates actually use `commentary` — measured against the REAL
 * templates, not asserted from memory.
 *
 * This exists because the console shipped a commentary editor on every unsent
 * report (#596), and only Maintenance/Testing render it: `buildLaunchMjml` and
 * `buildAnnouncementMjml` never reference the field. An operator could write
 * commentary on an Announcement, save it, preview it and find nothing, with no
 * explanation. Found by rendering a real production row with a marker in it.
 *
 * The loop below is the point: it renders every type through the real MJML
 * pipeline, so `rendersCommentary` cannot drift from what the templates do. A
 * template that starts or stops using commentary fails here.
 */
const TYPES: ReportType[] = ["Maintenance", "Testing", "Launch", "Announcement"];
const MARKER = "COMMENTARY-MARKER-9f3a";

// No `as unknown as ReportData` cast: the first version of this fixture invented
// a `copy` shape, and the cast happily hid it until the render threw inside
// escapeHtml. A typed literal makes the compiler check the fixture.
function data(type: ReportType): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: type,
    completedOn: new Date("2026-09-01T00:00:00.000Z"),
    lighthouse: { performance: 98, accessibility: 100, bestPractices: 96, seo: 92 },
    lastTestedDate: null,
    commentary: MARKER,
    copy: DEFAULT_COPY,
    headerImageCid: "acme-co-header",
    headerWidth: 600,
    headerHeight: 300,
    headerBgColor: "#cccccc",
  };
}

describe("rendersCommentary", () => {
  for (const type of TYPES) {
    it(`agrees with what the real ${type} template does with commentary`, async () => {
      const { html } = await renderReportHtml(data(type));
      expect(html.includes(MARKER)).toBe(rendersCommentary(type));
    });
  }

  it("names Maintenance and Testing as the types that carry it", () => {
    // Stated explicitly as well as measured, so the intent is greppable — the
    // loop proves it, this documents it.
    expect(TYPES.filter(rendersCommentary)).toEqual(["Maintenance", "Testing"]);
  });
});
