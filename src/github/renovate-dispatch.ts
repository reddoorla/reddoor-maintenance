import { isDashboardVisible, type WebsiteRow } from "../reports/airtable/websites.js";
import { isRenovatePR } from "../alerts/renovate.js";
import type { PullRequestSummary } from "./gh.js";

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

/**
 * Does the repo have a HEALTHY open Renovate PR — one that is NOT conflicting?
 *
 * A healthy PR means remediation is genuinely in flight (moving toward merge), so
 * re-dispatching would just churn CI — skip it. A CONFLICTING Renovate PR is STUCK
 * (its branch fell behind the base after another PR merged the same lockfile), so
 * it does NOT count as healthy: re-dispatching triggers Renovate to rebase it.
 * `UNKNOWN` mergeability (GitHub still computing it) is treated as healthy — don't
 * churn on uncertainty. Reuses {@link isRenovatePR} for the branch-prefix check.
 */
export function hasHealthyRenovatePr(prs: PullRequestSummary[]): boolean {
  return prs.some((pr) => isRenovatePR(pr) && pr.mergeable !== "CONFLICTING");
}

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
 *
 * Counts are only guaranteed fresh for sites the sweep actually audited (active +
 * URL present); a site whose write-back failed/was skipped this run is selected on
 * its last-known counts. That's safe — a stale-high false dispatch is an idempotent
 * Renovate no-op, and the open-PR skip in `dispatchRenovateAcross` avoids re-firing
 * when remediation is already in flight.
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
  /** True iff the repo has a HEALTHY (non-conflicting) open Renovate PR —
   *  remediation in flight, so don't re-dispatch. A conflicting/stuck PR returns
   *  false so the dispatch goes through and Renovate rebases it. */
  hasHealthyOpenRenovatePr: (repo: string) => Promise<boolean>;
  defaultBranch: (repo: string) => Promise<string>;
  dispatch: (repo: string, workflow: string, ref: string) => Promise<void>;
};

export type RenovateDispatchResult = {
  dispatched: string[];
  /** Repos skipped because a Renovate PR is already open — no point re-firing. */
  skipped: string[];
  failed: { repo: string; error: string }[];
};

/**
 * Dispatch `renovate.yml` for each target on its default branch.
 *
 * Skips a repo with a HEALTHY (non-conflicting) open Renovate PR — remediation is
 * in flight, so re-dispatching would just churn CI (keeps a persistent vuln from
 * re-firing every nightly run while its fix PR waits, e.g. a human-gated major
 * bump). A repo whose open Renovate PR is CONFLICTING/stuck is NOT skipped:
 * dispatching triggers Renovate to rebase it. Best-effort and isolated: a repo
 * that lacks `renovate.yml`, or whose
 * dispatch/PR-check is refused (the token's `actions:write` scope), is recorded in
 * `failed` and the rest still run. Never throws — the caller (a follow-up step on
 * the security sweep) must not be able to fail the sweep over a dispatch hiccup.
 */
export async function dispatchRenovateAcross(
  targets: RenovateDispatchTarget[],
  deps: RenovateDispatchDeps,
): Promise<RenovateDispatchResult> {
  const dispatched: string[] = [];
  const skipped: string[] = [];
  const failed: { repo: string; error: string }[] = [];
  for (const t of targets) {
    try {
      if (await deps.hasHealthyOpenRenovatePr(t.repo)) {
        skipped.push(t.repo);
        continue;
      }
      const ref = await deps.defaultBranch(t.repo);
      await deps.dispatch(t.repo, RENOVATE_WORKFLOW_FILE, ref);
      dispatched.push(t.repo);
    } catch (e) {
      failed.push({ repo: t.repo, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dispatched, skipped, failed };
}

/** Machine-readable counts line the workflow greps to annotate partial failures. */
export function formatRenovateDispatchSummary(result: RenovateDispatchResult): string {
  return `RENOVATE_DISPATCH_SUMMARY dispatched=${result.dispatched.length} skipped=${result.skipped.length} failed=${result.failed.length}`;
}

/**
 * Plan the per-site auto-fix-attempt counter writes from a dispatch result. PURE.
 * For each site:
 *   - vulns now 0 (or never counted)       → reset to 0   (episode resolved)
 *   - else dispatched this run             → attempts + 1 (a fresh failed-so-far attempt)
 *   - else (skipped / failed / untouched)  → unchanged
 * The RESET applies fleet-wide — regardless of Status or Git repo — so a site
 * archived or un-repo'd after its episode can't carry a stale counter into its
 * next vuln (Alamo sat at 7 from a long-closed episode). A null vuln count
 * (never-audited) reads as zero, consistent with the existing null-as-zero
 * semantics, so a lingering counter on such a row also clears. The INCREMENT
 * keeps its active + repo-backed filters (only those sites are dispatched).
 * Returns only the rows whose value CHANGES (a steady fleet writes nothing —
 * a 0→0 site emits no write). A skipped repo (healthy Renovate PR in flight) is
 * NOT a failed attempt — a fix is genuinely moving toward merge — so its counter
 * holds.
 */
export function computeAutoFixAttemptUpdates(
  sites: WebsiteRow[],
  result: RenovateDispatchResult,
): { id: string; attempts: number }[] {
  const dispatched = new Set(result.dispatched);
  const updates: { id: string; attempts: number }[] = [];
  for (const s of sites) {
    const current = s.securityAutoFixAttempts ?? 0;
    const vulns = (s.securityVulnsCritical ?? 0) + (s.securityVulnsHigh ?? 0);
    if (vulns === 0) {
      // Episode resolved (or never confirmed): reset REGARDLESS of status/repo —
      // a site archived or un-repo'd after its episode must not carry a stale
      // counter into its next vuln (Alamo sat at 7 from a long-closed episode).
      if (current !== 0) updates.push({ id: s.id, attempts: 0 });
      continue;
    }
    if (!isDashboardVisible(s)) continue; // increments stay active-only
    const repo = s.gitRepo?.trim();
    if (!repo) continue; // …and repo-backed-only
    if (dispatched.has(repo)) updates.push({ id: s.id, attempts: current + 1 });
  }
  return updates;
}

/**
 * Apply the planned counter updates with an injected writer, BEST-EFFORT: a writer
 * that throws (e.g. the Airtable field not yet created, or a transient error) is
 * counted in `failed` and never propagates — the security sweep must not fail over
 * counter bookkeeping. Returns the applied/failed tallies for the summary line.
 */
export async function applyAutoFixAttemptUpdates(
  updates: { id: string; attempts: number }[],
  write: (id: string, attempts: number) => Promise<void>,
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const u of updates) {
    try {
      await write(u.id, u.attempts);
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
}

/** Machine-readable counts line the workflow can grep, mirroring RENOVATE_DISPATCH_SUMMARY. */
export function formatAutoFixAttemptsSummary(tally: { written: number; failed: number }): string {
  return `AUTO_FIX_ATTEMPTS_SUMMARY written=${tally.written} failed=${tally.failed}`;
}
