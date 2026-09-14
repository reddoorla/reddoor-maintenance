import { rulesetGaps, type ExistingRuleset } from "../github/rulesets.js";
import type {
  BranchTip,
  DependencyDashboard,
  RenovateMergeWindow,
  WorkflowHealth,
} from "../github/gh.js";

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
 * Since 2026-08-02 the same sweep also verifies three more posture surfaces
 * per public repo, because each regresses silently and none has any other
 * watcher:
 *  - secret scanning + push protection stay ENABLED (a repo transferred in,
 *    or an org-default flip, arrives with them off), and — since 2026-09-14 —
 *    that what the detector FOUND has been read: a repo with open
 *    secret-scanning alerts is a gap however green its settings are, because
 *    an enabled scanner nobody reads produced five untriaged alerts, the
 *    oldest 99 days old, on repos this sweep was calling covered;
 *  - the renovate workflow is registered, active, and has actually RUN
 *    recently. GitHub auto-disables schedules after 60 quiet days, and
 *    schedule triggers in template-cloned files may never register at all —
 *    either way a fully-quiet repo stops receiving updates with zero signal
 *    (the 2026-08-02 sweep found two never-run and two 5-days-stale repos on
 *    its first pass);
 *  - renovate is not only alive but ALLOWED TO ACT — a workflow can run green
 *    forever while Renovate has quietly stopped managing a branch, which froze
 *    updates on nine repos for a week in August 2026 (see
 *    renovateBlockedGaps). Liveness cannot see this; only the outcome can.
 */
