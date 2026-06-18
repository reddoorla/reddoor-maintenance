import { describe, it, expect } from "vitest";
import { buildAnnouncementMjml } from "../../../src/reports/announcement-email/template.js";
import { escapeXml } from "../../../src/reports/maintenance-email/template.js";
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

  it("renders each pace with its specific checks, mapping Frequency → phrase", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "Quarterly" } }),
    );
    expect(mjml).toContain(DEFAULT_COPY.announceCadenceHeading); // "WHAT TO EXPECT"
    expect(mjml).toContain("Full site testing");
    expect(mjml).toContain("every quarter");
    expect(mjml).toContain("Routine maintenance");
    expect(mjml).toContain("every month");
    expect(mjml).toContain("send you a short report like this"); // announceCadence note
    // Each pace lists the exact checks that pass covers, sourced from the same copy
    // arrays the monthly report renders (so the announcement can't drift from it).
    for (const check of DEFAULT_COPY.testingChecklist) expect(mjml).toContain(escapeXml(check));
    for (const check of DEFAULT_COPY.maintenanceChecks) expect(mjml).toContain(escapeXml(check));
  });

  it("omits a pace set to None along with its checks, and the whole section when neither is set", () => {
    const onlyMaint = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Yearly", testing: "None" } }),
    );
    expect(onlyMaint).toContain("Routine maintenance");
    expect(onlyMaint).toContain("every year");
    expect(onlyMaint).not.toContain("Full site testing");
    // The testing pace is gone, so its checks are too; maintenance checks remain.
    expect(onlyMaint).not.toContain("Desktop Browsers"); // a testing check
    expect(onlyMaint).toContain(escapeXml(DEFAULT_COPY.maintenanceChecks[0]!));

    const none = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "None", testing: "None" } }),
    );
    expect(none).not.toContain(DEFAULT_COPY.announceCadenceHeading);
    expect(none).not.toContain("Full site testing");
    expect(none).not.toContain("Routine maintenance");
    expect(none).not.toContain("Desktop Browsers"); // no checks rendered either

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
    expect(mjml).toContain(">Readability (A11y)<");
    expect(mjml).toContain(">Best Practices<");
    expect(mjml).toContain(">Site Structure<");
  });

  it("no longer renders a separate WHAT WE MONITOR block (folded into WHAT TO EXPECT)", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "Monthly" } }),
    );
    expect(mjml).not.toContain("WHAT WE MONITOR");
  });

  it("ends each check with the report's check image (cid:rd-check-png) — one per check, after the label", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "Monthly" } }),
    );
    // The check reuses the monthly report's bundled check image (attached inline by the send
    // path) so the announcement matches the report — one image per check across both paces.
    const checkImgs = (mjml.match(/cid:rd-check-png/g) ?? []).length;
    expect(checkImgs).toBe(
      DEFAULT_COPY.maintenanceChecks.length + DEFAULT_COPY.testingChecklist.length,
    );
    // The image follows the label text (check AFTER the word, not before it).
    const firstCheck = escapeXml(DEFAULT_COPY.testingChecklist[0]!);
    const labelIdx = mjml.indexOf(firstCheck);
    expect(labelIdx).toBeGreaterThan(-1);
    expect(mjml.indexOf("cid:rd-check-png", labelIdx)).toBeGreaterThan(labelIdx);
  });

  it("renders the thin-italic score note under the score preview, and omits it when blank", () => {
    const withNote = buildAnnouncementMjml(baseData());
    expect(withNote).toContain(escapeXml(DEFAULT_COPY.announceScoreNote));
    // Italic gloss, distinct from the footer's italic line (which uses line-height 20px).
    expect(withNote).toContain('font-style="italic" line-height="18px"');

    const blank = buildAnnouncementMjml(
      baseData({ copy: { ...DEFAULT_COPY, announceScoreNote: "" } }),
    );
    expect(blank).not.toContain(escapeXml(DEFAULT_COPY.announceScoreNote));
    expect(blank).not.toContain('font-style="italic" line-height="18px"');
  });

  it("renders TRAFFIC & SEARCH with visitors, an up-trend, and the page-1 position", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ gaUsersCurrent: 280, gaUsersPrevious: 275, searchPosition: 3 }),
    );
    expect(mjml).toContain("TRAFFIC &amp; SEARCH");
    expect(mjml).toContain("280");
    expect(mjml).toContain("visitors in the last month");
    expect(mjml).toContain("▲"); // 280 > 275 → up trend
    expect(mjml).toContain("Page 1 Google result (#3)");
  });

  it("shows visitors without a trend line when the previous period is absent", () => {
    const mjml = buildAnnouncementMjml(baseData({ gaUsersCurrent: 280 }));
    expect(mjml).toContain("280");
    expect(mjml).not.toContain("vs the previous month");
  });

  it("omits TRAFFIC & SEARCH entirely when neither visitors nor search is available", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).not.toContain("TRAFFIC &amp; SEARCH");
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

  it("never mentions pricing, plans, or a price (no-pricing invariant — full email)", () => {
    const mjml = buildAnnouncementMjml(
      baseData({
        improvements: { resendForms: true, svelte5: true },
        cadence: { maintenance: "Monthly", testing: "Monthly" },
        gaUsersCurrent: 280,
        gaUsersPrevious: 275,
        searchPosition: 3,
      }),
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
