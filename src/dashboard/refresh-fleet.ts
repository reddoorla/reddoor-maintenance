/**
 * Fleet-level on-demand refresh: dispatch the GitHub Actions workflows that
 * produce all the cockpit/report state, so the operator can refresh now instead
 * of waiting for the nightly cron. Sibling of trigger-renovate.ts but fleet-wide
 * (no slug) and central-repo-targeted.
 *
 * Both workflows already expose `workflow_dispatch`:
 *  - fleet-security.yml   → vulns, auto-fix-attempt counters, security auto-check
 *  - fleet-lighthouse.yml → Lighthouse, domain/browser/links + indexed auto-checks,
 *                           AND the github-signals sweep (runs as a step inside it)
 */
import type { WorkflowRun } from "../github/gh-rest.js";
export const FLEET_REFRESH_WORKFLOWS = ["fleet-security.yml", "fleet-lighthouse.yml"] as const;

export type RefreshFleetDeps = {
  /** Dispatch one workflow file (on the central repo's default branch). Throws on failure. */
  dispatch: (workflow: string) => Promise<void>;
};

export type RefreshFleetResult = {
  dispatched: string[];
  failed: { workflow: string; error: string }[];
};

/**
 * Dispatch every fleet-refresh workflow INDEPENDENTLY — one failure must not stop
 * the others. Never throws; returns a partial result the handler maps to a status.
 */
export async function refreshFleetState(deps: RefreshFleetDeps): Promise<RefreshFleetResult> {
  const dispatched: string[] = [];
  const failed: { workflow: string; error: string }[] = [];
  for (const workflow of FLEET_REFRESH_WORKFLOWS) {
    try {
      await deps.dispatch(workflow);
      dispatched.push(workflow);
    } catch (e) {
      failed.push({ workflow, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dispatched, failed };
}

/** A single workflow's run state, normalized for the cockpit panel. */
export type WorkflowRunState =
  | "starting" // dispatched but no run has appeared yet
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out";

export type FleetRunStatus = {
  perWorkflow: { workflow: string; state: WorkflowRunState; url: string | null }[];
  allDone: boolean; // every workflow's newest run has completed
  anySuccess: boolean; // ≥1 completed with conclusion "success"
  anyFailure: boolean; // ≥1 completed with a non-success conclusion
};

const TERMINAL: WorkflowRunState[] = ["success", "failure", "cancelled", "timed_out"];

/** Map a single (newest) run — or its absence — into one normalized state. */
function runState(run: WorkflowRun | undefined): WorkflowRunState {
  if (!run) return "starting";
  if (run.status !== "completed") {
    return run.status === "in_progress" ? "in_progress" : "queued";
  }
  switch (run.conclusion) {
    case "success":
      return "success";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    default:
      // failure + any other terminal conclusion (action_required, neutral, …) — all
      // terminal, all surfaced as a failure so the operator checks the run.
      return "failure";
  }
}

/**
 * Roll the two fleet workflows' newest runs into one verdict the status endpoint
 * returns and the cockpit panel renders. Pure: no I/O. `runs` per workflow is the
 * newest-first list from `listWorkflowRuns`; only `[0]` is considered.
 */
export function summarizeFleetRunStatus(
  runsByWorkflow: { workflow: string; runs: WorkflowRun[] }[],
): FleetRunStatus {
  const perWorkflow = runsByWorkflow.map(({ workflow, runs }) => {
    const newest = runs[0];
    return { workflow, state: runState(newest), url: newest?.htmlUrl ?? null };
  });
  return {
    perWorkflow,
    allDone: perWorkflow.every((w) => TERMINAL.includes(w.state)),
    anySuccess: perWorkflow.some((w) => w.state === "success"),
    anyFailure: perWorkflow.some(
      (w) => w.state === "failure" || w.state === "cancelled" || w.state === "timed_out",
    ),
  };
}