export type ProtectionCoverageRow = {
  repo: string; // owner/repo
  status: "covered" | "gap" | "skipped";
  /** Human-readable: covering ruleset + whether it gates on CI, the specific
   *  gaps, or why the repo was skipped. */
  detail: string;
  /** The one OUTCOME measurement on this sweep: did a feature update actually
   *  LAND here (see renovateOutcome). Deliberately not folded into `status` —
   *  it warns, it never gaps, so it can never file or hold open the tracking
   *  issue. Absent on skipped repos, which are not measured at all. */
  renovateOutcome?: RenovateOutcome;
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
  dependencyDashboard: (repo: string) => Promise<DependencyDashboard>;
  branchTip: (repo: string, branch: string) => Promise<BranchTip | null>;
  openSecretAlerts: (repo: string) => Promise<number | "unavailable">;
  renovateMergeWindow: (repo: string) => Promise<RenovateMergeWindow>;
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

/**
 * Public repos only — secret scanning is plan-gated off on private Free
 * repos, and those are skipped before this is consulted. "unavailable" means
 * the listing couldn't read security_and_analysis (token lacks admin read),
 * which must read as unverified, not as fine.
 *
 * Three surfaces, and the third is the one the first two cannot see. Scanning
 * being ENABLED says a detector is running; it says nothing about whether
 * anyone read what it found. On 2026-09-12 a hand-run sweep found five open
 * alerts across five public repos, every one `resolution: null`, the oldest 99
 * days old — on repos this audit had been calling `covered` every night, truth-
 * fully, because both statuses were `enabled`. An alert is not self-clearing
 * and redaction at HEAD does not close one (beachfront's key was redacted in
 * `e30c756` and the alert stayed open the following 37 days), so an unread
 * alert stays unread until a human is told. `openAlerts` is that third clause.
 *
 * `openAlerts: "unavailable"` is the token that cannot read alerts (403/404 —
 * the endpoint needs `security_events`). It is a gap for the same reason
 * "unavailable" scanning status is: this sweep exists because "couldn't check"
 * reading as "fine" is the failure mode, and a scope error must not quietly
 * turn the whole fleet green on a question it can no longer ask.
 *
 * The clause is skipped entirely when scanning is not enabled: the endpoint
 * 404s by construction there, the row already names the disabled scanning as
 * its gap, and a second "unverified" line would only attach noise to a cause
 * already stated.
 */
export function secretScanningGaps(
  repo: string, // owner/repo — named in the alert gap, which is per-repo actionable
  state: { secretScanning: string; pushProtection: string },
  openAlerts: number | "unavailable",
): string[] {
  const gaps: string[] = [];
  if (state.secretScanning !== "enabled")
    gaps.push(`secret scanning ${state.secretScanning} (fleet floor is enabled)`);
  if (state.pushProtection !== "enabled")
    gaps.push(`push protection ${state.pushProtection} (fleet floor is enabled)`);
  if (state.secretScanning === "enabled") {
    if (openAlerts === "unavailable")
      gaps.push(
        `open secret-scanning alerts unreadable on ${repo} (token lacks security_events/admin ` +
          `read — unverified, not clean)`,
      );
    else if (openAlerts > 0)
      gaps.push(
        `${openAlerts} open secret-scanning alert${openAlerts === 1 ? "" : "s"} on ${repo} — a ` +
          `leaked credential nobody has triaged. Fix: rotate or restrict the secret, then close ` +
          `the alert with a resolution at https://github.com/${repo}/security/secret-scanning ` +
          `(redacting the value at HEAD does NOT close it — the history is still public).`,
      );
  }
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
 * Renovate EFFECTIVENESS, which is a different question from liveness.
 *
 * `renovateGaps` above asks "did the workflow run and succeed?" — and on
 * 2026-08-03 nine repos answered YES to that while shipping zero updates for a
 * week. The `reddoor-renovate` App migration (2026-08-02) left each repo
 * holding a `renovate/all-minor-patch` branch whose tip was authored by the
 * OLD `renovate-bot` PAT identity. Renovate compares that author to its own,
 * concludes a human edited the branch, files it under "PR Edited (Blocked) —
 * Renovate will no longer make changes", and never touches it again. Every run
 * kept succeeding; `@reddoorla/maintenance`, `@sveltejs/kit`, `vite`,
 * `@playwright/test` and `node` were all frozen behind it; CI stayed green and
 * nothing anywhere raised a hand.
 *
 * A liveness probe structurally cannot see this: the workflow is doing its job
 * perfectly, it is simply forbidden to act. So this reads the outcome Renovate
 * itself publishes — the one place it admits to having given up.
 *
 * Absent dashboard is NOT a gap: `dependencyDashboard` is a config a repo may
 * legitimately disable, and the liveness probe already owns the dead-Renovate
 * case.
 *
 * Nor is every blocked branch a gap — see resolveBlockedBranches, which is
 * where the orphan/in-flight distinction is made. Both exclusions serve the
 * same property: this surface reports only what it can stand behind, which is
 * what decides whether an alarm channel still gets read a month from now.
 */
export function renovateBlockedGaps(blocked: BlockedBranchState[]): string[] {
  const orphaned = blocked.filter((b) => b.orphaned);
  if (orphaned.length === 0) return [];
  return [
    `renovate is BLOCKED on ${orphaned.length} branch(es) — ` +
      `${orphaned.map((b) => b.branch).join(", ")} — it runs and succeeds but refuses to ` +
      `update them, so every dependency grouped there is frozen. Usual cause: the branch ` +
      `tip was authored by a retired bot identity, which reads to Renovate as a human ` +
      `edit. Fix: confirm the tip author is a bot, then delete the branch and let ` +
      `Renovate recreate it (\`gh api -X DELETE repos/<repo>/git/refs/heads/<branch>\`).`,
  ];
}

/**
 * A dashboard whose section vocabulary we do not share. Reported separately
 * from blocked branches because it is a different claim: not "Renovate is
 * stuck" but "this audit can no longer tell whether Renovate is stuck." The
 * blocked heading was renamed once already (Edited/Blocked -> PR Edited
 * (Blocked) in Renovate 43), and the fleet inherits its Renovate major from
 * whatever renovatebot/github-action bakes in — so the next rename arrives via
 * an ordinary dependency PR that Renovate merges in-run, with nobody reading
 * dashboard wording. Without this, that rename would flip every repo to
 * covered on the same night and the surface would go permanently blind.
 */
export function dashboardVocabularyGaps(dash: DependencyDashboard): string[] {
  if (!dash.present || dash.unknownSections.length === 0) return [];
  return [
    `renovate dashboard has ${dash.unknownSections.length} section(s) this audit does ` +
      `not recognise — ${dash.unknownSections.join(", ")}. Nothing is necessarily wrong ` +
      `with the repo, but the blocked-branch check reads Renovate's own headings, so ` +
      `drift there means it can no longer be trusted. Fix: reconcile ` +
      `KNOWN_DASHBOARD_SECTIONS in src/github/gh.ts against Renovate's ` +
      `dependency-dashboard.ts.`,
  ];
}

/* ------------------------------------------------------------------------ *
 * The OUTCOME metric (S7).
 *
 * The three Renovate surfaces above are all green, all literally correct, and
 * jointly blind to the live condition. They ask, in order: did the workflow
 * RUN (renovateGaps), does the dashboard name a branch Renovate has STOPPED
 * managing (renovateBlockedGaps), and is that dashboard still written in
 * vocabulary we can parse (dashboardVocabularyGaps). Every one of them is a
 * question about the machinery. None is a question about the result.
 *
 * The 2026-08-03 detector was built for "Renovate REFUSES to touch the
 * branch". Measured on 2026-09-14, the live condition is its mirror image:
 * Renovate touches `renovate/all-minor-patch` on all 26 repos that hold one —
 * every single tip is dated 2026-09-14, rewritten between 02:27Z and 17:58Z —
 * and opens a PR on none of them. Liveness green, blocked-branch check green,
 * vocabulary green, and the last feature update to actually land fleet-wide
 * merged on 2026-08-12.
 *
 * So this asks the only question the others cannot: when did an update last
 * LAND here?
 * ------------------------------------------------------------------------ */

/**
 * Does a merged `renovate/*` head count as a FEATURE update?
 *
 * The two exclusions are the whole point of the metric. Renovate opened 78 PRs
 * fleet-wide between 2026-08-31 and 2026-09-14 — 32 on 09-09 alone — every one
 * of them on a `renovate/npm-*-vulnerability` or `renovate/lock-file-maintenance`
 * branch. Those two channels bypass the preset's Monday schedule and kept
 * flowing straight through the drought, so any metric that counts them reads
 * green while feature-version drift accumulates for a month. (This is also why
 * "Renovate is dead" is a false description of the fleet and will discredit the
 * real finding: only the GROUPED NON-MAJOR channel stopped.)
 */
export function isFeatureUpdateBranch(headRef: string): boolean {
  if (!headRef.startsWith("renovate/")) return false;
  if (headRef === "renovate/lock-file-maintenance") return false;
  return !/^renovate\/npm-.+-vulnerability$/.test(headRef);
}

/**
 * Days without a landed feature update before the sweep says so.
 *
 * Justified from the two snapshots this metric was proven against, not chosen
 * for roundness (see tests/audits/protection-coverage.test.ts):
 *   - 2026-08-10, the channel demonstrably delivering: 20 measured repos, worst
 *     case 14.0 days (caltex-landing), median 6.6.
 *   - 2026-09-14, today: 21 measured repos, BEST case 32.3 days, worst 34.8.
 * The two populations are separated by a clean 18-day band (14.1 … 32.3) with
 * no repo in it. 21 sits inside that band with ~7 days of margin on each side,
 * and has a mechanical reading as well as an empirical one: the shared preset's
 * window is `before 11am on monday`, so 21 days is three consecutive missed
 * Monday windows — a cadence failure, never jitter.
 *
 * Note what the margin buys. At 14 days the 2026-08-10 control would have
 * warned on 2 of 20 repos — i.e. the instrument would have fired during known
 * healthy operation, which is the state in which a threshold is worth nothing.
 */
export const RENOVATE_DROUGHT_WARN_DAYS = 21;

export type RenovateOutcome =
  | {
      state: "delivering" | "drought";
      days: number;
      lastBranch: string;
      lastMergedAt: string;
    }
  | { state: "unmeasured"; reason: string };

/**
 * Days since this repo last MERGED a feature-update Renovate PR.
 *
 * Three states, and the third is the one that keeps this honest. A repo with
 * no feature merge inside the scanned window is `unmeasured`, NEVER a drought:
 *   - on a busy repo the window itself is the limit (100 closed PRs reach back
 *     ~12 days on reddoor-maintenance and ~90 on a quiet site repo), so
 *     `truncated` says the answer is older than we looked, not that it is bad;
 *   - on a repo that has genuinely never merged one there is no elapsed time to
 *     measure at all, and calling that a drought would fire forever on every
 *     freshly bootstrapped repo.
 * Both print every night with their reason. "I could not measure this" must
 * never render as "this is fine" — that silent-green reading is the failure
 * this whole sweep exists to kill.
 */
export function renovateOutcome(window: RenovateMergeWindow, now: Date): RenovateOutcome {
  const last = window.merges.filter((m) => isFeatureUpdateBranch(m.headRef))[0];
  if (!last) {
    return {
      state: "unmeasured",
      reason: window.truncated
        ? "no feature-update Renovate merge inside the scanned window, and the window is FULL " +
          "(older history not read — this repo merges too many PRs to see back that far)"
        : "this repo has never merged a feature-update Renovate PR (no baseline to measure from)",
    };
  }
  const days = Math.floor((now.getTime() - new Date(last.mergedAt).getTime()) / 86_400_000);
  return {
    state: days > RENOVATE_DROUGHT_WARN_DAYS ? "drought" : "delivering",
    days,
    lastBranch: last.headRef,
    lastMergedAt: last.mergedAt,
  };
}

/** One operator-facing line per measured repo, or `null` when the outcome is
 *  healthy and needs no line. Warnings and unmeasured reads are reported
 *  side by side because they are the same claim — "no update landed here" —
 *  differing only in whether we know why. */
export function renovateOutcomeLine(outcome: RenovateOutcome): string | null {
  if (outcome.state === "delivering") return null;
  if (outcome.state === "unmeasured") return `renovate outcome UNMEASURED — ${outcome.reason}`;
  return (
    `no feature update has LANDED in ${outcome.days}d ` +
    `(warns past ${RENOVATE_DROUGHT_WARN_DAYS}d; last was ${outcome.lastBranch} ` +
    `merged ${outcome.lastMergedAt.slice(0, 10)}). Security + lockfile Renovate PRs are ` +
    `excluded, so this is feature-version drift, not a security signal.`
  );
}

/** The machine-readable outcome line, in the same shape as PROTECTION_AUDIT.
 *  Deliberately a SEPARATE line with a separate prefix: the nightly workflow
 *  gates its tracking issue on `PROTECTION_AUDIT gaps=0 `, and this metric must
 *  be able to say "nothing is landing" for a month without opening, holding
 *  open, or blocking the close of a posture issue. Shared with the tests so the
 *  proof asserts the product's real output rather than a restatement of it. */
export function renovateOutcomeSummary(outcomes: RenovateOutcome[]): string {
  const n = (state: RenovateOutcome["state"]) => outcomes.filter((o) => o.state === state).length;
  return (
    `RENOVATE_OUTCOME drought=${n("drought")} delivering=${n("delivering")} ` +
    `unmeasured=${n("unmeasured")} threshold=${RENOVATE_DROUGHT_WARN_DAYS}d`
  );
}

/** How long a human-owned blocked branch may sit before it stops reading as
 *  in-flight work. Sized to clear a weekend plus slack: the fleet's own
 *  human-edited Renovate PRs merge in minutes, while the branches that froze
 *  nine repos sat for a week. */
export const BLOCKED_STALE_DAYS = 5;

export type BlockedBranchState = { branch: string; orphaned: boolean };

/**
 * Decide which blocked branches are actually a posture problem.
 *
 * `PR Edited (Blocked)` is not by itself a fault — it is also Renovate's
 * designed way of saying "a human owns this branch now", and pushing a commit
 * onto an open Renovate PR is routine fleet practice (16 such PRs across 14
 * repos on a single day). Alarming on those would fire the nightly issue for
 * perfectly healthy in-flight work, and would attach a remediation that says
 * to delete the branch — i.e. the human's commits.
 *
 * A branch counts as ORPHANED, and therefore a gap, when either:
 *   - its tip was authored by a machine, so no human owns it and nothing will
 *     ever clear it on its own; or
 *   - it has sat untouched past BLOCKED_STALE_DAYS, whoever authored it —
 *     because Renovate updates a branch it is managing, so tip age IS time
 *     spent frozen.
 *
 * The authorship test is the fast path and the staleness test is the backstop:
 * if machine-identity detection ever drifts, detection degrades to slower, not
 * to blind. A branch that no longer exists is not a gap — that is a dashboard
 * Renovate has not rewritten yet.
 */
export async function resolveBlockedBranches(
  repo: string,
  dash: DependencyDashboard,
  deps: Pick<ProtectionCoverageDeps, "branchTip">,
  now: Date,
): Promise<BlockedBranchState[]> {
  if (!dash.present) return [];
  const states: BlockedBranchState[] = [];
  for (const branch of dash.blockedBranches) {
    const tip = await deps.branchTip(repo, branch);
    if (!tip) continue;
    const ageDays = (now.getTime() - new Date(tip.committedAt).getTime()) / 86_400_000;
    states.push({ branch, orphaned: tip.authorIsMachine || ageDays > BLOCKED_STALE_DAYS });
  }
  return states;
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
      // Only ask for alerts where scanning is on — see secretScanningGaps for
      // why a 404-by-construction is not worth a second gap line.
      const openAlerts =
        r.secretScanning === "enabled" ? await deps.openSecretAlerts(repo) : "unavailable";
      gaps.push(...secretScanningGaps(repo, r, openAlerts));
      gaps.push(...renovateGaps(await deps.workflowHealth(repo, RENOVATE_WORKFLOW_FILE), now));
      const dash = await deps.dependencyDashboard(repo);
      gaps.push(...dashboardVocabularyGaps(dash));
      gaps.push(...renovateBlockedGaps(await resolveBlockedBranches(repo, dash, deps, now)));
      // MEASUREMENT, not a gap: never pushed into `gaps`, so it cannot change
      // the exit code, the PROTECTION_AUDIT counts, or the tracking issue.
      const outcome = renovateOutcome(await deps.renovateMergeWindow(repo), now);
      const { live, accepted: acked } = partitionAcceptedGaps(repo, gaps, now, accepted);
      if (live.length > 0) {
        // Accepted annotations still ride along for context, but only LIVE
        // gaps make the row a gap (and thus the sweep exit 1).
        rows.push({
          repo,
          status: "gap",
          detail: [...live, ...acked].join(" | "),
          renovateOutcome: outcome,
        });
      } else if (acked.length > 0) {
        // Judged, found wanting, deliberately acked — reported as skipped
        // (visible every night with the reason + expiry), never as covered.
        rows.push({
          repo,
          status: "skipped",
          detail: acked.join(" | "),
          renovateOutcome: outcome,
        });
      } else {
        rows.push({
          repo,
          status: "covered",
          detail: coveredDetail,
          renovateOutcome: outcome,
        });
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
