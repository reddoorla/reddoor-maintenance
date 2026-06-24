import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
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

  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const targets = selectRenovateTargets(websites);

  if (targets.length === 0) {
    return {
      output:
        `${formatRenovateDispatchSummary({ dispatched: [], skipped: [], failed: [] })}\n` +
        "No active repo-backed sites with critical/high vulnerabilities — nothing to dispatch.",
      code: 0,
    };
  }

  const gh = makeGitHub({ token });
  const result = await dispatchRenovateAcross(targets, {
    hasHealthyOpenRenovatePr: async (repo) => hasHealthyRenovatePr(await gh.openPullRequests(repo)),
    defaultBranch: (repo) => gh.defaultBranch(repo),
    dispatch: (repo, workflow, ref) => gh.dispatchWorkflow(repo, workflow, ref),
  });

  const failedRepos = new Set(result.failed.map((f) => f.repo));
  const skippedRepos = new Set(result.skipped);
  const lines = targets.map((t) => {
    const status = failedRepos.has(t.repo)
      ? "FAILED                       "
      : skippedRepos.has(t.repo)
        ? "skipped (open Renovate PR)   "
        : "dispatched                   ";
    return `${status} ${t.repo} (critical=${t.critical} high=${t.high}) — ${t.siteName}`;
  });
  for (const f of result.failed) lines.push(`  ↳ ${f.repo}: ${f.error}`);

  // Update the auto-fix attempt counters from this run, best-effort: a write that
  // fails (e.g. the Airtable field not yet created) is tallied, never thrown — the
  // sweep must still exit 0. Uses the full `websites` list so 0-vuln sites reset.
  const attemptUpdates = computeAutoFixAttemptUpdates(websites, result);
  const attemptTally = await applyAutoFixAttemptUpdates(attemptUpdates, (id, attempts) =>
    updateAutoFixAttempts(base, id, attempts),
  );

  lines.push(formatRenovateDispatchSummary(result));
  lines.push(formatAutoFixAttemptsSummary(attemptTally));

  return { output: lines.join("\n"), code: 0 };
}
