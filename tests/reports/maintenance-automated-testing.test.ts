import { describe, it, expect } from "vitest";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";
import { passedAutomatedTests } from "../../src/reports/automated-tests.js";
import {
  MAINTENANCE_CHECKLIST,
  TESTING_CHECKLIST,
  checklistFor,
  gatingFields,
} from "../../src/reports/checklist.js";
import { renderReportHtml } from "../../src/reports/render.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";
import type { ReportData, ReportType } from "../../src/reports/types.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * 2026-11-25. Tim, #website-maintenance 10:20am PT: "replace with the AEO/SEO upsell. Then
 * include all the testing check boxes now"; the operator: "yes our tests", then "just add all
 * the tests to the maintenance section". A Maintenance report's MAINTENANCE CHECKS list ends
 * with the Testing rows the nightly automated tests passed, read when the email is built.
 */

const NOW = new Date("2026-11-25T12:00:00.000Z");
const FRESH = "2026-11-25T08:00:00.000Z";
const TEST_FIELDS = TESTING_CHECKLIST.map((i) => i.field);

/** A site whose every nightly testing signal is a fresh pass. */
function testedSite() {
  return makeWebsiteRow({
    browserCheckedAt: FRESH,
    crossbrowserOk: true,
    mobileOk: true,
    linksOk: true,
    titleMetaOk: "pass",
    formE2eCheckedAt: FRESH,
    formE2eOk: "pass",
    lastSmokeAt: FRESH,
    smokeOk: "pass",
    githubSignalsAt: FRESH,
    defaultBranchCi: "passing",
  });
}

const PASS: EvidenceRecord = { result: "pass", checkedAt: FRESH, note: "fixture" };
const MAINT_PASS = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, PASS]));
const ALL_PASS = Object.fromEntries(
  [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, PASS]),
);

function data(type: ReportType, over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: type,
    completedOn: new Date("2026-11-25T00:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
    commentary: null,
    headerImageCid: "acme-header",
    checklistEvidence: type === "Testing" ? ALL_PASS : MAINT_PASS,
    ...over,
  };
}

function rowText(label: string): RegExp {
  return new RegExp(`>\\s*${label.replace(/[&]/g, "&amp;")}\\s*<`);
}

