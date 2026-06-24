import { describe, it, expect } from "vitest";
import {
  refreshFleetState,
  FLEET_REFRESH_WORKFLOWS,
  type RefreshFleetDeps,
} from "../../src/dashboard/refresh-fleet.js";

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
