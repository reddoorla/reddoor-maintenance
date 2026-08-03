import { rulesetGaps, type ExistingRuleset } from "../github/rulesets.js";
import type { WorkflowHealth } from "../github/gh.js";

/**
 * Org-wide protection-coverage sweep (spec:
 * docs/superpowers/specs/2026-08-02-ruleset-self-healing-design.md).
 *
 * The `self-updating` recipe HEALS fleet sites, but it runs only when someone
 * runs it, and only over Airtable-listed sites — which is exactly how the
 * `.github` repo (no Airtable row) sat with zero protection until 2026-08-01.
 * This sweep is the layer that would have caught that on its own: it
 * enumerates the org FROM THE GITHUB API — never a hand-typed or
 * Airtable-scoped list, both of which have already produced false "all
 * clear"s — and judges every public repo's protection by SHAPE, not by name,
 * so a differently-named but sound ruleset (reddoor-maintenance's "Main
 * Protection") counts.
 *
 * Since 2026-08-02 the same sweep also verifies two more posture surfaces per
 * public repo, because both regress silently and neither has any other
 * watcher:
 *  - secret scanning + push protection stay ENABLED (a repo transferred in,
 *    or an org-default flip, arrives with them off);
 *  - the renovate workflow is registered, active, and has actually RUN
 *    recently. GitHub auto-disables schedules after 60 quiet days, and
 *    schedule triggers in template-cloned files may never register at all —
 *    either way a fully-quiet repo stops receiving updates with zero signal
 *    (the 2026-08-02 sweep found two never-run and two 5-days-stale repos on
 *    its first pass).
 */
export type ProtectionCoverageRow = {
  repo: string; // owner/repo
  status: "covered" | "gap" | "skipped";
  /** Human-readable: covering ruleset + whether it gates on CI, the specific
   *  gaps, or why the repo was skipped. */
  detail: string;
};

/** The reads the sweep needs — a subset of the GitHub factory, injected so the
 *  sweep is pure + testable (same pattern as collectGitHubSignals). */
export type ProtectionCoverageDeps = {
  listOrgRepos: (org: string) => Promise<
    Array<{
      name: string;
      visibility: string;
      archived: boolean;
      secretScanning: string;
      pushProtection: string;
    }>
  >;
  listRepoRulesets: (repo: string) => Promise<Array<{ id: number; name: string }>>;
  getRuleset: (repo: string, id: number) => Promise<ExistingRuleset>;
  workflowHealth: (repo: string, filename: string) => Promise<WorkflowHealth>;
};

export const RENOVATE_WORKFLOW_FILE = "renovate.yml";

/** Cron is twice daily, so 3 days without a SUCCESSFUL run = 6+ consecutive
 *  missed-or-failing runs — dead scheduling, dead credential, or broken
 *  config, never jitter. (Success, not run-existence: a revoked App key still
 *  creates a fresh failing run every tick.) */
export const RENOVATE_STALE_AFTER_DAYS = 3;

/**
 * Operator-accepted gaps — the protection-audit analogue of the cockpit's
 * accepted-Watch acks: a KNOWN condition pending a real decision must not
 * comment the tracking issue every night, or the channel is tuned out by the
 * time a genuinely new gap lands in it. Constraints that keep this honest:
 * every entry is PR-reviewed, names ONE repo + ONE surface (never a blanket
 * mute), states the pending decision, and EXPIRES — past `until` the gap
 * returns on its own, so an acceptance can never quietly become permanent.
 */
export type AcceptedGap = {
  repo: string; // owner/repo
  /** Matched as a prefix of the gap detail line — surface-scoped, so an
   *  accepted renovate gap never swallows a ruleset or secret-scanning gap. */
  detailPrefix: string;
  reason: string;
  until: string; // ISO date; exclusive — the gap is live again ON this date
};

// Currently EMPTY — the only two entries (no-renovate on reddoor-maintenance
// and .github, pending an operator supply-chain call) were retired 2026-08-02
// when the operator approved planting Renovate on both. Add entries only for
// a named pending decision, never as a mute.
export const ACCEPTED_GAPS: AcceptedGap[] = [];

/** Split gaps into live vs accepted-for-now. Acceptance is per-surface (detail
 *  prefix) and expires: an entry past `until` accepts nothing. */
export function partitionAcceptedGaps(
  repo: string,
  gaps: string[],
  now: Date,
  accepted: AcceptedGap[] = ACCEPTED_GAPS,
): { live: string[]; accepted: string[] } {
  const live: string[] = [];
  const acceptedOut: string[] = [];
  for (const gap of gaps) {
    const match = accepted.find(
      (a) => a.repo === repo && gap.startsWith(a.detailPrefix) && now < new Date(a.until),
    );
    if (match) acceptedOut.push(`${gap} [accepted until ${match.until}: ${match.reason}]`);
    else live.push(gap);
  }
  return { live, accepted: acceptedOut };
}

/** Public repos only — secret scanning is plan-gated off on private Free
 *  repos, and those are skipped before this is consulted. "unavailable" means
 *  the listing couldn't read security_and_analysis (token lacks admin read),
 *  which must read as unverified, not as fine. */
