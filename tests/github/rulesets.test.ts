import { describe, it, expect } from "vitest";
import {
  desiredRuleset,
  rulesetGaps,
  healRuleset,
  FLEET_RULESET_NAME,
  type ExistingRuleset,
  type RulesetRule,
} from "../../src/github/rulesets.js";

const CHECK = "ci / ci";

/** The live fleet shape (espada's ruleset as dumped 2026-08-01) — must read as
 *  zero gaps, or every nightly heal would PUT a needless update fleet-wide. */
function liveFleetRuleset(over: Partial<ExistingRuleset> = {}): ExistingRuleset {
  return {
    id: 20165584,
    name: FLEET_RULESET_NAME,
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          // GET returns fields POST never sent — they must not read as drift.
          required_reviewers: [],
          require_code_owner_review: false,
          dismissal_restriction: { enabled: false, allowed_actors: [] },
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ["squash", "merge", "rebase"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: CHECK }],
        },
      },
    ],
    ...over,
  };
}

function ruleTypes(rules: RulesetRule[]): string[] {
  return rules.map((r) => r.type);
}

describe("desiredRuleset", () => {
  it("stage 2 (check observed): all four rules, strict, empty bypass", () => {
    const d = desiredRuleset(CHECK);
    expect(d.name).toBe(FLEET_RULESET_NAME);
    expect(d.enforcement).toBe("active");
    expect(d.bypass_actors).toEqual([]);
    expect(d.conditions.ref_name.include).toEqual(["~DEFAULT_BRANCH"]);
    expect(ruleTypes(d.rules)).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    const rsc = d.rules.find((r) => r.type === "required_status_checks")!;
    expect(rsc.parameters?.["required_status_checks"]).toEqual([{ context: CHECK }]);
    expect(rsc.parameters?.["strict_required_status_checks_policy"]).toBe(true);
  });

  it("stage 1 (check NOT observed): NO status-check rule — an unobserved required context + empty bypass would brick the repo for everyone", () => {
    const d = desiredRuleset(null);
    expect(ruleTypes(d.rules)).toEqual(["deletion", "non_fast_forward", "pull_request"]);
  });

  it("pull_request defaults to 0 approvals (one-member org: any required approval deadlocks every PR)", () => {
    const pr = desiredRuleset(CHECK).rules.find((r) => r.type === "pull_request")!;
    expect(pr.parameters?.["required_approving_review_count"]).toBe(0);
  });
});

describe("rulesetGaps", () => {
  it("the LIVE fleet shape has zero gaps at both stages (else every nightly heals needlessly)", () => {
    expect(rulesetGaps(liveFleetRuleset(), CHECK)).toEqual([]);
    expect(rulesetGaps(liveFleetRuleset(), null)).toEqual([]);
  });

  it("a bypass actor is a gap — the drift this whole layer alarms on", () => {
    const gaps = rulesetGaps(
      liveFleetRuleset({ bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }] }),
      null,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("bypass actor");
  });

  it("disabled/evaluate enforcement is a gap", () => {
    expect(rulesetGaps(liveFleetRuleset({ enforcement: "evaluate" }), null)).toHaveLength(1);
    expect(rulesetGaps(liveFleetRuleset({ enforcement: "disabled" }), null)).toHaveLength(1);
  });

  it("missing refs rules are individual gaps", () => {
    const gaps = rulesetGaps(liveFleetRuleset({ rules: [] }), null);
    expect(gaps).toEqual([
      "missing deletion rule",
      "missing non_fast_forward rule",
      "missing pull_request rule",
    ]);
  });

  it("stage 2: missing status-check rule / missing context / strict off are gaps", () => {
    const noRsc = liveFleetRuleset();
    noRsc.rules = noRsc.rules!.filter((r) => r.type !== "required_status_checks");
    expect(rulesetGaps(noRsc, CHECK)).toHaveLength(1);
    expect(rulesetGaps(noRsc, CHECK)[0]).toContain("missing required_status_checks");

    const wrongContext = liveFleetRuleset();
    wrongContext.rules!.find((r) => r.type === "required_status_checks")!.parameters![
      "required_status_checks"
    ] = [{ context: "build" }];
    expect(rulesetGaps(wrongContext, CHECK).join()).toContain(`"${CHECK}" not among`);

    const lax = liveFleetRuleset();
    lax.rules!.find((r) => r.type === "required_status_checks")!.parameters![
      "strict_required_status_checks_policy"
    ] = false;
    expect(rulesetGaps(lax, CHECK).join()).toContain("strict");
  });

  it("stage 1 does NOT demand status checks even when the rule is absent (evidence gate)", () => {
    const noRsc = liveFleetRuleset();
    noRsc.rules = noRsc.rules!.filter((r) => r.type !== "required_status_checks");
    expect(rulesetGaps(noRsc, null)).toEqual([]);
  });

  it("STRONGER-than-floor shapes are NOT gaps: extra rules, hardened params, ~ALL conditions", () => {
    const hardened = liveFleetRuleset();
    hardened.rules!.push({ type: "required_linear_history" });
    hardened.rules!.find((r) => r.type === "pull_request")!.parameters![
      "required_review_thread_resolution"
    ] = true;
    hardened.conditions = { ref_name: { include: ["~ALL"], exclude: [] } };
    expect(rulesetGaps(hardened, CHECK)).toEqual([]);
  });
});

