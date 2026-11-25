import { describe, it, expect } from "vitest";
import {
  autoTickChecklist,
  type EvidenceRecord,
  type EvidenceResult,
} from "../../src/reports/auto-tick.js";
import {
  MAINTENANCE_CHECKLIST,
  TESTING_CHECKLIST,
  checklistFor,
  gatingFields,
  isHealthGateClear,
} from "../../src/reports/checklist.js";
import { renderReportHtml } from "../../src/reports/render.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";
import type { ReportData, ReportType } from "../../src/reports/types.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * 2026-11-25 (Tim, #website-maintenance, 10:20am PT: "replace with the AEO/SEO upsell. Then
 * include all the testing check boxes now"; the operator: "yes our tests"): every Maintenance
 * report shows the TESTING checklist in place of the blurred image, ticked only by the nightly
 * automated tests. A row is ticked only on a fresh `pass`; nothing ticks it by default.
 */

const NOW = new Date("2026-11-25T12:00:00.000Z");
const FRESH = "2026-11-25T08:00:00.000Z";
const NO_SEARCH = { search: { value: null, softFailed: false, notConfigured: false } };
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

function ev(result: EvidenceResult): EvidenceRecord {
  return { result, checkedAt: FRESH, note: "fixture" };
}

function data(type: ReportType, evidence: Record<string, EvidenceRecord>): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: type,
    completedOn: new Date("2026-11-25T12:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
    commentary: null,
    headerImageCid: "acme-header",
    checklistEvidence: evidence,
  };
}

function allPass(): Record<string, EvidenceRecord> {
  return Object.fromEntries(
    [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, ev("pass")]),
  );
}

function rowText(label: string): RegExp {
  return new RegExp(`>\\s*${label.replace(/[&]/g, "&amp;")}\\s*<`);
}

describe("a Maintenance report's evidence includes the nightly testing rows", () => {
  it("records a pass for each Testing row the nightlies passed", () => {
    const out = autoTickChecklist(testedSite(), "Maintenance", NOW, NO_SEARCH);
    for (const field of TEST_FIELDS) expect(out.get(field)?.result, field).toBe("pass");
  });

  it("records a fail as a fail, never a pass", () => {
    const site = { ...testedSite(), mobileOk: false, smokeOk: "fail" as const };
    const out = autoTickChecklist(site, "Maintenance", NOW, NO_SEARCH);
    expect(out.get("Test: Mobile Browsers")?.result).toBe("fail");
    expect(out.get("Test: Interactions & Animations")?.result).toBe("fail");
  });

  it("omits an unmeasured Testing row (not unknown) and keeps the send gate as it was", () => {
    const out = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, NO_SEARCH);
    for (const field of TEST_FIELDS) expect(out.has(field), field).toBe(false);
    expect(gatingFields("Maintenance").some((f) => f.startsWith("Test:"))).toBe(false);
    // Maintenance rows all pass, Testing rows all fail: the Maintenance gate is still clear.
    const evidence = Object.fromEntries([
      ...MAINTENANCE_CHECKLIST.map((i) => [i.field, ev("pass")] as const),
      ...TEST_FIELDS.map((f) => [f, ev("fail")] as const),
    ]);
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: evidence })).toBe(true);
  });

  it("leaves the Maintenance checkboxes at the six maintenance rows", () => {
    expect(checklistFor("Maintenance")).toEqual(MAINTENANCE_CHECKLIST);
  });
});

describe("the Maintenance email's TESTING list", () => {
  it("shows every Testing row the nightlies passed, under the automated intro, with no blurred image", async () => {
    const { html } = await renderReportHtml(data("Maintenance", allPass()));
    expect(html).toMatch(rowText("TESTING"));
    expect(html).toContain(DEFAULT_COPY.automatedTestingIntro);
    expect(html).not.toContain(DEFAULT_COPY.testingIntro);
    for (const label of DEFAULT_COPY.testingChecklist) expect(html, label).toMatch(rowText(label));
    expect(html).not.toContain("rd-blurred-tests-jpg");
  });

  it("leaves out a row that failed, is stale, does not apply, or has no record", async () => {
    const evidence = allPass();
    evidence["Test: Desktop Browsers"] = ev("fail");
    evidence["Test: Mobile Browsers"] = ev("unknown");
    evidence["Test: Form Functionality"] = ev("n/a");
    delete evidence["Test: Links & Navigation"];
    const { html } = await renderReportHtml(data("Maintenance", evidence));
    for (const label of [
      "Desktop Browsers",
      "Mobile Browsers",
      "Form Functionality",
      "Links & Navigation",
    ]) {
      expect(html, label).not.toMatch(rowText(label));
    }
    for (const label of [
      "Page Titles & Meta",
      "Interactions & Animations",
      "Tested After Updates",
    ]) {
      expect(html, label).toMatch(rowText(label));
    }
  });

  it("drops the whole section when no Testing row passed", async () => {
    const evidence = Object.fromEntries(
      MAINTENANCE_CHECKLIST.map((i) => [i.field, ev("pass")] as const),
    );
    const { html } = await renderReportHtml(data("Maintenance", evidence));
    expect(html).not.toMatch(rowText("TESTING"));
  });

  it("leaves a Testing report's TESTING section as it was", async () => {
    const { html } = await renderReportHtml(data("Testing", allPass()));
    expect(html).toMatch(rowText("TESTING"));
    expect(html).toContain(DEFAULT_COPY.testingIntro);
    expect(html).not.toContain(DEFAULT_COPY.automatedTestingIntro);
    for (const label of DEFAULT_COPY.testingChecklist) expect(html, label).toMatch(rowText(label));
  });
});

describe("the AEO/SEO block in the upsell's slot (the operator's pick (a), 11-25)", () => {
  it("is on a Maintenance report, names the site, and links to mailto:info@reddoorla.com", async () => {
    const { html } = await renderReportHtml({
      ...data("Maintenance", allPass()),
      siteName: "Brown & Co",
    });
    expect(html).toMatch(rowText("AI SEARCH & SEO"));
    expect(html).toContain("How does Brown &amp; Co show up on Google");
    expect(html).not.toContain("{site}");
    expect(html).toContain('href="mailto:info@reddoorla.com"');
  });

  it("sits before the TESTING list", async () => {
    const { html } = await renderReportHtml(data("Maintenance", allPass()));
    expect(html.search(rowText("AI SEARCH & SEO"))).toBeLessThan(html.search(rowText("TESTING")));
  });

  it("is not on a Testing report", async () => {
    const { html } = await renderReportHtml(data("Testing", allPass()));
    expect(html).not.toMatch(rowText("AI SEARCH & SEO"));
    expect(html).not.toContain("mailto:info@reddoorla.com");
  });
});
