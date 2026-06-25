import { describe, it, expect } from "vitest";
import {
  refreshFleetState,
  summarizeFleetRunStatus,
  FLEET_REFRESH_WORKFLOWS,
  type RefreshFleetDeps,
} from "../../src/dashboard/refresh-fleet.js";
import type { WorkflowRun } from "../../src/github/gh-rest.js";

describe("refreshFleetState", () => {
  it("dispatches every fleet workflow and reports them all dispatched", async () => {
    const calls: string[] = [];
    const deps: RefreshFleetDeps = {
      dispatch: async (wf) => {
        calls.push(wf);
      },
    };
    const r = await refreshFleetState(deps);
    expect(calls).toEqual([...FLEET_REFRESH_WORKFLOWS]);
    expect(r.dispatched).toEqual([...FLEET_REFRESH_WORKFLOWS]);
    expect(r.failed).toEqual([]);
  });

  it("isolates a single failure (still dispatches the others, reports partial)", async () => {
    const deps: RefreshFleetDeps = {
      dispatch: async (wf) => {
        if (wf === "fleet-security.yml") throw new Error("403 no actions:write");
      },
    };
    const r = await refreshFleetState(deps);
    expect(r.dispatched).toEqual(["fleet-lighthouse.yml"]);
    expect(r.failed).toEqual([{ workflow: "fleet-security.yml", error: "403 no actions:write" }]);
  });

  it("reports both failed when every dispatch throws (never throws itself)", async () => {
    const deps: RefreshFleetDeps = {
      dispatch: async () => {
        throw new Error("boom");
      },
    };
    const r = await refreshFleetState(deps);
    expect(r.dispatched).toEqual([]);
    expect(r.failed.map((f) => f.workflow)).toEqual([...FLEET_REFRESH_WORKFLOWS]);
  });
});

function run(over: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 1,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-06-24T21:28:09Z",
    htmlUrl: "https://github.com/reddoorla/x/actions/runs/1",
    ...over,
  };
}

describe("summarizeFleetRunStatus", () => {
  it("reports 'starting' (not done) for a workflow with no runs yet", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [] },
      { workflow: "fleet-lighthouse.yml", runs: [] },
    ]);
    expect(s.perWorkflow).toEqual([
      { workflow: "fleet-security.yml", state: "starting", url: null, step: null },
      { workflow: "fleet-lighthouse.yml", state: "starting", url: null, step: null },
    ]);
    expect(s.allDone).toBe(false);
  });

  it("is not done while one run is still in_progress", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({ conclusion: "success" })] },
      {
        workflow: "fleet-lighthouse.yml",
        runs: [run({ status: "in_progress", conclusion: null })],
      },
    ]);
    expect(s.allDone).toBe(false);
    expect(s.perWorkflow[1]!.state).toBe("in_progress");
  });

  it("is done + all-success when both completed successfully", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({})] },
      { workflow: "fleet-lighthouse.yml", runs: [run({})] },
    ]);
    expect(s.allDone).toBe(true);
    expect(s.anySuccess).toBe(true);
    expect(s.anyFailure).toBe(false);
  });

  it("flags anyFailure for failure / cancelled / timed_out conclusions", () => {
    for (const c of ["failure", "cancelled", "timed_out"]) {
      const s = summarizeFleetRunStatus([
        { workflow: "fleet-security.yml", runs: [run({ conclusion: c })] },
        { workflow: "fleet-lighthouse.yml", runs: [run({ conclusion: "success" })] },
      ]);
      expect(s.allDone).toBe(true);
      expect(s.anyFailure).toBe(true);
      expect(s.perWorkflow[0]!.state).toBe(c);
    }
  });

  it("treats a completed run with an odd conclusion as a (terminal) failure", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({ conclusion: "action_required" })] },
      { workflow: "fleet-lighthouse.yml", runs: [run({ conclusion: "success" })] },
    ]);
    expect(s.allDone).toBe(true);
    expect(s.anyFailure).toBe(true);
    expect(s.perWorkflow[0]!.state).toBe("failure");
  });

  it("maps non-completed, non-in_progress runs (queued/requested/waiting) to 'queued'", () => {
    for (const status of ["queued", "requested", "waiting"]) {
      const s = summarizeFleetRunStatus([
        { workflow: "fleet-security.yml", runs: [run({ status, conclusion: null })] },
        { workflow: "fleet-lighthouse.yml", runs: [run({})] },
      ]);
      expect(s.perWorkflow[0]!.state).toBe("queued");
      expect(s.allDone).toBe(false);
    }
  });

  it("includes a step field (null) on every perWorkflow entry — endpoint fills it for in-progress runs", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({})] },
      { workflow: "fleet-lighthouse.yml", runs: [] },
    ]);
    expect(s.perWorkflow.every((w) => w.step === null)).toBe(true);
  });

  it("uses the newest (first) run and carries its url", () => {
    const s = summarizeFleetRunStatus([
      {
        workflow: "fleet-security.yml",
        runs: [run({ id: 99, htmlUrl: "u99" }), run({ id: 1, htmlUrl: "u1" })],
      },
      { workflow: "fleet-lighthouse.yml", runs: [run({})] },
    ]);
    expect(s.perWorkflow[0]!.url).toBe("u99");
  });
});
