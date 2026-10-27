import { describe, it, expect } from "vitest";
import { renderReportHtml } from "../../src/reports/render.js";
import { CHECK_CID } from "../../src/reports/maintenance-email/assets/index.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../../src/reports/checklist.js";
import type { EvidenceRecord, EvidenceResult } from "../../src/reports/auto-tick.js";
import type { ReportData, ReportType } from "../../src/reports/types.js";

/**
 * BACKLOG Operator decision 17 (#957 follow-up), decided 2026-09-29: a checklist row whose
 * evidence is `n/a` is DROPPED from the client email. Not a ✓, not "N/A". Every other row
 * renders exactly as before. These render through the real MJML pipeline, so they pin the
 * HTML a client receives, and its text once the tags are stripped.
 */

const MAINT_LABELS = MAINTENANCE_CHECKLIST.map((i) => i.label);
const TEST_LABELS = TESTING_CHECKLIST.map((i) => i.label);
const CHECK = `cid:${CHECK_CID}`;

function ev(result: EvidenceResult): EvidenceRecord {
  return { result, checkedAt: "2026-09-28T00:00:00.000Z", note: "fixture" };
}

function evidenceFor(
  type: ReportType,
  overrides: Record<string, EvidenceResult> = {},
): Record<string, EvidenceRecord> {
  const fields =
    type === "Testing" ? [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST] : MAINTENANCE_CHECKLIST;
  return Object.fromEntries(fields.map((i) => [i.field, ev(overrides[i.field] ?? "pass")]));
}

function data(type: ReportType, over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: type,
    completedOn: new Date("2026-09-01T12:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
    commentary: null,
    headerImageCid: "acme-header",
    ...over,
  };
}

async function render(d: ReportData): Promise<{ html: string; text: string; checks: number }> {
  const { html } = await renderReportHtml(d);
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text, checks: html.split(CHECK).length - 1 };
}

function rowText(label: string): RegExp {
  return new RegExp(`>\\s*${label.replace(/[&]/g, "&amp;")}\\s*<`);
}

const CMS = "Maint: CMS Checked";
const FORMS = "Test: Form Functionality";
const UPDATES = "Test: Verified After Updates";

