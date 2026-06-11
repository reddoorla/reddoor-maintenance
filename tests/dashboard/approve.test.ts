import { describe, it, expect, vi } from "vitest";
import { approveReport, type ApproveDeps } from "../../src/dashboard/approve.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
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
    period: null,
    ...over,
  };
}

function deps(over: Partial<ApproveDeps> = {}): ApproveDeps {
  return {
    getReportById: vi.fn().mockResolvedValue(reportRow()),
    approveReportRow: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-06-11T15:30:00.000Z"),
    ...over,
  };
}

describe("approveReport — happy path", () => {
  it("approves a Draft-ready, un-approved, un-sent report with the audit stamp", async () => {
    const d = deps();
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "approved", reportId: "recREP1" });
    expect(d.approveReportRow).toHaveBeenCalledWith(
      "recREP1",
      new Date("2026-06-11T15:30:00.000Z"),
      "dashboard",
    );
  });
});

describe("approveReport — idempotency and guards", () => {
  it("is a no-op when the report is already approved (never re-writes, never un-approves)", async () => {
    const d = deps({
      getReportById: vi.fn().mockResolvedValue(reportRow({ approvedToSend: true })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "noop", reportId: "recREP1", reason: "already-approved" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("is a no-op when the report is already sent (sentAt set), even if somehow un-approved", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ approvedToSend: false, sentAt: "2026-06-02T09:00:00Z" })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "noop", reportId: "recREP1", reason: "already-sent" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("returns not-found (no write) when the id resolves to no row", async () => {
    const d = deps({ getReportById: vi.fn().mockResolvedValue(null) });
    const res = await approveReport(d, "recNOPE");
    expect(res).toEqual({ status: "not-found", reportId: "recNOPE" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("is a no-op when the row is not draft-ready (a hand-crafted POST cannot pre-approve it)", async () => {
    // The spec gate is draftReady ∧ ¬approved ∧ ¬sent. A not-yet-draft-ready row
    // (not sent, not approved) must not be approvable via a hand-crafted authed POST.
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ draftReady: false, approvedToSend: false, sentAt: null })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "noop", reportId: "recREP1", reason: "not-draft-ready" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("checks sent before approved so an approved-and-sent row reports already-sent", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ approvedToSend: true, sentAt: "2026-06-02T09:00:00Z" })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res.status).toBe("noop");
    expect((res as { reason: string }).reason).toBe("already-sent");
  });
});
