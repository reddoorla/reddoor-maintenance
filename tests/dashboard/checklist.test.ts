import { describe, it, expect, vi } from "vitest";
import { setChecklistItem, type ChecklistItemDeps } from "../../src/dashboard/checklist.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../../src/reports/checklist.js";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";

const pass = (): EvidenceRecord => ({
  result: "pass",
  checkedAt: "2026-07-06T00:00:00.000Z",
  note: "",
});
const maintAllPass = (): Record<string, EvidenceRecord> =>
  Object.fromEntries(
    [
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
    ].map((f) => [f, pass()]),
  );
/** All 13 gating fields (maintenance + testing) pass — the full Testing gate. */
const testingAllPass = (): Record<string, EvidenceRecord> =>
  Object.fromEntries(
    [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, pass()]),
  );

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
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
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

  it("reports complete=false when the health gate is not clear (a gating item is unmeasured)", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Maintenance", autoEvidence: {} })),
    });
    const r = await setChecklistItem(d, "recREP1", "Maint: Deploy & Function Health", true);
    expect(r).toMatchObject({ status: "ok", complete: false });
    // The box is still written (advisory record) even though it no longer drives the gate.
    expect(d.setReportChecklistItem).toHaveBeenCalledWith(
      "recREP1",
      "Maint: Deploy & Function Health",
      true,
    );
  });

  it("reports complete=true when every gating item's evidence is pass", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Maintenance", autoEvidence: maintAllPass() })),
    });
    const r = await setChecklistItem(d, "recREP1", "Maint: Security Updates", true);
    expect(r).toMatchObject({ status: "ok", complete: true });
  });

  it("completes a Testing report only when all 13 (maintenance + testing) items' evidence is pass", async () => {
    // A Testing pass also does the maintenance checks; the gate requires all 13 gating fields.
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Testing", autoEvidence: testingAllPass() })),
    });
    const r = await setChecklistItem(d, "recREP1", "Test: Interactions & Animations", true);
    expect(r.status).toBe("ok");
    expect((r as { complete: boolean }).complete).toBe(true);
  });

  it("a Testing report is NOT complete when one gating item's evidence is missing", async () => {
    // All 13 gating fields pass except one missing evidence record → incomplete.
    const missingOne = testingAllPass();
    delete missingOne["Test: Interactions & Animations"];
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ reportType: "Testing", autoEvidence: missingOne })),
    });
    const r = await setChecklistItem(d, "recREP1", "Test: Interactions & Animations", true);
    expect(r.status).toBe("ok");
    expect((r as { complete: boolean }).complete).toBe(false);
  });
});
