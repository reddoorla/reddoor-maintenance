import { describe, it, expect, vi } from "vitest";
import {
  setSubmissionStatus,
  acknowledgeNotifyBounce,
  type SubmissionStatusDeps,
} from "../../src/dashboard/submission-status.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

function deps(over: Partial<SubmissionStatusDeps> = {}): SubmissionStatusDeps {
  return {
    getSubmissionById: vi
      .fn()
      .mockResolvedValue(makeSubmissionRow({ id: "recSUB", status: "new" })),
    setSubmissionStatusRow: vi.fn().mockResolvedValue(undefined),
    ackNotifyBounce: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe("setSubmissionStatus", () => {
  it("rejects an unknown status without reading", async () => {
    const d = deps();
    const r = await setSubmissionStatus(d, "recSUB", "bogus");
    expect(r.status).toBe("invalid");
    expect(d.getSubmissionById).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing row", async () => {
    const d = deps({ getSubmissionById: vi.fn().mockResolvedValue(null) });
    expect((await setSubmissionStatus(d, "nope", "read")).status).toBe("not-found");
  });

  it("is a no-op when already in the requested status", async () => {
    const d = deps({
      getSubmissionById: vi.fn().mockResolvedValue(makeSubmissionRow({ status: "read" })),
    });
    const r = await setSubmissionStatus(d, "recSUB", "read");
    expect(r.status).toBe("noop");
    expect(d.setSubmissionStatusRow).not.toHaveBeenCalled();
  });

  it("updates and writes on a real transition to spam", async () => {
    const d = deps();
    const r = await setSubmissionStatus(d, "recSUB", "spam");
    expect(r).toEqual({ status: "updated", submissionId: "recSUB", newStatus: "spam" });
    expect(d.setSubmissionStatusRow).toHaveBeenCalledWith("recSUB", "spam");
    // No spam counter is incremented here — the "marked spam" metric is derived from
    // the rows themselves (COUNT(*) WHERE status='spam') so it can't double-count.
  });
});

/**
 * #783. The operator's exit from a bounce alarm that is not a dead address.
 *
 * Before this the only ways out were fourteen days of aging or a hand-written
 * UPDATE against the production `submissions` table — which is what actually
 * happened for Espada on 2026-09-14.
 */
describe("acknowledgeNotifyBounce", () => {
  const bounced = () =>
    makeSubmissionRow({ id: "recSUB", notifyStatus: "bounced", bounceType: "Transient" });

  it("acks a bounced row and reports it", async () => {
    const d = deps({ getSubmissionById: vi.fn().mockResolvedValue(bounced()) });
    const r = await acknowledgeNotifyBounce(d, "recSUB");
    expect(r).toEqual({ status: "acked", submissionId: "recSUB" });
    expect(d.ackNotifyBounce).toHaveBeenCalledWith("recSUB");
  });

  it("returns not-found for a missing row and never writes", async () => {
    const d = deps({ getSubmissionById: vi.fn().mockResolvedValue(null) });
    const r = await acknowledgeNotifyBounce(d, "nope");
    expect(r).toEqual({ status: "not-found", submissionId: "nope" });
    expect(d.ackNotifyBounce).not.toHaveBeenCalled();
  });

  it("refuses a row that never bounced — there is nothing to acknowledge", async () => {
    // Guards the gesture against becoming a general-purpose "hide this row".
    const d = deps({
      getSubmissionById: vi.fn().mockResolvedValue(makeSubmissionRow({ notifyStatus: "sent" })),
    });
    const r = await acknowledgeNotifyBounce(d, "recSUB");
    expect(r).toEqual({ status: "noop", submissionId: "recSUB", reason: "not-bounced" });
    expect(d.ackNotifyBounce).not.toHaveBeenCalled();
  });

  it("reports an already-acked row as a no-op rather than a second write", async () => {
    const d = deps({
      getSubmissionById: vi.fn().mockResolvedValue(bounced()),
      ackNotifyBounce: vi.fn().mockResolvedValue(false),
    });
    const r = await acknowledgeNotifyBounce(d, "recSUB");
    expect(r).toEqual({ status: "noop", submissionId: "recSUB", reason: "already-acked" });
  });

  it("acks a PERMANENT bounce too — the operator may have fixed the address", async () => {
    // The grant side: the ack means "I looked at this", so the one case most
    // worth closing after a real fix must not be refused.
    const d = deps({
      getSubmissionById: vi
        .fn()
        .mockResolvedValue(makeSubmissionRow({ notifyStatus: "bounced", bounceType: "Permanent" })),
    });
    expect((await acknowledgeNotifyBounce(d, "recSUB")).status).toBe("acked");
  });
});
