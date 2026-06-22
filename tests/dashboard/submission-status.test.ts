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

  it("records marked-spam (with the row's siteId) only on a real transition to spam", async () => {
    const marked: string[] = [];
    const d = {
      getSubmissionById: async (id: string) => ({ id, siteId: "recSITE", status: "new" }) as never,
      setSubmissionStatusRow: async () => {},
      recordMarkedSpam: async (siteId: string) => {
        marked.push(siteId);
      },
    };
    const res = await setSubmissionStatus(d, "sub1", "spam");
    expect(res.status).toBe("updated");
    expect(marked).toEqual(["recSITE"]);
  });

  it("does not record marked-spam for a non-spam transition or a no-op", async () => {
    const marked: string[] = [];
    const recordMarkedSpam = async (siteId: string) => {
      marked.push(siteId);
    };
    await setSubmissionStatus(
      {
        getSubmissionById: async (id) => ({ id, siteId: "recSITE", status: "new" }) as never,
        setSubmissionStatusRow: async () => {},
        recordMarkedSpam,
      },
      "sub1",
      "read",
    );
    await setSubmissionStatus(
      {
        getSubmissionById: async (id) => ({ id, siteId: "recSITE", status: "spam" }) as never,
        setSubmissionStatusRow: async () => {},
        recordMarkedSpam,
      },
      "sub1",
      "spam", // already spam → no-op
    );
    expect(marked).toEqual([]);
  });
});
