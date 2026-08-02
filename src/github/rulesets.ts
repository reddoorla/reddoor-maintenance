/**
 * The pure invariant core of ruleset self-healing (spec:
 * docs/superpowers/specs/2026-08-02-ruleset-self-healing-design.md).
 *
 * Everything here is pure data-in/data-out so the brick-risk logic — "when is
 * it safe to require a status check", "what does healing preserve" — is unit
 * tested directly. The API I/O lives in gh.ts as thin wrappers.
 *
 * Why rulesets at all, when `protectBranch` (classic protection) already
 * exists: classic protection's `enforce_admins: false` exempts admins, and on
 * 2026-07-26 that hole let a bulk `gh pr merge --auto` sweep land two
 * unreviewed MAJOR bumps (reddoor-starter#77, reddoor-website#111). A ruleset
 * with an EMPTY bypass list binds everyone, including admins. Classic
 * protection stays in place (union-enforced) — this is the stronger layer on
 * top, and the one the fleet actually relies on.
 */

/** One rule inside a ruleset. Kept structurally loose (`parameters` is an open
 *  record) so a GitHub-added rule type or parameter can never crash the parse —
 *  unknown shapes flow through healing untouched. */
export type RulesetRule = {
  type: string;
  parameters?: Record<string, unknown>;
};

/** The subset of a GET /repos/{repo}/rulesets/{id} response the logic reads.
 *  Extra fields (timestamps, node_id, _links, current_user_can_bypass) are
 *  ignored on read and never echoed back on PUT. */
export type ExistingRuleset = {
  id: number;
  name: string;
  enforcement?: string;
  bypass_actors?: unknown[];
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  rules?: RulesetRule[];
};

/** The payload shape POST/PUT accepts. */
export type RulesetPayload = {
  name: string;
  target: "branch";
  enforcement: "active";
  bypass_actors: unknown[];
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: RulesetRule[];
};

/** Canonical fleet ruleset name — matches the 22 hand-applied 2026-07-31/08-01. */
export const FLEET_RULESET_NAME = "main: reviewed changes only";

/** `pull_request` defaults for a CREATED ruleset. 0 approvals is deliberate:
 *  one-member org + GitHub forbids self-approval, so any required approval
 *  deadlocks every PR (operator- and Renovate-authored alike) until the
 *  Renovate App identity exists. On HEAL these are never imposed — existing
 *  parameters are preserved so a hand-hardened repo (e.g.
 *  `required_review_thread_resolution: true`) is not fought back down. */
const DEFAULT_PULL_REQUEST_PARAMS: Record<string, unknown> = {
  required_approving_review_count: 0,
  dismiss_stale_reviews_on_push: false,
  require_code_owner_review: false,
  require_last_push_approval: false,
  required_review_thread_resolution: false,
  allowed_merge_methods: ["squash", "merge", "rebase"],
};

/** The ref-condition tokens that cover the default branch. `~ALL` is a
 *  superset of `~DEFAULT_BRANCH`, so either satisfies the floor. */
function coversDefaultBranch(include: string[] | undefined): boolean {
  return (include ?? []).some((r) => r === "~DEFAULT_BRANCH" || r === "~ALL");
}

function statusChecksOf(rule: RulesetRule | undefined): Array<{ context?: string }> {
  const raw = rule?.parameters?.["required_status_checks"];
  return Array.isArray(raw) ? (raw as Array<{ context?: string }>) : [];
}

function ruleOfType(rules: RulesetRule[] | undefined, type: string): RulesetRule | undefined {
  return (rules ?? []).find((r) => r.type === type);
}

/**
 * The desired payload for a repo with NO existing fleet ruleset.
 *
 * `requiredCheck` is the two-stage gate: pass the context string ONLY when
 * that check-run has been observed on the default branch (see
 * `checkContextObserved` in gh.ts); pass `null` otherwise and the ruleset is
 * created with the refs rules alone. Requiring a context that never fires
 * would make the repo permanently unmergeable by EVERYONE — bypass_actors is
 * empty by design, so there is no admin escape. (`.github` sits at stage 1
 * forever for exactly this reason: its ci.yml is `workflow_call`-only and
 * emits no check runs.)
 */
export function desiredRuleset(requiredCheck: string | null): RulesetPayload {
  return {
    name: FLEET_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { ...DEFAULT_PULL_REQUEST_PARAMS } },
      ...(requiredCheck === null
        ? []
        : [
            {
              type: "required_status_checks",
              parameters: {
                strict_required_status_checks_policy: true,
                do_not_enforce_on_create: false,
                required_status_checks: [{ context: requiredCheck }],
              },
            },
          ]),
    ],
  };
}

