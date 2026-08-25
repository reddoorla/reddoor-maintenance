import type { ReportRow } from "../reports/airtable/reports.js";

/**
 * "Refresh preview" for one report, from the console (#539 Phase 4).
 *
 * Dispatches `report-rerender.yml` rather than rendering inline: the render
 * needs sharp, a native module no Netlify function bundles. The operator's
 * ruling was that latency is worth accuracy, so the preview is regenerated where
 * the real send renders rather than approximated to fit in a request.
 *
 * The sent-report guard is DUPLICATED here rather than left to the workflow, on
 * purpose: refusing in the handler gives the operator an answer immediately
 * instead of a red run about two minutes later saying the same thing. The CLI
 * keeps its own guard because it is also runnable by hand.
 */
export type TriggerRerenderDeps = {
  getReport: (reportId: string) => Promise<ReportRow | null>;
  /** Fire the workflow with these `workflow_dispatch` inputs. */
  dispatch: (inputs: Record<string, string>) => Promise<void>;
};

export type TriggerRerenderResult =
  | { status: "dispatched"; reportId: string }
  | { status: "already-sent"; reportId: string }
  | { status: "not-found"; reportId: string }
  | { status: "failed"; reportId: string; error: string };

export async function triggerReportRerender(
  deps: TriggerRerenderDeps,
  reportId: string,
): Promise<TriggerRerenderResult> {
  const report = await deps.getReport(reportId);
  if (!report) return { status: "not-found", reportId };
  // A sent report's stored body is the record of what the client received.
  if (report.sentAt !== null) return { status: "already-sent", reportId };
  try {
    await deps.dispatch({ report_id: reportId });
    return { status: "dispatched", reportId };
  } catch (e) {
    // Never throw: a dispatch failure (missing actions:write, no such workflow)
    // becomes a clean status the endpoint maps to a response, not a 500.
    return { status: "failed", reportId, error: e instanceof Error ? e.message : String(e) };
  }
}