export function secretScanningGaps(repo: {
  secretScanning: string;
  pushProtection: string;
}): string[] {
  const gaps: string[] = [];
  if (repo.secretScanning !== "enabled")
    gaps.push(`secret scanning ${repo.secretScanning} (fleet floor is enabled)`);
  if (repo.pushProtection !== "enabled")
    gaps.push(`push protection ${repo.pushProtection} (fleet floor is enabled)`);
  return gaps;
}

/** Renovate liveness verdict — judged on the last SUCCESSFUL run. The cron IS
 *  the merge cadence (platform auto-merge is off fleet-wide), so a workflow
 *  that isn't succeeding means the repo silently stops updating — the exact
 *  class the 2026-07-26 incident review called "zero-run blindness". */
export function renovateGaps(health: WorkflowHealth, now: Date): string[] {
  if (!health.present) return ["no renovate workflow (dependency updates never run here)"];
  if (health.state !== "active")
    return [
      // A disabled workflow REJECTS workflow_dispatch (HTTP 403) — it must be
      // re-enabled first; "just dispatch it" is a dead-end runbook line here.
      `renovate workflow is ${health.state} (re-enable it: \`gh workflow enable renovate.yml -R <repo>\`, then dispatch once)`,
    ];
  if (health.lastSuccessAt === null)
    return [
      "renovate workflow has never succeeded (dispatch it once; if this gap returns, the schedule never registered — push a commit touching the workflow file)",
    ];
  const succeededAt = Date.parse(health.lastSuccessAt);
  if (Number.isNaN(succeededAt))
    return [`renovate last-success timestamp unreadable: ${health.lastSuccessAt}`];
  const days = (now.getTime() - succeededAt) / 86_400_000;
  if (days > RENOVATE_STALE_AFTER_DAYS)
    return [`renovate last succeeded ${Math.floor(days)}d ago (cron is twice daily)`];
  return [];
}

/**
 * One row per org repo. Coverage = SOME repo-sourced ruleset with zero
 * stage-1 gaps (active, empty bypass, default branch covered, deletion +
 * non_fast_forward + pull_request) AND secret scanning enabled AND a live
 * renovate workflow. Whether a covering ruleset also gates on CI is reported
 * as detail, not judged: each repo's required context differs (and
 * reddoor-maintenance deliberately has none pending release-path review), so
 * the CI-gate invariant belongs to the per-site heal, which has the evidence
 * to require the RIGHT context safely.
 *
 * Private/archived repos are skipped (rulesets on private repos need a paid
 * plan; archived repos are read-only). A repo whose probe THROWS is a `gap`,
 * not a skip — "couldn't verify" reading as "fine" is the silent-green
 * failure mode this sweep exists to kill, and the tracking issue auto-closes
 * on the next clean pass, so a transient API blip costs one issue-comment.
 */
export async function collectProtectionCoverage(
  org: string,
  deps: ProtectionCoverageDeps,
  now: Date = new Date(),
  accepted: AcceptedGap[] = ACCEPTED_GAPS,
): Promise<ProtectionCoverageRow[]> {
  const rows: ProtectionCoverageRow[] = [];
  for (const r of await deps.listOrgRepos(org)) {
    const repo = `${org}/${r.name}`;
    if (r.archived || r.visibility !== "public") {
      rows.push({
        repo,
        status: "skipped",
        detail: r.archived ? "archived" : `${r.visibility} (rulesets need a paid plan)`,
      });
      continue;
    }
    try {
      const gaps: string[] = [];
      let coveredDetail = "";
      const rulesets = await deps.listRepoRulesets(repo);
      if (rulesets.length === 0) {
        gaps.push("no repo rulesets at all");
      } else {
        const judged = await Promise.all(
          rulesets.map(async (rs) => {
            const full = await deps.getRuleset(repo, rs.id);
            return { name: rs.name, full, gaps: rulesetGaps(full, null) };
          }),
        );
        const covering = judged.find((j) => j.gaps.length === 0);
        if (covering) {
          const ciGated = (covering.full.rules ?? []).some(
            (rule) => rule.type === "required_status_checks",
          );
          coveredDetail = `"${covering.name}"${ciGated ? "" : " — NO CI gate (refs rules only)"}`;
        } else {
          gaps.push(judged.map((j) => `"${j.name}": ${j.gaps.join("; ")}`).join(" | "));
        }
      }
      gaps.push(...secretScanningGaps(r));
      gaps.push(...renovateGaps(await deps.workflowHealth(repo, RENOVATE_WORKFLOW_FILE), now));
      const { live, accepted: acked } = partitionAcceptedGaps(repo, gaps, now, accepted);
      if (live.length > 0) {
        // Accepted annotations still ride along for context, but only LIVE
        // gaps make the row a gap (and thus the sweep exit 1).
        rows.push({ repo, status: "gap", detail: [...live, ...acked].join(" | ") });
      } else if (acked.length > 0) {
        // Judged, found wanting, deliberately acked — reported as skipped
        // (visible every night with the reason + expiry), never as covered.
        rows.push({ repo, status: "skipped", detail: acked.join(" | ") });
      } else {
        rows.push({ repo, status: "covered", detail: coveredDetail });
      }
    } catch (e) {
      rows.push({
        repo,
        status: "gap",
        detail: `probe failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return rows;
}
