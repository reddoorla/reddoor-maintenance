import { describe, it, expect, vi } from "vitest";
import { unapproveReport, type UnapproveDeps } from "../../src/dashboard/unapprove.js";
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
    approvedToSend: true,
    sentAt: null,
    approvedAt: "2026-10-08T15:11:12.000Z",
    approvedBy: "dashboard",
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

const NOW = new Date("2026-10-08T15:40:00.000Z");

function deps(row: ReportRow | null = reportRow()): UnapproveDeps {
  return {
    getReportById: vi.fn().mockResolvedValue(row),
    unapproveReportRow: vi.fn().mockResolvedValue(true),
    now: () => NOW,
  };
}

describe("unapproveReport", () => {
  it("unapproves an approved, unsent report with the audit stamp", async () => {
    const d = deps();
    expect(await unapproveReport(d, "recREP1")).toEqual({
      status: "unapproved",
      reportId: "recREP1",
    });
    expect(d.unapproveReportRow).toHaveBeenCalledWith("recREP1", NOW, "dashboard");
  });

  it("an override-approved report unapproves the same way", async () => {
    const d = deps(reportRow({ sendOverride: true, overrideReason: "client asked" }));
    expect((await unapproveReport(d, "recREP1")).status).toBe("unapproved");
  });

  it("returns not-found (no write) when the id resolves to no row", async () => {
    const d = deps(null);
    expect(await unapproveReport(d, "recNOPE")).toEqual({
      status: "not-found",
      reportId: "recNOPE",
    });
    expect(d.unapproveReportRow).not.toHaveBeenCalled();
  });

  it.each([
    ["already-sent", { sentAt: "2026-10-09T09:23:00Z" }],
    ["already-sent", { sentAt: "2026-10-09T09:23:00Z", approvedToSend: false }],
    ["sending", { sendStartedAt: "2026-10-09T16:07:03Z" }],
    ["withdrawn", { withdrawnAt: "2026-10-08T00:00:00Z" }],
    ["not-approved", { approvedToSend: false, approvedAt: null, approvedBy: null }],
  ] as const)("is a no-op (%s) for %o, and writes nothing", async (reason, over) => {
    const d = deps(reportRow(over));
    expect(await unapproveReport(d, "recREP1")).toEqual({
      status: "noop",
      reportId: "recREP1",
      reason,
    });
    expect(d.unapproveReportRow).not.toHaveBeenCalled();
  });

  it("a guarded write that matched nothing is named from a re-read (the send won the race)", async () => {
    const d: UnapproveDeps = {
      getReportById: vi
        .fn()
        .mockResolvedValueOnce(reportRow())
        .mockResolvedValueOnce(reportRow({ sentAt: "2026-10-09T09:23:05Z" })),
      unapproveReportRow: vi.fn().mockResolvedValue(false),
      now: () => NOW,
    };
    expect(await unapproveReport(d, "recREP1")).toEqual({
      status: "noop",
      reportId: "recREP1",
      reason: "already-sent",
    });
  });

  it("a miss a re-read cannot explain throws rather than claiming success", async () => {
    const d: UnapproveDeps = {
      getReportById: vi.fn().mockResolvedValue(reportRow()),
      unapproveReportRow: vi.fn().mockResolvedValue(false),
      now: () => NOW,
    };
    await expect(unapproveReport(d, "recREP1")).rejects.toThrow(/matched no row/);
  });
});
