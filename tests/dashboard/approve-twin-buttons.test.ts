import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import { MAINTENANCE_CHECKLIST } from "../../src/reports/checklist.js";

/**
 * A pending report is rendered TWICE — once in the pending list, once in the
 * reports history — so one report id owns two Approve buttons. Every handler that
 * changes approve state has to reach both.
 *
 * These are structural assertions over the served script, not executed behaviour:
 * the page's handlers live inside a template literal and the suite runs
 * `environment: "node"` with no DOM, so nothing can click a button here. What CAN
 * be pinned honestly is the precondition (two buttons really do share an id) and
 * the shape of the code that acts on them — a singular `document.querySelector`
 * for an approve button is the defect, by construction.
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

function script(html: string): string {
  return /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
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

describe("approve state changes reach every twin", () => {
  const s = script(render([pendingReport()]));

  it("selects approve buttons by id in the PLURAL", () => {
    expect(s).toContain("function approveButtonsFor(id)");
    expect(s).toMatch(/approveButtonsFor[\s\S]*querySelectorAll\('button\.approve\[data-report-id/);
  });

  it("no handler looks up an approve button with a singular querySelector", () => {
    // This is the actual defect: the override handler used `document.querySelector`,
    // which updates the first match and leaves the second reading "Approve".
    expect(s).not.toMatch(/querySelector\(\s*\n?\s*'button\.approve/);
    expect(s).not.toMatch(/querySelector\('button\.approve/);
  });

  it("the success, failure and rejection paths all act on the twin list", () => {
    // Not just the happy path: leaving a twin disabled on failure strands it
    // unusable, which is worse than the stale label.
    const approve = s.slice(
      s.indexOf('querySelectorAll("button.approve")'),
      s.indexOf('querySelectorAll("button.override-toggle")'),
    );
    expect(approve).toContain("const twins = approveButtonsFor(b.dataset.reportId)");
    // Every place the old code touched `b.disabled` / `b.textContent` now maps
    // over twins; nothing should assign those on the single clicked button.
    expect(approve).not.toMatch(/\bb\.disabled\s*=/);
    expect(approve).not.toMatch(/\bb\.textContent\s*=/);
    // Four paths touch button state: the initial disable, success, !res.ok, and
    // the network-rejection catch. All four map over twins.
    expect(approve.match(/twins\.forEach/g) ?? []).toHaveLength(4);
  });

  it("the override handler relabels every twin", () => {
    const override = s.slice(s.indexOf('querySelectorAll("button.override-submit")'));
    expect(override).toMatch(/approveButtonsFor\(b\.dataset\.reportId\)\.forEach/);
    expect(override).toContain('"Overridden"');
  });
});