/** Each checklist row's label, in the order the email shows them. */
function shownRows(html: string): string[] {
  const labels = [...DEFAULT_COPY.maintenanceChecks, ...DEFAULT_COPY.testingChecklist];
  return labels
    .map((label) => ({ label, at: html.search(rowText(label)) }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((r) => r.label);
}

describe("passedAutomatedTests: the Testing rows the nightlies passed, as of the render", () => {
  it("lists every Testing row with a fresh pass", () => {
    expect(passedAutomatedTests(testedSite(), NOW)).toEqual(TEST_FIELDS);
  });

  it("leaves out a failed row", () => {
    const site = { ...testedSite(), mobileOk: false, smokeOk: "fail" as const };
    const out = passedAutomatedTests(site, NOW);
    expect(out).not.toContain("Test: Mobile Browsers");
    expect(out).not.toContain("Test: Interactions & Animations");
    expect(out).toContain("Test: Desktop Browsers");
  });

  it("leaves out a pass more than 3 days old at `now` (a report drafted a week before its send)", () => {
    const old = "2026-11-22T11:59:00.000Z"; // 3 days and a minute before NOW
    const site = { ...testedSite(), browserCheckedAt: old, lastSmokeAt: old };
    const out = passedAutomatedTests(site, NOW);
    expect(out).not.toContain("Test: Desktop Browsers");
    expect(out).not.toContain("Test: Interactions & Animations");
    expect(out).toContain("Test: Form Functionality");
  });

  it("keeps a pass exactly 3 days old, and leaves out one stamped after `now`", () => {
    const site = {
      ...testedSite(),
      browserCheckedAt: "2026-11-22T12:00:00.000Z",
      lastSmokeAt: "2026-11-26T12:00:00.000Z",
    };
    const out = passedAutomatedTests(site, NOW);
    expect(out).toContain("Test: Desktop Browsers");
    expect(out).not.toContain("Test: Interactions & Animations");
  });

  it("lists nothing for a site the nightlies never measured, and no form row without a form", () => {
    expect(passedAutomatedTests(makeWebsiteRow(), NOW)).toEqual([]);
    const noForm = { ...testedSite(), formE2eOk: null };
    expect(passedAutomatedTests(noForm, NOW)).not.toContain("Test: Form Functionality");
  });

  it("changes neither the Maintenance checkboxes nor its send gate", () => {
    expect(checklistFor("Maintenance")).toEqual(MAINTENANCE_CHECKLIST);
    expect(gatingFields("Maintenance").some((f) => f.startsWith("Test:"))).toBe(false);
  });
});

describe("the Testing rows on a Maintenance email", () => {
  it("end the MAINTENANCE CHECKS list, with no TESTING section and no blurred image", async () => {
    const { html } = await renderReportHtml(
      data("Maintenance", { automatedTestsPassed: TEST_FIELDS }),
    );
    expect(shownRows(html)).toEqual([
      ...DEFAULT_COPY.maintenanceChecks,
      ...DEFAULT_COPY.testingChecklist,
    ]);
    const heading = html.search(rowText("MAINTENANCE CHECKS"));
    expect(heading).toBeGreaterThanOrEqual(0);
    const last = html.search(rowText("Tested After Updates"));
    expect(last).toBeGreaterThan(heading);
    expect(last).toBeLessThan(html.indexOf("LIGHTHOUSE"));
    expect(html).not.toMatch(rowText("TESTING"));
    expect(html).not.toContain(DEFAULT_COPY.testingIntro);
    expect(html).not.toContain("rd-blurred-tests-jpg");
  });

  it("show a per-site copy override of a Testing label, not the default", async () => {
    const copy = {
      ...DEFAULT_COPY,
      testingChecklist: DEFAULT_COPY.testingChecklist.map((l) =>
        l === "Desktop Browsers" ? "Desktop Browser Checks" : l,
      ),
    };
    const { html } = await renderReportHtml(
      data("Maintenance", { automatedTestsPassed: TEST_FIELDS, copy }),
    );
    expect(html).toMatch(rowText("Desktop Browser Checks"));
    expect(html).not.toMatch(rowText("Desktop Browsers"));
  });

  it("show only the fields passed in, in checklist order", async () => {
    const { html } = await renderReportHtml(
      data("Maintenance", {
        automatedTestsPassed: ["Test: Verified After Updates", "Test: Page Titles & Meta"],
      }),
    );
    expect(shownRows(html)).toEqual([
      ...DEFAULT_COPY.maintenanceChecks,
      "Page Titles & Meta",
      "Tested After Updates",
    ]);
  });

  it("are absent when nothing passed or no list was given; stored Test: evidence alone never ticks one", async () => {
    for (const over of [{ automatedTestsPassed: [] }, {}, { checklistEvidence: ALL_PASS }]) {
      const { html } = await renderReportHtml(data("Maintenance", over));
      expect(shownRows(html)).toEqual(DEFAULT_COPY.maintenanceChecks);
    }
  });

  // The operator, 11-25 3:22pm PT, on the [TEST]: "'last items' is not specific in context, just
  // remove that sentence". The intro over the list is the default intro alone, Testing rows or not.
  it("leave the intro over the list as the plain intro, with nothing appended", async () => {
    const { html } = await renderReportHtml(
      data("Maintenance", { automatedTestsPassed: TEST_FIELDS }),
    );
    const at = html.indexOf(DEFAULT_COPY.maintenanceIntro);
    expect(at).toBeGreaterThanOrEqual(0);
    const after = html.slice(at + DEFAULT_COPY.maintenanceIntro.length).trimStart();
    expect(after.startsWith("<")).toBe(true);
    expect(html).not.toContain("tested automatically every night");

    const copy = { ...DEFAULT_COPY, maintenanceIntro: "Custom intro." };
    const custom = await renderReportHtml(
      data("Maintenance", { automatedTestsPassed: TEST_FIELDS, copy }),
    );
    expect(custom.html).toMatch(/Custom intro\.\s*</);
  });

  it("leave a Testing report as it was, even if a list is passed", async () => {
    const { html } = await renderReportHtml(data("Testing", { automatedTestsPassed: TEST_FIELDS }));
    expect(html).toMatch(rowText("TESTING"));
    expect(html).toContain(DEFAULT_COPY.testingIntro);
    const testingHeading = html.search(rowText("TESTING"));
    for (const label of DEFAULT_COPY.testingChecklist) {
      expect(html.search(rowText(label)), label).toBeGreaterThan(testingHeading);
    }
  });
});

describe("the AEO/SEO block in the upsell's slot (the operator's pick (a), 11-25)", () => {
  it("is on a Maintenance report, names the site, and links to mailto:info@reddoorla.com", async () => {
    const { html } = await renderReportHtml(data("Maintenance", { siteName: "Brown & Co" }));
    expect(html).toMatch(rowText("AI SEARCH & SEO"));
    expect(html).toContain("How does Brown &amp; Co show up on Google");
    expect(html).not.toContain("{site}");
    expect(html).toContain('href="mailto:info@reddoorla.com"');
  });

  it("sits after LEADS, where the blurred image was, and after the checklist", async () => {
    const { html } = await renderReportHtml(
      data("Maintenance", {
        automatedTestsPassed: TEST_FIELDS,
        leadsCurrent: 2,
        leadsPrevious: 1,
      }),
    );
    const aeo = html.search(rowText("AI SEARCH & SEO"));
    expect(aeo).toBeGreaterThan(html.search(rowText("LEADS")));
    expect(aeo).toBeGreaterThan(html.search(rowText("Tested After Updates")));
  });

  it("is not on a Testing report", async () => {
    const { html } = await renderReportHtml(data("Testing"));
    expect(html).not.toMatch(rowText("AI SEARCH & SEO"));
    expect(html).not.toContain("mailto:info@reddoorla.com");
  });
});
