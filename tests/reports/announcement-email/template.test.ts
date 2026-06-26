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

const BOTH_MONTHLY = { maintenance: "Monthly", testing: "Monthly" } as const;

describe("buildAnnouncementMjml", () => {
  // announceBody / announceCadence / announceOpenDoor contain apostrophes and em dashes that
  // the template escapes to entities (proven by the escaping test below), so assert
  // special-char-free substrings — the launch test does the same.
  it("renders the heading, 'Prepared for', and body", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain(DEFAULT_COPY.announceHeading); // "YOUR ONGOING SITE CARE"
    expect(mjml).toContain("Prepared for Acme Co");
    expect(mjml).toContain("completed a full test of your site"); // announceBody
  });

  it("renders the TESTING and MAINTENANCE CHECKS sections, with their report intros + every check", () => {
    const mjml = buildAnnouncementMjml(baseData({ cadence: BOTH_MONTHLY }));
    expect(mjml).toContain(">TESTING</mj-text>");
    expect(mjml).toContain(escapeXml(DEFAULT_COPY.testingIntro));
    expect(mjml).toContain(">MAINTENANCE CHECKS</mj-text>");
    expect(mjml).toContain(escapeXml(DEFAULT_COPY.maintenanceIntro));
    // Every check from the same copy arrays the monthly report renders (can't drift from it).
    for (const check of DEFAULT_COPY.testingChecklist) expect(mjml).toContain(escapeXml(check));
    for (const check of DEFAULT_COPY.maintenanceChecks) expect(mjml).toContain(escapeXml(check));
  });

  it("renders each check as a report-style row with the green check image — one per check", () => {
    const mjml = buildAnnouncementMjml(baseData({ cadence: BOTH_MONTHLY }));
    const checkImgs = (mjml.match(/cid:rd-check-png/g) ?? []).length;
    expect(checkImgs).toBe(
      DEFAULT_COPY.maintenanceChecks.length + DEFAULT_COPY.testingChecklist.length,
    );
  });

  it("omits a pace's checklist section when that pace is None", () => {
    const onlyMaint = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Yearly", testing: "None" } }),
    );
    expect(onlyMaint).not.toContain(">TESTING</mj-text>");
    expect(onlyMaint).not.toContain("Desktop Browsers"); // a testing check
    expect(onlyMaint).toContain(">MAINTENANCE CHECKS</mj-text>");
    expect(onlyMaint).toContain(escapeXml(DEFAULT_COPY.maintenanceChecks[0]!));

    const neither = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "None", testing: "None" } }),
    );
    expect(neither).not.toContain(">TESTING</mj-text>");
    expect(neither).not.toContain(">MAINTENANCE CHECKS</mj-text>");
    expect(neither).not.toContain("We do this"); // no cadence copy when both paces are None
  });

  it("renders MAINTENANCE CHECKS before TESTING", () => {
    const mjml = buildAnnouncementMjml(baseData({ cadence: BOTH_MONTHLY }));
    const maintIdx = mjml.indexOf(">MAINTENANCE CHECKS</mj-text>");
    const testIdx = mjml.indexOf(">TESTING</mj-text>");
    expect(maintIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(maintIdx);
  });

  it("gives every band symmetric 40px padding, including the shared Lighthouse + Analytics blocks", () => {
    const mjml = buildAnnouncementMjml(
      baseData({
        cadence: BOTH_MONTHLY,
        improvements: { resendForms: true },
        // GA present so the analytics band renders (it's hidden when there's no data).
        gaUsersCurrent: 280,
        gaUsersPrevious: 275,
      }),
    );
    // The five symmetric bands — intro, lighthouse, analytics, improvements, contact — each carry
    // 40px top AND bottom. (If pad stopped reaching the shared Lighthouse/Analytics blocks this
    // count would drop.) The two check-intro bands open at 40px and close via their last row.
    expect((mjml.match(/padding-top="40px" padding-bottom="40px"/g) ?? []).length).toBe(5);
    expect(mjml).toContain('padding-top="40px" padding-bottom="0px"'); // check-intro band tops
  });

  it("keeps band colors alternating when a pace is omitted (no two same-color bands abut)", () => {
    // maintenance=None → TESTING takes the second band slot, so it renders on #F4F4F4 (the slot
    // maintenance would have used), staying distinct from the white intro above it.
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "None", testing: "Monthly" } }),
    );
    const testIdx = mjml.indexOf(">TESTING</mj-text>");
    const sectionStart = mjml.lastIndexOf("<mj-section", testIdx);
    expect(mjml.slice(sectionStart, testIdx)).toContain('background-color="#F4F4F4"');
  });

  it("renders the full LIGHTHOUSE SCORES block — report labels, numbers, bands (Ideal tops at 100), footnote", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain("LIGHTHOUSE SCORES*");
    expect(mjml).toContain(">Performance</mj-text>");
    expect(mjml).toContain(">Readability (A11y)</mj-text>");
    expect(mjml).toContain(">Best Practices</mj-text>");
    expect(mjml).toContain(">Site Structure</mj-text>");
    expect(mjml).toContain(">98</mj-text>");
    expect(mjml).toContain(">97</mj-text>");
    expect(mjml).toContain(">78</mj-text>");
    expect(mjml).toContain(">100</mj-text>");
    expect(mjml).toContain("Ideal 80–100"); // Best Practices band now tops at 100
    expect(mjml).toContain("*A Lighthouse score is a numerical measure");
  });

  it("renders the ANALYTICS block: user count, trend, and the Google-position line", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ gaUsersCurrent: 280, gaUsersPrevious: 275, searchPosition: 3 }),
    );
    expect(mjml).toContain(">ANALYTICS</mj-text>");
    expect(mjml).toContain("280 Users");
    expect(mjml).toContain("▲ 2% vs last period (275 → 280)");
    expect(mjml).toContain("Page 1 Google result (#3) for your brand search");
  });

  it("omits the Google-position line when no search position is available (analytics still renders)", () => {
    const mjml = buildAnnouncementMjml(baseData({ gaUsersCurrent: 280 }));
    expect(mjml).toContain("280 Users");
    expect(mjml).not.toContain("Page 1 Google result");
  });

  it("hides the ANALYTICS block entirely when there's no GA traffic or search data", () => {
    const mjml = buildAnnouncementMjml(baseData()); // no GA, no search
    expect(mjml).not.toContain(">ANALYTICS</mj-text>");
    expect(mjml).not.toContain("Users");
  });

  it("keeps band colors alternating when the analytics block is hidden (no abutting same color)", () => {
    // No GA/search → analytics hidden. Lighthouse and the contact block sit on either side of the
    // dropped band; they must not end up the same color (the hidden band must not consume a slot).
    const mjml = buildAnnouncementMjml(baseData({ improvements: { resendForms: true } }));
    expect(mjml).not.toContain(">ANALYTICS</mj-text>");
    const lhIdx = mjml.indexOf("LIGHTHOUSE SCORES*");
    const lhSection = mjml.lastIndexOf("<mj-section", lhIdx);
    const imprIdx = mjml.indexOf("RECENT IMPROVEMENTS");
    const imprSection = mjml.lastIndexOf("<mj-section", imprIdx);
    const bg = (s: string): string => /background-color="([^"]+)"/.exec(s)?.[1] ?? "";
    // Lighthouse then (analytics hidden) then Improvements — adjacent bands, opposite colors.
    expect(bg(mjml.slice(lhSection, lhIdx))).not.toBe(bg(mjml.slice(imprSection, imprIdx)));
  });

  it("shows the ANALYTICS block with the search line even when GA is unavailable", () => {
    const mjml = buildAnnouncementMjml(baseData({ searchPosition: 3 }));
    expect(mjml).toContain(">ANALYTICS</mj-text>");
    expect(mjml).toContain("Page 1 Google result (#3) for your brand search");
    expect(mjml).not.toContain("Users"); // no user count without GA
  });

  it("bakes each pace's cadence into its block intro — no separate WHAT TO EXPECT section", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "Quarterly" } }),
    );
    expect(mjml).not.toContain("WHAT TO EXPECT");
    expect(mjml).toContain("We do this every month."); // maintenance cadence (Monthly), in its intro
    expect(mjml).toContain("We run a full test every quarter."); // testing cadence (Quarterly), in its intro
    // The report-frequency reassurance trails the last (testing) block.
    expect(mjml).toContain("send you a short report like this"); // announceCadence
  });

  it("trails the report-frequency note on maintenance when testing is None (last block)", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ cadence: { maintenance: "Monthly", testing: "None" } }),
    );
    expect(mjml).toContain("We do this every month.");
    expect(mjml).toContain("send you a short report like this"); // moved onto the maintenance block
  });

  // announceImprovementResend has no special chars (asserted raw); announceImprovementSvelte5
  // contains apostrophes + an em dash that escape to entities → assert a clean substring.
  const RESEND_TEXT = DEFAULT_COPY.announceImprovementResend;
  const SVELTE5_FRAGMENT = "modernized your site to the latest framework";

  it("renders RECENT IMPROVEMENTS with both callouts when both flags are set", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ improvements: { resendForms: true, svelte5: true } }),
    );
    expect(mjml).toContain("RECENT IMPROVEMENTS");
    expect(mjml).toContain(RESEND_TEXT);
    expect(mjml).toContain(SVELTE5_FRAGMENT);
  });

  it("renders only the Resend callout when only resendForms is set", () => {
    const mjml = buildAnnouncementMjml(baseData({ improvements: { resendForms: true } }));
    expect(mjml).toContain(RESEND_TEXT);
    expect(mjml).not.toContain(SVELTE5_FRAGMENT);
  });

  it("folds the open-door invitation into RECENT IMPROVEMENTS, reworded to 'just let us know'", () => {
    const mjml = buildAnnouncementMjml(baseData({ improvements: { resendForms: true } }));
    // The open-door rides inside the improvements block (no standalone section), and after it.
    expect(mjml.indexOf("expand the scope, add features")).toBeGreaterThan(
      mjml.indexOf("RECENT IMPROVEMENTS"),
    );
    expect(mjml).toContain("just let us know");
    expect(mjml).not.toContain("love to help"); // the old "just reply — we'd love to help" CTA is gone
  });

  it("renders no RECENT IMPROVEMENTS section (and no open-door) when improvements is undefined", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).not.toContain("RECENT IMPROVEMENTS");
    expect(mjml).not.toContain(RESEND_TEXT);
    expect(mjml).not.toContain(SVELTE5_FRAGMENT);
    expect(mjml).not.toContain("expand the scope, add features"); // open-door rides with improvements
  });

  it("never mentions pricing, plans, or a price (no-pricing invariant — full email)", () => {
    const mjml = buildAnnouncementMjml(
      baseData({
        improvements: { resendForms: true, svelte5: true },
        cadence: BOTH_MONTHLY,
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

  it("titles the contact block 'Questions, concerns or requests?' (no leading 'Any')", () => {
    const mjml = buildAnnouncementMjml(baseData());
    expect(mjml).toContain(">Questions, concerns or requests?</mj-text>");
    expect(mjml).not.toContain("Any questions, concerns or requests?");
  });

  it("renders the first contact line in black and any following lines in muted grey", () => {
    const mjml = buildAnnouncementMjml(baseData());
    // First line: no color attribute → black. (DEFAULT_COPY.contact[0] = "Just hit reply.")
    expect(mjml).toContain(
      `<mj-text font-family="helvetica, sans-serif" font-size="24px" font-weight="300" line-height="30px">Just hit reply.</mj-text>`,
    );
    // Second line carries the grey color. (DEFAULT_COPY.contact[1], apostrophe escaped.)
    expect(mjml).toContain(
      `<mj-text color="#757575" font-family="helvetica, sans-serif" font-size="24px" font-weight="300" line-height="30px">We&#39;re here to help in any way we can.</mj-text>`,
    );
  });

  it("renders the cadence reassurance tail in italics", () => {
    const mjml = buildAnnouncementMjml(baseData({ cadence: BOTH_MONTHLY }));
    expect(mjml).toContain("<em>there&#39;s nothing you need to do.</em>");
  });

  it("labels the analytics trend with the concrete window when gaPeriodDays is set", () => {
    const mjml = buildAnnouncementMjml(
      baseData({ gaUsersCurrent: 280, gaUsersPrevious: 275, gaPeriodDays: 30 }),
    );
    expect(mjml).toContain("▲ 2% vs the previous 30 days (275 → 280)");
  });
});