describe("Maintenance email checklist: n/a rows are dropped (decision 17)", () => {
  it("all pass: every Maintenance row renders with its check, as before", async () => {
    const r = await render(data("Maintenance", { checklistEvidence: evidenceFor("Maintenance") }));
    for (const label of MAINT_LABELS) expect(r.html).toMatch(rowText(label));
    expect(r.checks).toBe(6);
  });

  it("no evidence at all (an old caller): every row renders, as before", async () => {
    const r = await render(data("Testing"));
    for (const label of [...MAINT_LABELS, ...TEST_LABELS]) expect(r.html).toMatch(rowText(label));
    expect(r.checks).toBe(13);
  });

  it("one n/a (no CMS): the CMS row is gone from the HTML and the text; the rest stay", async () => {
    const r = await render(
      data("Maintenance", { checklistEvidence: evidenceFor("Maintenance", { [CMS]: "n/a" }) }),
    );
    expect(r.html).not.toContain("CMS Checked");
    expect(r.text).not.toContain("CMS Checked");
    expect(r.text).not.toMatch(/N\/A/i);
    for (const label of MAINT_LABELS.filter((l) => l !== "CMS Checked")) {
      expect(r.html).toMatch(rowText(label));
    }
    expect(r.checks).toBe(5);
  });

  it("the Google row keeps its live position when a row before it is dropped", async () => {
    const r = await render(
      data("Maintenance", {
        searchPosition: 3,
        checklistEvidence: evidenceFor("Maintenance", { [CMS]: "n/a" }),
      }),
    );
    expect(r.html).toContain("Page 1 Google Result (#3)");
    expect(r.html).not.toMatch(rowText("Google Indexed"));
    expect(r.html).not.toContain("CMS Checked");
    expect(r.html).toMatch(rowText("Security Updates"));
  });

  it("the last row keeps the closing gap and loses its rule when the old last row is dropped", async () => {
    const r = await render(
      data("Maintenance", {
        checklistEvidence: evidenceFor("Maintenance", { "Maint: Uptime Checked": "n/a" }),
      }),
    );
    expect(r.html).not.toContain("Uptime Checked");
    const before = await render(
      data("Maintenance", { checklistEvidence: evidenceFor("Maintenance") }),
    );
    const closing = (html: string) => (html.match(/padding-bottom:36px/g) ?? []).length;
    expect(closing(r.html)).toBe(closing(before.html));
    const rules = (html: string) => (html.match(/border-bottom:solid #CCCCCC 1px/g) ?? []).length;
    expect(rules(before.html) - rules(r.html)).toBe(2);
  });

  it("several n/a (Testing: no CMS, no form, no CI): all three gone, ten rows remain", async () => {
    const r = await render(
      data("Testing", {
        checklistEvidence: evidenceFor("Testing", {
          [CMS]: "n/a",
          [FORMS]: "n/a",
          [UPDATES]: "n/a",
        }),
      }),
    );
    for (const gone of ["CMS Checked", "Form Functionality", "Tested After Updates"]) {
      expect(r.html).not.toContain(gone);
      expect(r.text).not.toContain(gone);
    }
    expect(r.checks).toBe(10);
    expect(r.html).toMatch(/>\s*TESTING\s*</);
    expect(r.html).toMatch(rowText("Interactions & Animations"));
  });

  it("only n/a drops a row: fail and unknown rows still render (their look is not decided here)", async () => {
    const r = await render(
      data("Testing", {
        checklistEvidence: evidenceFor("Testing", { [CMS]: "fail", [FORMS]: "unknown" }),
      }),
    );
    expect(r.html).toMatch(rowText("CMS Checked"));
    expect(r.html).toMatch(rowText("Form Functionality"));
    expect(r.checks).toBe(13);
  });

  it("a row with no evidence record still renders", async () => {
    const partial = evidenceFor("Maintenance");
    delete partial[CMS];
    const r = await render(data("Maintenance", { checklistEvidence: partial }));
    expect(r.html).toMatch(rowText("CMS Checked"));
    expect(r.checks).toBe(6);
  });

  it("every row that can be n/a is n/a: no empty section or dangling heading", async () => {
    const r = await render(
      data("Testing", {
        checklistEvidence: evidenceFor("Testing", {
          [CMS]: "n/a",
          [FORMS]: "n/a",
          [UPDATES]: "n/a",
        }),
      }),
    );
    expect(r.html).toMatch(/>\s*MAINTENANCE CHECKS\s*</);
    expect(r.html).toMatch(/>\s*TESTING\s*</);
    expect(r.checks).toBe(10);
  });

  it("a whole Testing list of n/a drops the TESTING heading and intro with it", async () => {
    const allTestNa = Object.fromEntries(TESTING_CHECKLIST.map((i) => [i.field, "n/a" as const]));
    const r = await render(
      data("Testing", { checklistEvidence: evidenceFor("Testing", allTestNa) }),
    );
    expect(r.html).not.toMatch(/>\s*TESTING\s*</);
    expect(r.text).not.toContain("Testing includes checks");
    for (const label of TEST_LABELS) expect(r.html).not.toContain(label);
    for (const label of MAINT_LABELS) expect(r.html).toMatch(rowText(label));
    expect(r.checks).toBe(6);
  });

  it("a whole Maintenance list of n/a drops the MAINTENANCE CHECKS heading and intro", async () => {
    const allMaintNa = Object.fromEntries(
      MAINTENANCE_CHECKLIST.map((i) => [i.field, "n/a" as const]),
    );
    const r = await render(
      data("Maintenance", { checklistEvidence: evidenceFor("Maintenance", allMaintNa) }),
    );
    expect(r.html).not.toMatch(/>\s*MAINTENANCE CHECKS\s*</);
    expect(r.text).not.toContain("Includes checking the hosting");
    expect(r.html).toMatch(/>\s*COMPLETED ON\s*</);
    expect(r.checks).toBe(0);
    expect(r.html).not.toContain(CHECK);
  });
});
