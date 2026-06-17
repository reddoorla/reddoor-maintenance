import { describe, it, expect, vi } from "vitest";
import { setChecklistItem, type ChecklistItemDeps } from "../../src/dashboard/checklist.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../../src/reports/checklist.js";

/** All 6 maintenance cells true. */
const COMPLETE_MAINTENANCE = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: null,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    completedOn: "2026-06-01",
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    ...over,
  };
}

function deps(over: Partial<ChecklistItemDeps> = {}): ChecklistItemDeps {
  return {
    getReportById: vi.fn().mockResolvedValue(reportRow()),
    setReportChecklistItem: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("setChecklistItem", () => {
  it("rejects an unknown field without reading or writing (no arbitrary Airtable columns)", async () => {
    const d = deps();
    const r = await setChecklistItem(d, "recREP1", "Maint: Drop Database", true);
    expect(r).toEqual({ status: "bad-field", reportId: "recREP1", field: "Maint: Drop Database" });
    expect(d.getReportById).not.toHaveBeenCalled();
    expect(d.setReportChecklistItem).not.toHaveBeenCalled();
  });

  it("returns not-found (no write) when the id resolves to no row", async () => {
    const d = deps({ getReportById: vi.fn().mockResolvedValue(null) });
    const r = await setChecklistItem(d, "recNOPE", "Maint: Deploy & Function Health", true);
    expect(r).toEqual({ status: "not-found", reportId: "recNOPE" });
    expect(d.setReportChecklistItem).not.toHaveBeenCalled();
  });

  it("writes a known field and reports complete=false while other items are still unchecked", async () => {
    // Only the field we're flipping is true; the other 5 maintenance items remain unchecked.
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Maintenance", checklist: {} })),
    });
    const r = await setChecklistItem(d, "recREP1", "Maint: Deploy & Function Health", true);
    expect(d.setReportChecklistItem).toHaveBeenCalledWith(
      "recREP1",
      "Maint: Deploy & Function Health",
      true,
    );
    expect(r).toEqual({
      status: "ok",
      reportId: "recREP1",
      field: "Maint: Deploy & Function Health",
      value: true,
      complete: false,
    });
  });

  it("reports complete=true when the flip completes the set", async () => {
    // Five maintenance items already checked; flipping the sixth completes the checklist.
    const fiveChecked = { ...COMPLETE_MAINTENANCE, "Maint: Security Updates": false };
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Maintenance", checklist: fiveChecked })),
    });
    const r = await setChecklistItem(d, "recREP1", "Maint: Security Updates", true);
    expect(d.setReportChecklistItem).toHaveBeenCalledWith(
      "recREP1",
      "Maint: Security Updates",
      true,
    );
    expect(r).toEqual({
      status: "ok",
      reportId: "recREP1",
      field: "Maint: Security Updates",
      value: true,
      complete: true,
    });
  });

  it("reports complete=false after un-checking an item (value reflected in post-update state)", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(
          reportRow({ reportType: "Maintenance", checklist: COMPLETE_MAINTENANCE }),
        ),
    });
    const r = await setChecklistItem(d, "recREP1", "Maint: Deploy & Function Health", false);
    expect(d.setReportChecklistItem).toHaveBeenCalledWith(
      "recREP1",
      "Maint: Deploy & Function Health",
      false,
    );
    expect(r).toEqual({
      status: "ok",
      reportId: "recREP1",
      field: "Maint: Deploy & Function Health",
      value: false,
      complete: false,
    });
  });

  it("completes a Testing report only when all 13 (maintenance + testing) items are checked", async () => {
    // A Testing pass also does the maintenance checks; the email shows both lists, so the
    // gate requires both. Twelve already checked, Interactions left → flipping it completes.
    const nearlyComplete: Record<string, boolean> = Object.fromEntries(
      [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, true]),
    );
    nearlyComplete["Test: Interactions & Animations"] = false;
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Testing", checklist: nearlyComplete })),
    });
    const r = await setChecklistItem(d, "recREP1", "Test: Interactions & Animations", true);
    expect(r.status).toBe("ok");
    expect((r as { complete: boolean }).complete).toBe(true);
  });

  it("a Testing report is NOT complete on the testing items alone (maintenance items gate it too)", async () => {
    // All 7 testing items checked but the maintenance items still false → incomplete.
    const onlyTesting: Record<string, boolean> = Object.fromEntries(
      TESTING_CHECKLIST.map((i) => [i.field, true]),
    );
    onlyTesting["Test: Interactions & Animations"] = false;
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Testing", checklist: onlyTesting })),
    });
    const r = await setChecklistItem(d, "recREP1", "Test: Interactions & Animations", true);
    expect(r.status).toBe("ok");
    expect((r as { complete: boolean }).complete).toBe(false);
  });
});
