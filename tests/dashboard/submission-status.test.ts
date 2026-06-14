import { describe, it, expect, vi } from "vitest";
import {
  setSubmissionStatus,
  type SubmissionStatusDeps,
} from "../../src/dashboard/submission-status.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

function deps(over: Partial<SubmissionStatusDeps> = {}): SubmissionStatusDeps {
  return {
    getSubmissionById: vi
      .fn()
      .mockResolvedValue(makeSubmissionRow({ id: "recSUB", status: "new" })),
    setSubmissionStatusRow: vi.fn().mockResolvedValue(undefined),
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

  it("updates and writes on a real transition", async () => {
    const d = deps();
    const r = await setSubmissionStatus(d, "recSUB", "archived");
    expect(r).toEqual({ status: "updated", submissionId: "recSUB", newStatus: "archived" });
    expect(d.setSubmissionStatusRow).toHaveBeenCalledWith("recSUB", "archived");
  });
});
