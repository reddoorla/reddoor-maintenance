import { describe, it, expect, vi } from "vitest";
import { withdrawReport, type WithdrawDeps } from "../../src/dashboard/withdraw.js";
import type { ReportRow } from "../../src/reports/report-fields.js";

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: null,
    periodEnd: null,
    completedOn: null,
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
    withdrawnAt: null,
    withdrawnBy: null,
    sendStartedAt: null,
    ...over,
  };
}

const NOW = new Date("2026-09-30T15:30:00.000Z");

function deps(row: ReportRow | null = reportRow()): WithdrawDeps {
  return {
    getReportById: vi.fn().mockResolvedValue(row),
    withdrawReportRow: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe("withdrawReport", () => {
  it("withdraws a pending draft with the audit stamp", async () => {
    const d = deps();
    const res = await withdrawReport(d, "recREP1");
    expect(res).toEqual({ status: "withdrawn", reportId: "recREP1" });
    expect(d.withdrawReportRow).toHaveBeenCalledWith("recREP1", NOW, "dashboard");
  });

  it("returns not-found (no write) when the id resolves to no row", async () => {
    const d = deps(null);
    expect(await withdrawReport(d, "recNOPE")).toEqual({
      status: "not-found",
      reportId: "recNOPE",
    });
    expect(d.withdrawReportRow).not.toHaveBeenCalled();
  });

  it.each([
    ["already-sent", { sentAt: "2026-09-02T09:00:00Z" }],
    ["already-sent", { sentAt: "2026-09-02T09:00:00Z", approvedToSend: true }],
    ["already-approved", { approvedToSend: true }],
    ["already-withdrawn", { withdrawnAt: "2026-09-29T00:00:00Z" }],
    ["not-draft-ready", { draftReady: false }],
  ] as const)("is a no-op (%s) for %o, and writes nothing", async (reason, over) => {
    const d = deps(reportRow(over));
    expect(await withdrawReport(d, "recREP1")).toEqual({
      status: "noop",
      reportId: "recREP1",
      reason,
    });
    expect(d.withdrawReportRow).not.toHaveBeenCalled();
  });

  it("a guarded write that matched nothing is named from a re-read (an approve won the race)", async () => {
    const d: WithdrawDeps = {
      getReportById: vi
        .fn()
        .mockResolvedValueOnce(reportRow())
        .mockResolvedValueOnce(reportRow({ approvedToSend: true })),
      withdrawReportRow: vi.fn().mockResolvedValue(false),
      now: () => NOW,
    };
    expect(await withdrawReport(d, "recREP1")).toEqual({
      status: "noop",
      reportId: "recREP1",
      reason: "already-approved",
    });
  });
});
