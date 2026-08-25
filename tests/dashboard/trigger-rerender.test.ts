import { describe, it, expect } from "vitest";
import {
  triggerReportRerender,
  type TriggerRerenderDeps,
} from "../../src/dashboard/trigger-rerender.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

/**
 * The console's "refresh preview" action (#539 Phase 4). Dispatches the
 * report-rerender workflow, because rendering needs sharp and no Netlify
 * function bundles it.
 *
 * The guards here mirror the CLI's on purpose: refusing in the handler means an
 * operator gets an immediate answer instead of waiting ~2 minutes for a red run
 * to tell them the same thing.
 */
function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "ACME-M",
    reportType: "Maintenance",
    sentAt: null,
    ...over,
  } as ReportRow;
}

function deps(over: Partial<TriggerRerenderDeps> = {}): TriggerRerenderDeps {
  return {
    getReport: async () => report(),
    dispatch: async () => {},
    ...over,
  };
}

describe("triggerReportRerender", () => {
  it("dispatches with the report id as a workflow input", async () => {
    const seen: Array<Record<string, string>> = [];
    const r = await triggerReportRerender(
      deps({ dispatch: async (inputs) => void seen.push(inputs) }),
      "recREP",
    );
    expect(r.status).toBe("dispatched");
    expect(seen).toEqual([{ report_id: "recREP" }]);
  });

  it("REFUSES a sent report without dispatching", async () => {
    let dispatched = false;
    const r = await triggerReportRerender(
      deps({
        getReport: async () => report({ sentAt: "2026-08-20T09:00:00.000Z" }),
        dispatch: async () => void (dispatched = true),
      }),
      "recREP",
    );
    expect(r.status).toBe("already-sent");
    expect(dispatched).toBe(false);
  });

  it("returns not-found for an unknown report", async () => {
    expect(
      (await triggerReportRerender(deps({ getReport: async () => null }), "recX")).status,
    ).toBe("not-found");
  });

  it("maps a dispatch failure to a clean status, never a throw", async () => {
    const r = await triggerReportRerender(
      deps({
        dispatch: async () => {
          throw new Error("403 missing actions:write");
        },
      }),
      "recREP",
    );
    expect(r.status).toBe("failed");
    expect(r).toMatchObject({ error: expect.stringContaining("403") });
  });
});