/**
 * Human-readable floor violations of an existing ruleset; empty array = the
 * ruleset satisfies the fleet floor and must NOT be touched (the noop path).
 *
 * The floor is deliberately a MINIMUM, not an exact shape: extra rules and
 * stronger `pull_request` parameters are not gaps. The one aggressive check is
 * `bypass_actors` — ANY entry is drift, because an empty bypass list is the
 * entire point of the ruleset layer (it is what binds admins). When the
 * Renovate App identity someday warrants a bypass actor, this is the single
 * place that decision gets encoded.
 *
 * `requiredCheck: null` scopes the floor to stage 1 (refs rules only); a
 * string additionally demands that context among required status checks with
 * strict (up-to-date) policy.
 */
export function rulesetGaps(existing: ExistingRuleset, requiredCheck: string | null): string[] {
  const gaps: string[] = [];
  if (existing.enforcement !== "active") {
    gaps.push(`enforcement is ${JSON.stringify(existing.enforcement ?? "unset")}, not "active"`);
  }
  const bypass = existing.bypass_actors ?? [];
  if (bypass.length > 0) {
    gaps.push(`${bypass.length} bypass actor(s) present (fleet floor is an empty bypass list)`);
  }
  if (!coversDefaultBranch(existing.conditions?.ref_name?.include)) {
    gaps.push("ref conditions do not cover the default branch");
  }
  // Exclude patterns can ONLY remove protection (GitHub applies exclude over
  // include), and the pure floor cannot resolve which patterns match the
  // default branch — `exclude: ["refs/heads/main"]` neutralizes the entire
  // ruleset while every other check here still passes. It is also the
  // least-destructive-LOOKING admin edit ("I'll just exclude main for a
  // minute"), i.e. exactly the bypass drift this layer alarms on. The fleet
  // floor is therefore NO excludes at all.
  const exclude = existing.conditions?.ref_name?.exclude ?? [];
  if (exclude.length > 0) {
    gaps.push(
      `${exclude.length} ref exclude pattern(s) present (excludes can only weaken; fleet floor is none)`,
    );
  }
  for (const type of ["deletion", "non_fast_forward", "pull_request"]) {
    if (!ruleOfType(existing.rules, type)) gaps.push(`missing ${type} rule`);
  }
  if (requiredCheck !== null) {
    const rsc = ruleOfType(existing.rules, "required_status_checks");
    if (!rsc) {
      gaps.push(`missing required_status_checks rule ("${requiredCheck}" is observed on the repo)`);
    } else {
      if (!statusChecksOf(rsc).some((c) => c.context === requiredCheck)) {
        gaps.push(`"${requiredCheck}" not among the required status checks`);
      }
      if (rsc.parameters?.["strict_required_status_checks_policy"] !== true) {
        gaps.push("strict (branch-up-to-date) status-check policy is off");
      }
    }
  }
  return gaps;
}

/**
 * The healed PUT payload for a drifted ruleset: existing content merged TOWARD
 * the floor, never away from it.
 *
 * Preserved verbatim: extra rule types (a hand-added `required_linear_history`
 * survives), existing `pull_request` parameters (hand-hardening survives),
 * other required status-check contexts (union, never replace — the same
 * lesson the classic protectBranch PUT learned), and existing ref INCLUDES
 * beyond the default-branch guarantee (extra includes only strengthen).
 *
 * Healed: enforcement → active, bypass_actors → [], and ref excludes → []
 * (both deliberate exceptions to never-weaken, because both are pure
 * weakenings — a bypass actor or an exclude matching the default branch IS
 * the drift being alarmed on), missing rules added, and — only when
 * `requiredCheck` is non-null — the context unioned in with strict policy
 * forced on.
 */
export function healRuleset(
  existing: ExistingRuleset,
  requiredCheck: string | null,
): RulesetPayload {
  const rules: RulesetRule[] = (existing.rules ?? []).map((r) => ({
    type: r.type,
    ...(r.parameters === undefined ? {} : { parameters: { ...r.parameters } }),
  }));
  for (const type of ["deletion", "non_fast_forward"]) {
    if (!ruleOfType(rules, type)) rules.push({ type });
  }
  if (!ruleOfType(rules, "pull_request")) {
    rules.push({ type: "pull_request", parameters: { ...DEFAULT_PULL_REQUEST_PARAMS } });
  }
  if (requiredCheck !== null) {
    const rsc = ruleOfType(rules, "required_status_checks");
    if (!rsc) {
      rules.push({
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: requiredCheck }],
        },
      });
    } else {
      const params = (rsc.parameters ??= {});
      const checks = statusChecksOf(rsc);
      if (!checks.some((c) => c.context === requiredCheck)) {
        params["required_status_checks"] = [...checks, { context: requiredCheck }];
      }
      params["strict_required_status_checks_policy"] = true;
    }
  }

  const include = existing.conditions?.ref_name?.include ?? [];
  return {
    name: existing.name,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: coversDefaultBranch(include) ? [...include] : [...include, "~DEFAULT_BRANCH"],
        // Excludes are cleared, never preserved: they can only remove
        // protection, and the pure logic cannot tell a benign pattern from
        // one that neutralizes the default branch (see rulesetGaps).
        exclude: [],
      },
    },
    rules,
  };
}
