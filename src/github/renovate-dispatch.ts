import { isDashboardVisible, type WebsiteRow } from "../reports/airtable/websites.js";

/**
 * On-demand Renovate trigger for fleet sites.
 *
 * The nightly security sweep (`fleet-security.yml`) writes each active site's
 * vulnerability counts to Airtable. This module turns that into action: for the
 * sites the sweep just flagged with *actionable* (critical or high) vulns, it
 * dispatches that repo's `renovate.yml` `workflow_dispatch` so Renovate runs off
 * its weekly schedule. Renovate's OSV vulnerability alerts bypass the schedule,
 * so the remediation PR opens immediately (then auto-merges per the shared
 * preset). Moderate/low vulns are left to the normal weekly cadence — not urgent
 * enough to dispatch + churn CI nightly.
 */

/** The per-repo workflow file the fleet uses for its self-hosted Renovate run. */
export const RENOVATE_WORKFLOW_FILE = "renovate.yml";

/** A site selected for an on-demand Renovate run, with the reason (vuln counts). */
export type RenovateDispatchTarget = {
  repo: string; // owner/repo, from the Websites "Git repo" field
  siteName: string;
  critical: number;
  high: number;
};

/**
 * Pick the active, repo-backed sites whose latest security sweep found a
 * critical or high vulnerability. A `null` vuln count is treated as zero (a site
 * that was never swept, or had its counts cleared, is not dispatched). Inactive
 * sites and sites without a `Git repo` are excluded — there's nothing to kick.
 */
export function selectRenovateTargets(sites: WebsiteRow[]): RenovateDispatchTarget[] {
  const targets: RenovateDispatchTarget[] = [];
  for (const s of sites) {
    if (!isDashboardVisible(s)) continue; // active (maintenance / launch period) only
    const repo = s.gitRepo?.trim();
    if (!repo) continue; // repo-backed only — the dispatch target is its renovate.yml
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    if (critical + high <= 0) continue; // actionable (critical/high) vulns only
    targets.push({ repo, siteName: s.name, critical, high });
  }
  return targets;
}

/** Injected GitHub operations — real ones come from `makeGitHub`, fakes from tests. */
export type RenovateDispatchDeps = {
  defaultBranch: (repo: string) => Promise<string>;
  dispatch: (repo: string, workflow: string, ref: string) => Promise<void>;
};

export type RenovateDispatchResult = {
  dispatched: string[];
  failed: { repo: string; error: string }[];
};

/**
 * Dispatch `renovate.yml` for each target on its default branch. Best-effort and
 * isolated: a repo that lacks `renovate.yml`, or whose dispatch is refused (the
 * token's `actions:write` scope), is recorded in `failed` and the rest still run.
 * Never throws — the caller (a follow-up step on the security sweep) must not be
 * able to fail the sweep over a dispatch hiccup.
 */
export async function dispatchRenovateAcross(
  targets: RenovateDispatchTarget[],
  deps: RenovateDispatchDeps,
): Promise<RenovateDispatchResult> {
  const dispatched: string[] = [];
  const failed: { repo: string; error: string }[] = [];
  for (const t of targets) {
    try {
      const ref = await deps.defaultBranch(t.repo);
      await deps.dispatch(t.repo, RENOVATE_WORKFLOW_FILE, ref);
      dispatched.push(t.repo);
    } catch (e) {
      failed.push({ repo: t.repo, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dispatched, failed };
}

/** Machine-readable counts line the workflow greps to annotate partial failures. */
export function formatRenovateDispatchSummary(result: RenovateDispatchResult): string {
  return `RENOVATE_DISPATCH_SUMMARY dispatched=${result.dispatched.length} failed=${result.failed.length}`;
}
