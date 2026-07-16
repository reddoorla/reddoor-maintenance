import { openBase, readAirtableConfig, type AirtableBase } from "../../reports/airtable/client.js";
import { listWebsites, updateAutoFixAttempts } from "../../reports/airtable/websites.js";
import { makeGitHub } from "../../github/gh.js";
import {
  selectRenovateTargets,
  dispatchRenovateAcross,
  formatRenovateDispatchSummary,
  hasHealthyRenovatePr,
  computeAutoFixAttemptUpdates,
  applyAutoFixAttemptUpdates,
  formatAutoFixAttemptsSummary,
  type RenovateDispatchResult,
} from "../../github/renovate-dispatch.js";

/**
 * `renovate-dispatch --fleet`: read the Websites table, pick the active,
 * repo-backed sites the latest security sweep flagged with critical/high vulns,
 * and fire each one's `renovate.yml` `workflow_dispatch` so Renovate's OSV
 * vulnerability alerts open the remediation PR now (instead of waiting for the
 * weekly schedule). Designed to run as a best-effort follow-up step on
 * `fleet-security.yml` AFTER the sweep has written fresh counts to Airtable.
 *
 * Always exits 0: a missing token is a clean skip; a partial dispatch failure
 * (a repo without `renovate.yml`, or a token lacking `actions:write`) is reported
 * in the summary for the workflow to annotate, never failing the security sweep.
 */
export async function runRenovateDispatchCommand(opts: {
  fleet?: boolean | undefined;
  /** Inject a pre-opened Airtable base (tests). Defaults to env config. */
  base?: AirtableBase;
}): Promise<{ output: string; code: number }> {
  if (!opts.fleet) {
    return { output: "renovate-dispatch currently supports only --fleet", code: 2 };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    return {
      output: "renovate-dispatch skipped: no RENOVATE_TOKEN/GH_TOKEN (fleet dispatch) configured.",
      code: 0,
    };
  }

  const base = opts.base ?? openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const targets = selectRenovateTargets(websites);

  const lines: string[] = [];
  let result: RenovateDispatchResult = { dispatched: [], skipped: [], failed: [] };
  if (targets.length === 0) {
    lines.push(
      "No active repo-backed sites with critical/high vulnerabilities — nothing to dispatch.",
    );
  } else {
    const gh = makeGitHub({ token });
    result = await dispatchRenovateAcross(targets, {
      hasHealthyOpenRenovatePr: async (repo) =>
        hasHealthyRenovatePr(await gh.openPullRequests(repo)),
      defaultBranch: (repo) => gh.defaultBranch(repo),
      dispatch: (repo, workflow, ref) => gh.dispatchWorkflow(repo, workflow, ref),
    });

    const failedRepos = new Set(result.failed.map((f) => f.repo));
    const skippedRepos = new Set(result.skipped);
    for (const t of targets) {
      const status = failedRepos.has(t.repo)
        ? "FAILED                       "
        : skippedRepos.has(t.repo)
          ? "skipped (open Renovate PR)   "
          : "dispatched                   ";
      lines.push(`${status} ${t.repo} (critical=${t.critical} high=${t.high}) — ${t.siteName}`);
    }
    for (const f of result.failed) lines.push(`  ↳ ${f.repo}: ${f.error}`);
  }

  // Counter bookkeeping runs on EVERY fleet run — the reset-on-clean branch was
  // previously unreachable behind the zero-targets early return, so a fully-clean
  // fleet never cleared stale counters (Alamo stuck at 7, 2026-07). Best-effort:
  // a failed write is tallied, never thrown. Uses the full `websites` list so
  // 0-vuln sites reset.
  const attemptUpdates = computeAutoFixAttemptUpdates(websites, result);
  const attemptTally = await applyAutoFixAttemptUpdates(attemptUpdates, (id, attempts) =>
    updateAutoFixAttempts(base, id, attempts),
  );

  lines.push(formatRenovateDispatchSummary(result));
  lines.push(formatAutoFixAttemptsSummary(attemptTally));

  return { output: lines.join("\n"), code: 0 };
}
