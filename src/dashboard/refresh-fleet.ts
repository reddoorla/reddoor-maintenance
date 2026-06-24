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
