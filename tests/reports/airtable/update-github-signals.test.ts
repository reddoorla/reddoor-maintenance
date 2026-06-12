import { describe, it, expect } from "vitest";
import { updateGitHubSignals } from "../../../src/reports/airtable/websites.js";

/** Minimal fake matching the `base(table).update([{id,fields}])` surface used by the writers. */
function fakeBase() {
  const calls: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const base = (() => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      calls.push(...recs);
      return recs;
    },
  })) as unknown as Parameters<typeof updateGitHubSignals>[0];
  return { base, calls };
}

describe("updateGitHubSignals", () => {
  it("writes all four fields when every value is present", async () => {
    const { base, calls } = fakeBase();
    await updateGitHubSignals(base, "rec1", {
      renovateFailingCis: 2,
      ciState: "failing",
      lastCommitAt: "2026-06-01T00:00:00Z",
      sweptAt: "2026-06-12T08:30:00Z",
    });
    expect(calls[0]!.id).toBe("rec1");
    expect(calls[0]!.fields).toMatchObject({
      "Renovate Failing CIs": 2,
      "Default Branch CI": "failing",
      "Last Commit At": "2026-06-01T00:00:00Z",
      "GitHub Signals At": "2026-06-12T08:30:00Z",
    });
  });

  it("omits a null lastCommitAt rather than clobbering a prior value", async () => {
    const { base, calls } = fakeBase();
    await updateGitHubSignals(base, "rec1", {
      renovateFailingCis: 0,
      ciState: "none",
      lastCommitAt: null,
      sweptAt: "2026-06-12T08:30:00Z",
    });
    expect("Last Commit At" in calls[0]!.fields).toBe(false);
    expect(calls[0]!.fields).toMatchObject({
      "Renovate Failing CIs": 0,
      "Default Branch CI": "none",
    });
  });
});