describe("healRuleset", () => {
  it("heals bypass actors to empty while preserving everything else verbatim", () => {
    const drifted = liveFleetRuleset({
      bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
    });
    const healed = healRuleset(drifted, CHECK);
    expect(healed.bypass_actors).toEqual([]);
    expect(healed.rules).toEqual(liveFleetRuleset().rules);
    expect(healed.name).toBe(FLEET_RULESET_NAME);
  });

  it("NEVER WEAKENS: hand-hardening and extra rules survive healing", () => {
    const hardened = liveFleetRuleset({ enforcement: "disabled" }); // the one gap
    hardened.rules!.push({ type: "required_linear_history" });
    const pr = hardened.rules!.find((r) => r.type === "pull_request")!;
    pr.parameters!["required_review_thread_resolution"] = true;
    pr.parameters!["required_approving_review_count"] = 1;

    const healed = healRuleset(hardened, CHECK);
    expect(healed.enforcement).toBe("active");
    expect(ruleTypes(healed.rules)).toContain("required_linear_history");
    const healedPr = healed.rules.find((r) => r.type === "pull_request")!;
    expect(healedPr.parameters?.["required_review_thread_resolution"]).toBe(true);
    expect(healedPr.parameters?.["required_approving_review_count"]).toBe(1);
  });

  it("UNIONS the required context — other repos' existing contexts survive (never replace)", () => {
    const other = liveFleetRuleset();
    other.rules!.find((r) => r.type === "required_status_checks")!.parameters![
      "required_status_checks"
    ] = [{ context: "build" }];
    const healed = healRuleset(other, CHECK);
    const rsc = healed.rules.find((r) => r.type === "required_status_checks")!;
    expect(rsc.parameters?.["required_status_checks"]).toEqual([
      { context: "build" },
      { context: CHECK },
    ]);
  });

  it("stage 1 heal does not ADD a status-check rule, and does not STRIP an existing one", () => {
    const bare = liveFleetRuleset({ bypass_actors: [{}], rules: [] });
    expect(ruleTypes(healRuleset(bare, null).rules)).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
    ]);

    const withRsc = liveFleetRuleset({ bypass_actors: [{}] });
    expect(ruleTypes(healRuleset(withRsc, null).rules)).toContain("required_status_checks");
  });

  it("adds missing rules to an empty ruleset with the canonical defaults", () => {
    const empty = liveFleetRuleset({ rules: [] });
    const healed = healRuleset(empty, CHECK);
    expect(ruleTypes(healed.rules)).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    const pr = healed.rules.find((r) => r.type === "pull_request")!;
    expect(pr.parameters?.["required_approving_review_count"]).toBe(0);
  });

  it("preserves extra ref includes/excludes and only appends ~DEFAULT_BRANCH when uncovered", () => {
    const scoped = liveFleetRuleset({
      conditions: { ref_name: { include: ["refs/heads/release"], exclude: ["refs/heads/tmp/*"] } },
    });
    const healed = healRuleset(scoped, null);
    expect(healed.conditions.ref_name.include).toEqual(["refs/heads/release", "~DEFAULT_BRANCH"]);
    expect(healed.conditions.ref_name.exclude).toEqual(["refs/heads/tmp/*"]);

    const covered = healRuleset(liveFleetRuleset(), null);
    expect(covered.conditions.ref_name.include).toEqual(["~DEFAULT_BRANCH"]);
  });

  it("healing the live shape round-trips it unchanged (idempotent payload)", () => {
    const healed = healRuleset(liveFleetRuleset(), CHECK);
    expect(healed.rules).toEqual(liveFleetRuleset().rules);
    expect(rulesetGaps({ id: 1, ...healed }, CHECK)).toEqual([]);
  });

  it("does not mutate its input (pure)", () => {
    const input = liveFleetRuleset({ bypass_actors: [{ actor_id: 5 }] });
    const snapshot = JSON.parse(JSON.stringify(input));
    healRuleset(input, CHECK);
    expect(input).toEqual(snapshot);
  });
});
