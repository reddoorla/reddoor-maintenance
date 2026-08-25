import { describe, it, expect } from "vitest";
import {
  setReportCommentary,
  COMMENTARY_MAX_LEN,
  type ReportCommentaryDeps,
} from "../../src/dashboard/report-commentary.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

/**
 * Report review, #539 Phase 4: commentary is the one part of a client report an
 * operator writes by hand, and it is edited in Airtable today.
 *
 * The gate is SENT, not approved — an operator who approves and then spots a
 * typo can still fix it, but once the email has gone out the stored row must
 * keep matching what the client actually read. That is an operator ruling, not
 * an inference from the approve flow.
 */
/** Local ReportRow factory, matching the ones in approve.test.ts and
 *  render.test.ts. Kept local rather than shared for the same reason those two
 *  are: extracting a third copy into `_helpers` is a refactor of those files,
 *  not part of this change. */
function makeReportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    completedOn: "2026-09-01",
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: false,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    period: null,
    checklist: {},
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    ...over,
  };
}

function harness(over: Partial<ReportCommentaryDeps> = {}) {
  const writes: Array<{ id: string; text: string }> = [];
  const deps: ReportCommentaryDeps = {
    getReportById: async () => makeReportRow({ id: "recREP", draftReady: true }),
    updateCommentary: async (id, text) => {
      writes.push({ id, text });
    },
    ...over,
  };
  return { deps, writes };
}

describe("setReportCommentary", () => {
  it("writes commentary on a draft report", async () => {
    const { deps, writes } = harness();
    const r = await setReportCommentary(deps, "recREP", "  Traffic is up this month.  ");
    expect(r.status).toBe("updated");
    expect(writes).toEqual([{ id: "recREP", text: "Traffic is up this month." }]);
  });

  it("still writes AFTER approval — approving is not the lock", async () => {
    // Deliberate: approval means "this is ready to go", and a typo spotted
    // between approving and the cron's send should still be fixable.
    const { deps, writes } = harness({
      getReportById: async () =>
        makeReportRow({ id: "recREP", draftReady: true, approvedToSend: true }),
    });
    expect((await setReportCommentary(deps, "recREP", "fixed")).status).toBe("updated");
    expect(writes).toHaveLength(1);
  });

  it("REFUSES once the report has been sent, and writes nothing", async () => {
    // The stored report is the record of what the client received. Editing it
    // after the fact would leave the row describing an email nobody was sent.
    const { deps, writes } = harness({
      getReportById: async () =>
        makeReportRow({
          id: "recREP",
          draftReady: true,
          approvedToSend: true,
          sentAt: "2026-08-20T09:00:00.000Z",
        }),
    });
    const r = await setReportCommentary(deps, "recREP", "too late");
    expect(r.status).toBe("locked");
    expect(writes).toEqual([]);
  });

  it("allows clearing commentary back to empty", async () => {
    const { deps, writes } = harness();
    expect((await setReportCommentary(deps, "recREP", "   ")).status).toBe("updated");
    expect(writes[0]!.text).toBe("");
  });

  it("refuses an over-long value BEFORE any read", async () => {
    // Same shape as the site editor's bad-field guard: a hand-crafted authed
    // POST must not be able to push an unbounded string at Airtable, and must
    // not cost a read to find that out.
    let read = false;
    const { deps } = harness({
      getReportById: async () => {
        read = true;
        return makeReportRow({ id: "recREP", draftReady: true });
      },
    });
    const r = await setReportCommentary(deps, "recREP", "x".repeat(COMMENTARY_MAX_LEN + 1));
    expect(r.status).toBe("invalid");
    expect(read).toBe(false);
  });

  it("accepts a value exactly at the limit (the boundary is not off by one)", async () => {
    const { deps } = harness();
    const r = await setReportCommentary(deps, "recREP", "x".repeat(COMMENTARY_MAX_LEN));
    expect(r.status).toBe("updated");
  });

  it("returns not-found for an unknown report id", async () => {
    const { deps } = harness({ getReportById: async () => null });
    expect((await setReportCommentary(deps, "recNOPE", "hi")).status).toBe("not-found");
  });
});
