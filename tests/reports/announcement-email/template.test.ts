import { describe, it, expect } from "vitest";
import { buildAnnouncementMjml } from "../../../src/reports/announcement-email/template.js";
import type { ReportData } from "../../../src/reports/types.js";
import { DEFAULT_COPY } from "../../../src/reports/copy.js";

function baseData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Announcement",
    completedOn: new Date("2026-06-17"),
    lighthouse: { performance: 98, accessibility: 97, bestPractices: 78, seo: 100 },
    lastTestedDate: null,
    commentary: null,
    copy: DEFAULT_COPY,
    headerImageCid: "x-header",
    ...over,
  };
}

describe("buildAnnouncementMjml", () => {
  // announceBody / announceCadence / announceOpenDoor contain apostrophes and em
  // dashes that the template escapes to entities (proven by the escaping test below),
  // so assert special-char-free substrings of them — the launch test does the same.
  it("renders the announcement heading, body, and standing copy", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain(DEFAULT_COPY.announceHeading); // dynamic — no special chars
    expect(mjml).toContain(DEFAULT_COPY.announcePreviewLabel); // "From your latest full site test:"
    expect(mjml).toContain("completed a full test of your site"); // announceBody
    expect(mjml).toContain("expand the scope, add features"); // announceOpenDoor
  });

  it("renders the go-forward cadence from data.cadence, mapping Frequency → phrase", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "Quarterly" } }),
    );
    expect(mjml).toContain(DEFAULT_COPY.announceCadenceHeading); // "WHAT TO EXPECT"
    expect(mjml).toContain("Full site testing");
    expect(mjml).toContain("every quarter");
    expect(mjml).toContain("Routine maintenance");
    expect(mjml).toContain("every month");
    expect(mjml).toContain("send you a short report like this"); // announceCadence note
  });

  it("omits a cadence line set to None, and the whole section when neither is set", () => {
    const onlyMaint = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Yearly", testing: "None" } }),
    );
    expect(onlyMaint).toContain("Routine maintenance");
    expect(onlyMaint).toContain("every year");
    expect(onlyMaint).not.toContain("Full site testing");

    const none = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "None", testing: "None" } }),
    );
    expect(none).not.toContain(DEFAULT_COPY.announceCadenceHeading);
    expect(none).not.toContain("Full site testing");
    expect(none).not.toContain("Routine maintenance");

    const absent = buildAnnouncementMjml(baseData()); // no cadence at all
    expect(absent).not.toContain(DEFAULT_COPY.announceCadenceHeading);
  });

  it("renders each of the four Lighthouse score numbers", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain(">98<");
    expect(mjml).toContain(">97<");
    expect(mjml).toContain(">78<");
    expect(mjml).toContain(">100<");
  });

  it("labels the scores with the same client-facing labels as the maintenance report", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain(">Performance<");
    expect(mjml).toContain(">Readability<");
    expect(mjml).toContain(">Best Practices<");
    expect(mjml).toContain(">Site Structure<");
  });

  it("renders the four monitored items", () => {
    const mjml = buildAnnouncementMjml(baseData());
    for (const item of DEFAULT_COPY.announceMonitorItems) {
      expect(mjml).toContain(item);
    }
  });

  // announceImprovementResend has no special chars (asserted raw); announceImprovementSvelte5
  // contains apostrophes + an em dash that escape to entities → assert a clean substring.
  const RESEND_TEXT = DEFAULT_COPY.announceImprovementResend;
  const SVELTE5_FRAGMENT = "modernized your site to the latest framework";

  it("renders BOTH improvement callouts when both flags are set", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ improvements: { resendForms: true, svelte5: true } }),
    );
    expect(mjml).toContain(RESEND_TEXT);
    expect(mjml).toContain(SVELTE5_FRAGMENT);
  });

  it("renders only the Resend callout when only resendForms is set", () => {
    const mjml = buildAnnouncementMjml(baseData({ improvements: { resendForms: true } }));
    expect(mjml).toContain(RESEND_TEXT);
    expect(mjml).not.toContain(SVELTE5_FRAGMENT);
  });

  it("renders neither improvement (no dangling block) when improvements is undefined", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).not.toContain(RESEND_TEXT);
    expect(mjml).not.toContain(SVELTE5_FRAGMENT);
    // No empty bullet rows from an empty improvements list.
    expect(mjml).not.toContain("• </mj-text>");
    // No improvements heading when the list is empty.
    expect(mjml).not.toContain("RECENT IMPROVEMENTS");
  });

  it("never mentions pricing, plans, or a price (no-pricing invariant)", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ improvements: { resendForms: true, svelte5: true } }),
    );
    expect(mjml).not.toMatch(/\$|\bprice\b|\bpricing\b|\bplan\b/i);
  });

  it("escapes the site name (proves copy/site text is escaped like the launch template)", () => {
    const mjml = buildAnnouncementMjml(baseData({ siteName: "A & B <co>" }));
    expect(mjml).not.toContain("A & B <co>");
    expect(mjml).toContain("A &amp; B &lt;co&gt;");
  });

  it("renders a per-site contact copy override", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ copy: { ...DEFAULT_COPY, contact: ["Custom line."] } }),
    );
    expect(mjml).toContain("Custom line.");
  });
});
