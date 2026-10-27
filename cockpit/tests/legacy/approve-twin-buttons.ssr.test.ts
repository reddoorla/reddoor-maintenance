import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "./render.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";
import { MAINTENANCE_CHECKLIST } from "../../../src/reports/checklist.js";

/**
 * A pending report is rendered TWICE — once in the pending list, once in the
 * reports history — so one report id owns two Approve buttons. Every handler that
 * changes approve state has to reach both.
 *
 * This file pins the precondition, in the served markup: two buttons really do
 * share an id. That both relabel when either is clicked is executed in the DOM
 * tests (cockpit/tests/site/site.dom.test.ts), since the cockpit's port (#582).
 */

const COMPLETE = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));

function pendingReport(over: Partial<ReportRow> = {}): ReportRow {
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
    checklist: { ...COMPLETE },
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    sendStartedAt: null,
    ...over,
  } as ReportRow;
}

function render(reports: ReportRow[]): string {
  return renderSiteDashboardHtml(
    makeWebsiteRow({ id: "recSITE", name: "Acme" }),
    reports,
    [],
    null,
    new Date("2026-06-05T12:00:00Z"),
    null,
  );
}

function approveButtons(html: string, id: string): string[] {
  const re = new RegExp(`<button[^>]*class="[^"]*\\bapprove\\b[^"]*"[^>]*>`, "g");
  return (html.match(re) ?? []).filter((b) => b.includes(`data-report-id="${id}"`));
}

describe("one report id, two approve buttons", () => {
  it("a pending report really is rendered twice (the precondition)", () => {
    // If this ever drops to 1 the twin handling below is dead weight, and if it
    // silently became 0 the rest of this file would pass vacuously.
    expect(approveButtons(render([pendingReport()]), "recREP1")).toHaveLength(2);
  });

  it("a SENT report renders no approve button at all (the probe is not miscounting)", () => {
    const sent = pendingReport({ approvedToSend: true, sentAt: "2026-06-02T09:00:00Z" });
    expect(approveButtons(render([sent]), "recREP1")).toHaveLength(0);
  });
});

// "approve state changes reach every twin": the twins share one state per
// report in the Svelte port (cockpit/src/lib/site/report-ui.svelte.ts), and the
// DOM tests click each twin and assert both relabel
// (cockpit/tests/site/site.dom.test.ts, the Approve twins).
