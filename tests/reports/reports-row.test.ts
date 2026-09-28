import { describe, it, expect } from "vitest";
import { createReportDraft } from "../../src/reports/create-report.js";
import { mapRow } from "../../src/reports/airtable/reports.js";

function capturingCreate(captured: { fields?: Record<string, unknown> }) {
  return async (rec: { id: string; fields: Record<string, unknown> }) => {
    captured.fields = rec.fields;
    return mapRow(rec);
  };
}

const baseInput = {
  reportId: "X — Maintenance — 2026-06-02",
  siteId: "recSITE",
  reportType: "Maintenance" as const,
  periodStart: new Date("2026-05-03T00:00:00Z"),
  periodEnd: new Date("2026-06-02T00:00:00Z"),
  completedOn: new Date("2026-06-02T00:00:00Z"),
  lighthouse: { performance: 90, accessibility: 95, bestPractices: 80, seo: 92 },
  lastTestedDate: null,
};

describe("createReportDraft search fields", () => {
  it("writes the checkbox true and the position when found on page 1", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    const row = await createReportDraft(
      { ...baseInput, searchFoundPage1: true, searchPosition: 2 },
      { create: capturingCreate(cap), mintId: () => "report_NEW" },
    );
    expect(cap.fields!["Search found page 1"]).toBe(true);
    expect(cap.fields!["Search position"]).toBe(2);
    expect(row.searchFoundPage1).toBe(true);
    expect(row.searchPosition).toBe(2);
  });

  it("writes the checkbox false and omits position when checked but not on page 1", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    await createReportDraft(
      { ...baseInput, searchFoundPage1: false },
      { create: capturingCreate(cap), mintId: () => "report_NEW" },
    );
    expect(cap.fields!["Search found page 1"]).toBe(false);
    expect("Search position" in cap.fields!).toBe(false);
  });

  it("omits both fields when the check did not run", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    await createReportDraft(baseInput, {
      create: capturingCreate(cap),
      mintId: () => "report_NEW",
    });
    expect("Search found page 1" in cap.fields!).toBe(false);
    expect("Search position" in cap.fields!).toBe(false);
  });
});
