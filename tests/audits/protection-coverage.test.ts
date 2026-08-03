import { describe, it, expect } from "vitest";
import {
  collectProtectionCoverage,
  partitionAcceptedGaps,
  renovateGaps,
  renovateBlockedGaps,
  dashboardVocabularyGaps,
  resolveBlockedBranches,
  BLOCKED_STALE_DAYS,
  secretScanningGaps,
  ACCEPTED_GAPS,
  RENOVATE_WORKFLOW_FILE,
  type AcceptedGap,
  type ProtectionCoverageDeps,
} from "../../src/audits/protection-coverage.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import type { ExistingRuleset } from "../../src/github/rulesets.js";
import {
  parseBlockedBranches,
  parseUnknownSections,
  isMachineAuthor,
} from "../../src/github/gh.js";
import type { BranchTip, DependencyDashboard, WorkflowHealth } from "../../src/github/gh.js";

const ORG = "reddoorla";
const NOW = new Date("2026-08-02T18:00:00Z");
const FRESH_RUN = "2026-08-02T13:00:00Z"; // hours old — well inside the window

function sound(id: number, check: string | null = "ci / ci"): ExistingRuleset {
  return { ...desiredRuleset(check), id };
}

type RepoRow = {
  name: string;
  visibility?: string;
  archived?: boolean;
  secretScanning?: string;
  pushProtection?: string;
};

function makeDeps(
  repos: RepoRow[],
  rulesetsByRepo: Record<string, ExistingRuleset[]>,
  healthByRepo: Record<string, WorkflowHealth> = {},
  dashboardByRepo: Record<string, DependencyDashboard> = {},
  // Default tip: a machine author, i.e. an orphan. Blocked branches in these
  // fixtures stand for the August 2026 incident unless a test says otherwise.
  tipByBranch: Record<string, BranchTip | null> = {},
): ProtectionCoverageDeps & { healthCalls: string[] } {
  const healthCalls: string[] = [];
  return {
    healthCalls,
    dependencyDashboard: async (repo) =>
      dashboardByRepo[repo] ?? { present: true, blockedBranches: [], unknownSections: [] },
    branchTip: async (_repo, branch) =>
      branch in tipByBranch
        ? tipByBranch[branch]!
        : { authorIsMachine: true, committedAt: FRESH_RUN },
    listOrgRepos: async () =>
      repos.map((r) => ({
        name: r.name,
        visibility: r.visibility ?? "public",
        archived: r.archived ?? false,
        secretScanning: r.secretScanning ?? "enabled",
        pushProtection: r.pushProtection ?? "enabled",
      })),
    listRepoRulesets: async (repo) =>
      (rulesetsByRepo[repo] ?? []).map((rs) => ({ id: rs.id, name: rs.name })),
    getRuleset: async (repo, id) => {
      const found = (rulesetsByRepo[repo] ?? []).find((rs) => rs.id === id);
      if (!found) throw new Error(`no ruleset ${id} on ${repo}`);
      return found;
    },
    workflowHealth: async (repo, filename) => {
      healthCalls.push(`${repo}:${filename}`);
      return healthByRepo[repo] ?? { present: true, state: "active", lastSuccessAt: FRESH_RUN };
    },
  };
}

describe("collectProtectionCoverage", () => {
  it("a sound fleet ruleset is covered; the CI gate is reported, not judged", async () => {
    const deps = makeDeps([{ name: "espada" }, { name: "dotgithub" }], {
      "reddoorla/espada": [sound(1)],
      "reddoorla/dotgithub": [sound(2, null)], // refs rules only — .github's legitimate state
    });
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows).toEqual([
      { repo: "reddoorla/espada", status: "covered", detail: `"${FLEET_RULESET_NAME}"` },
      {
        repo: "reddoorla/dotgithub",
        status: "covered",
        detail: `"${FLEET_RULESET_NAME}" — NO CI gate (refs rules only)`,
      },
    ]);
    expect(deps.healthCalls).toEqual([
      `reddoorla/espada:${RENOVATE_WORKFLOW_FILE}`,
      `reddoorla/dotgithub:${RENOVATE_WORKFLOW_FILE}`,
    ]);
  });

  it("coverage is judged by SHAPE, not name — a differently-named sound ruleset counts", async () => {
    const mainProtection = { ...sound(9, null), name: "Main Protection" };
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps([{ name: "reddoor-maintenance" }], {
        "reddoorla/reddoor-maintenance": [mainProtection],
      }),
      NOW,
    );
    expect(rows[0]!.status).toBe("covered");
    expect(rows[0]!.detail).toContain("Main Protection");
  });

  it("no rulesets at all is a gap", async () => {
    const rows = await collectProtectionCoverage(ORG, makeDeps([{ name: "fresh-site" }], {}), NOW);
    expect(rows).toEqual([
      { repo: "reddoorla/fresh-site", status: "gap", detail: "no repo rulesets at all" },
    ]);
  });

  it("a ruleset with a bypass actor is a gap, with the gap named per ruleset", async () => {
    const armed = { ...sound(3), bypass_actors: [{ actor_id: 5 }] };
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps([{ name: "espada" }], { "reddoorla/espada": [armed] }),
      NOW,
    );
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("bypass actor");
    expect(rows[0]!.detail).toContain(FLEET_RULESET_NAME);
  });

  it("secret scanning or push protection off is a gap even with a sound ruleset", async () => {
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps(
        [
          { name: "espada", secretScanning: "disabled" },
          { name: "hedloc", pushProtection: "disabled" },
        ],
        { "reddoorla/espada": [sound(1)], "reddoorla/hedloc": [sound(2)] },
      ),
      NOW,
    );
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("secret scanning disabled");
    expect(rows[1]!.status).toBe("gap");
    expect(rows[1]!.detail).toContain("push protection disabled");
  });

  it("an unreadable secret-scanning state is a gap, never fine", () => {
    expect(
      secretScanningGaps({ secretScanning: "unavailable", pushProtection: "unavailable" }),
    ).toHaveLength(2);
  });

  it("a dead renovate workflow is a gap: absent, disabled, never-run, or stale", async () => {
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps(
        [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
        {
          "reddoorla/a": [sound(1)],
          "reddoorla/b": [sound(2)],
          "reddoorla/c": [sound(3)],
          "reddoorla/d": [sound(4)],
        },
        {
          "reddoorla/a": { present: false },
          "reddoorla/b": { present: true, state: "disabled_inactivity", lastSuccessAt: FRESH_RUN },
          "reddoorla/c": { present: true, state: "active", lastSuccessAt: null },
          // 5 days quiet at a twice-daily cron = 10 missed runs, never jitter.
          "reddoorla/d": { present: true, state: "active", lastSuccessAt: "2026-07-28T13:00:00Z" },
        },
      ),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(["gap", "gap", "gap", "gap"]);
    expect(rows[0]!.detail).toContain("no renovate workflow");
    expect(rows[1]!.detail).toContain("disabled_inactivity");
    expect(rows[2]!.detail).toContain("never succeeded");
    expect(rows[3]!.detail).toContain("last succeeded 5d ago");
    // The disabled-state heal advice must lead with re-ENABLING — a disabled
    // workflow rejects dispatches (HTTP 403), so "dispatch it" alone dead-ends.
    expect(rows[1]!.detail).toContain("re-enable");
  });

  it("a success inside the 3-day window is NOT stale", () => {
    expect(
      renovateGaps({ present: true, state: "active", lastSuccessAt: "2026-07-31T06:00:00Z" }, NOW),
    ).toEqual([]);
  });

  it("an unparseable last-success timestamp is a gap, never fresh", () => {
    // Without the NaN guard, NaN > threshold is false and garbage reads as
    // healthy — the exact couldn't-verify-is-fine hole this sweep must not have.
    const gaps = renovateGaps({ present: true, state: "active", lastSuccessAt: "garbage" }, NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("unreadable");
  });

  it("gap reasons from every surface combine into one row", async () => {
    const armed = { ...sound(3), bypass_actors: [{ actor_id: 5 }] };
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps(
        [{ name: "espada", secretScanning: "disabled" }],
        { "reddoorla/espada": [armed] },
        { "reddoorla/espada": { present: false } },
      ),
      NOW,
    );
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("bypass actor");
    expect(rows[0]!.detail).toContain("secret scanning disabled");
    expect(rows[0]!.detail).toContain("no renovate workflow");
  });

  it("private and archived repos are skipped, never gaps — and never probed", async () => {
    const deps = makeDeps(
      [
        { name: "the-tower", visibility: "private", secretScanning: "disabled" },
        { name: "reddoor-test", visibility: "private", archived: true },
      ],
      {},
    );
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(deps.healthCalls).toEqual([]);
  });

  it("a probe failure is a GAP (couldn't-verify must never read as fine), and doesn't sink the sweep", async () => {
    const deps = makeDeps([{ name: "flaky" }, { name: "espada" }], {
      "reddoorla/espada": [sound(1)],
    });
    deps.listRepoRulesets = async (repo) => {
      if (repo === "reddoorla/flaky") throw new Error("api 500");
      return [{ id: 1, name: FLEET_RULESET_NAME }];
    };
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows[0]).toEqual({
      repo: "reddoorla/flaky",
      status: "gap",
      detail: "probe failed: api 500",
    });
    expect(rows[1]!.status).toBe("covered");
  });

  it("a workflowHealth throw is a gap too (same contract as ruleset probes)", async () => {
    const deps = makeDeps([{ name: "espada" }], { "reddoorla/espada": [sound(1)] });
    deps.workflowHealth = async () => {
      throw new Error("HTTP 500");
    };
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("probe failed");
  });

  it("an accepted gap reports as SKIPPED with reason+expiry — never covered, never a nightly alarm", async () => {
    const deps = makeDeps(
      [{ name: "x" }],
      { "reddoorla/x": [sound(1)] },
      { "reddoorla/x": { present: false } },
    );
    const ack: AcceptedGap = {
      repo: "reddoorla/x",
      detailPrefix: "no renovate workflow",
      reason: "pending decision",
      until: "2026-08-16",
    };
    const rows = await collectProtectionCoverage(ORG, deps, NOW, [ack]);
    expect(rows[0]!.status).toBe("skipped");
    expect(rows[0]!.detail).toContain("no renovate workflow");
    expect(rows[0]!.detail).toContain("accepted until 2026-08-16");
    expect(rows[0]!.detail).toContain("pending decision");
  });
});

describe("partitionAcceptedGaps", () => {
  const RENOVATE_ACK: AcceptedGap = {
    repo: "reddoorla/x",
    detailPrefix: "no renovate workflow",
    reason: "pending decision",
    until: "2026-08-16",
  };

  it("acceptance is surface-scoped: other gaps on the same repo stay LIVE", () => {
    const { live, accepted } = partitionAcceptedGaps(
      "reddoorla/x",
      ["no renovate workflow (dependency updates never run here)", "secret scanning disabled"],
      NOW,
      [RENOVATE_ACK],
    );
    expect(live).toEqual(["secret scanning disabled"]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toContain("[accepted until 2026-08-16: pending decision]");
  });

  it("acceptance is repo-scoped: the same gap on another repo stays live", () => {
    const { live, accepted } = partitionAcceptedGaps(
      "reddoorla/y",
      ["no renovate workflow (dependency updates never run here)"],
      NOW,
      [RENOVATE_ACK],
    );
    expect(live).toHaveLength(1);
    expect(accepted).toEqual([]);
  });

  it("acceptance EXPIRES: past `until` the gap returns on its own", () => {
    const { live, accepted } = partitionAcceptedGaps(
      "reddoorla/x",
      ["no renovate workflow (dependency updates never run here)"],
      new Date("2026-08-16T00:00:00Z"), // expiry day — already live again
      [RENOVATE_ACK],
    );
    expect(live).toHaveLength(1);
    expect(accepted).toEqual([]);
  });

  it("every real ACCEPTED_GAPS entry is well-formed: parseable expiry, non-empty scope", () => {
    for (const a of ACCEPTED_GAPS) {
      expect(Number.isNaN(Date.parse(a.until)), `${a.repo} until`).toBe(false);
      expect(a.repo).toMatch(/^reddoorla\//);
      expect(a.detailPrefix.length).toBeGreaterThan(0);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });
});

/** Shape of a real blocked dashboard, trimmed to the sections that matter and
 *  with each marker TYPE as Renovate actually emits it: `unschedule-branch=`
 *  under "Awaiting Schedule", `rebase-branch=` under both "Open" and the
 *  blocked section. "Open" is the one that makes section-scoping load-bearing
 *  — 11 fleet repos carry healthy `rebase-branch=` markers there right now, so
 *  a body-wide grep would report all of them as blocked. */
const REAL_DASHBOARD_BODY = `This issue lists Renovate updates and detected dependencies.

## Awaiting Schedule

The following updates are awaiting their schedule.

 - [ ] <!-- unschedule-branch=renovate/cookie-0.7.0-1.x -->chore(deps): update dependency cookie to v1
 - [ ] <!-- unschedule-branch=renovate/typescript-6.x -->chore(deps): update typescript
 - [ ] <!-- create-all-awaiting-schedule-prs -->🔐 Create all awaiting schedule PRs at once 🔐

## PR Edited (Blocked)

The following updates have been manually edited so Renovate will no longer make changes.

 - [ ] <!-- rebase-branch=renovate/all-minor-patch -->fix(deps): update all non-major dependencies (\`@reddoorla/maintenance\`, \`vite\`)
 - [ ] <!-- rebase-branch=renovate/kit-2.x -->chore(deps): update kit

## Open

The following updates have all been created. To force a retry/rebase of any, click on a checkbox below.

 - [ ] <!-- rebase-branch=renovate/jsdom-30.x -->chore(deps): update dependency jsdom to v30
 - [ ] <!-- rebase-all-open-prs -->**Click on this checkbox to rebase all open PRs at once**

## Detected Dependencies

 - \`@reddoorla/maintenance ^0.75.0\` → [Updates: \`^0.79.0\`]
`;

describe("parseBlockedBranches", () => {
  it("extracts only the branches under the PR Edited (Blocked) heading", () => {
    expect(parseBlockedBranches(REAL_DASHBOARD_BODY)).toEqual([
      "renovate/all-minor-patch",
      "renovate/kit-2.x",
    ]);
  });

  it("a healthy dashboard whose ONLY rebase markers are under Open yields nothing", () => {
    // The live shape of 11 fleet repos. Drop just the blocked section; the
    // `rebase-branch=` marker under "Open" must not be mistaken for a freeze.
    const healthy = REAL_DASHBOARD_BODY.replace(/## PR Edited \(Blocked\)[\s\S]*?(?=## Open)/, "");
    expect(healthy).toContain("rebase-branch=renovate/jsdom-30.x");
    expect(parseBlockedBranches(healthy)).toEqual([]);
  });

  it("reads the pre-43 heading too, so an older Renovate is not silently clean", () => {
    // Renovate renamed this section in 43.0.0. The fleet's major follows
    // whatever renovatebot/github-action bakes in, so both must parse.
    const legacy = REAL_DASHBOARD_BODY.replace("## PR Edited (Blocked)", "## Edited/Blocked");
    expect(parseBlockedBranches(legacy)).toEqual(["renovate/all-minor-patch", "renovate/kit-2.x"]);
  });

  it("a `###` category subheading does NOT close the blocked section", () => {
    // Renovate emits `### <category>` INSIDE a section when
    // dependencyDashboardCategory is set; treating it as a boundary would
    // truncate the blocked list to nothing.
    expect(
      parseBlockedBranches(
        "## PR Edited (Blocked)\n### npm\n - [ ] <!-- rebase-branch=a -->x\n### Others\n - [ ] <!-- rebase-branch=b -->y\n## Open\n - [ ] <!-- rebase-branch=c -->z",
      ),
    ).toEqual(["a", "b"]);
  });

  it("the next heading closes the section", () => {
    expect(
      parseBlockedBranches(
        "## PR Edited (Blocked)\n - [ ] <!-- rebase-branch=a -->x\n## Open\n - [ ] <!-- rebase-branch=b -->y",
      ),
    ).toEqual(["a"]);
  });

  it("dedupes across the joined bodies of multiple dashboards", () => {
    const doubled = `${REAL_DASHBOARD_BODY}\n# ---\n${REAL_DASHBOARD_BODY}`;
    expect(parseBlockedBranches(doubled)).toEqual(["renovate/all-minor-patch", "renovate/kit-2.x"]);
  });

  it("empty body is not blocked", () => {
    expect(parseBlockedBranches("")).toEqual([]);
  });
});

describe("parseUnknownSections", () => {
  it("a real dashboard uses only headings we know", () => {
    expect(parseUnknownSections(REAL_DASHBOARD_BODY)).toEqual([]);
  });

  it("both the pre-43 and post-43 blocked spellings are known vocabulary", () => {
    expect(parseUnknownSections("## Edited/Blocked\n## Ignored or Blocked")).toEqual([]);
    expect(parseUnknownSections("## PR Edited (Blocked)\n## PR Closed (Blocked)")).toEqual([]);
  });

  it("reports a heading Renovate is not known to emit", () => {
    expect(parseUnknownSections(`${REAL_DASHBOARD_BODY}\n## Frozen Updates\n`)).toEqual([
      "Frozen Updates",
    ]);
  });

  it("ignores the `# ---` join separator and `###` subheadings", () => {
    expect(parseUnknownSections("# ---\n### npm\n### Others")).toEqual([]);
  });
});

describe("isMachineAuthor", () => {
  it("the App identity is a machine (GitHub type Bot)", () => {
    expect(
      isMachineAuthor({
        type: "Bot",
        login: "reddoor-renovate[bot]",
        email: "312185038+reddoor-renovate[bot]@users.noreply.github.com",
        name: "reddoor-renovate[bot]",
      }),
    ).toBe(true);
  });

  it("REGRESSION: the retired `renovate-bot` PAT identity is a machine despite type User", () => {
    // This is the identity whose orphaned branches froze nine repos. GitHub
    // reports it as type `User`, so a rule keyed on the Bot type alone would
    // have missed the exact incident this audit exists to catch.
    expect(
      isMachineAuthor({
        type: "User",
        login: "renovate-bot",
        email: "renovate-bot@whitesourcesoftware.com",
        name: "Renovate Bot",
      }),
    ).toBe(true);
  });

  it("a human operator is not a machine", () => {
    expect(
      isMachineAuthor({
        type: "User",
        login: "tucksravin",
        email: "43099664+tucksravin@users.noreply.github.com",
        name: "Tucker Lemos",
      }),
    ).toBe(false);
  });
});

describe("dashboardVocabularyGaps", () => {
  it("known vocabulary is not a gap", () => {
    expect(
      dashboardVocabularyGaps({ present: true, blockedBranches: [], unknownSections: [] }),
    ).toEqual([]);
  });

  it("an absent dashboard cannot have drifted", () => {
    expect(dashboardVocabularyGaps({ present: false })).toEqual([]);
  });

  it("REGRESSION: unrecognised vocabulary is a gap, so a rename cannot silently clean the fleet", () => {
    const [gap] = dashboardVocabularyGaps({
      present: true,
      blockedBranches: [],
      unknownSections: ["Frozen Updates"],
    });
    expect(gap).toContain("Frozen Updates");
    expect(gap).toMatch(/no longer be trusted/i);
  });
});

describe("resolveBlockedBranches", () => {
  const tip = (over: Partial<BranchTip>): BranchTip => ({
    authorIsMachine: true,
    committedAt: FRESH_RUN,
    ...over,
  });
  const deps = (t: BranchTip | null) => ({ branchTip: async () => t });
  const dash = (branches: string[]): DependencyDashboard => ({
    present: true,
    blockedBranches: branches,
    unknownSections: [],
  });

  it("a machine-authored tip is an orphan immediately — nothing will ever clear it", async () => {
    const got = await resolveBlockedBranches(
      ORG,
      dash(["renovate/all-minor-patch"]),
      deps(tip({})),
      NOW,
    );
    expect(got).toEqual([{ branch: "renovate/all-minor-patch", orphaned: true }]);
  });

  it("REGRESSION: a human's in-flight branch is NOT a gap — routine fleet practice", async () => {
    // Pushing a commit onto an open Renovate PR makes Renovate file it under
    // "PR Edited (Blocked)". That heading means "a human owns this now", not a
    // fault, and the remediation would delete their commits.
    const got = await resolveBlockedBranches(
      ORG,
      dash(["renovate/jsdom-30.x"]),
      deps(tip({ authorIsMachine: false })),
      NOW,
    );
    expect(got).toEqual([{ branch: "renovate/jsdom-30.x", orphaned: false }]);
    expect(renovateBlockedGaps(got)).toEqual([]);
  });

  it("a human's branch left past the stale window IS a gap — the backstop", async () => {
    const stale = new Date(NOW.getTime() - (BLOCKED_STALE_DAYS + 1) * 86_400_000).toISOString();
    const got = await resolveBlockedBranches(
      ORG,
      dash(["renovate/jsdom-30.x"]),
      deps(tip({ authorIsMachine: false, committedAt: stale })),
      NOW,
    );
    expect(got[0]!.orphaned).toBe(true);
  });

  it("a branch that no longer exists is not a gap — that is a stale dashboard", async () => {
    expect(await resolveBlockedBranches(ORG, dash(["renovate/gone"]), deps(null), NOW)).toEqual([]);
  });
});

describe("renovateBlockedGaps", () => {
  it("nothing blocked is clean", () => {
    expect(renovateBlockedGaps([])).toEqual([]);
  });

  it("names every orphaned branch and tells the reader how to unblock it", () => {
    const [gap] = renovateBlockedGaps([
      { branch: "renovate/all-minor-patch", orphaned: true },
      { branch: "renovate/jsdom-30.x", orphaned: false },
    ]);
    expect(gap).toContain("renovate/all-minor-patch");
    // the human-owned branch is not named, and does not inflate the count
    expect(gap).not.toContain("renovate/jsdom-30.x");
    expect(gap).toContain("1 branch(es)");
    expect(gap).toContain("BLOCKED");
    expect(gap).toMatch(/delete the branch/i);
  });
});

describe("effectiveness is judged separately from liveness", () => {
  it("REGRESSION: a green, fresh renovate run is still a gap when a branch is blocked", async () => {
    // The exact August 2026 shape: workflow active, succeeded hours ago —
    // liveness is spotless — yet updates were frozen for a week.
    const deps = makeDeps(
      [{ name: "alamo-anatomy" }],
      { "reddoorla/alamo-anatomy": [sound(1)] },
      { "reddoorla/alamo-anatomy": { present: true, state: "active", lastSuccessAt: FRESH_RUN } },
      {
        "reddoorla/alamo-anatomy": {
          present: true,
          blockedBranches: ["renovate/all-minor-patch"],
          unknownSections: [],
        },
      },
    );
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("renovate/all-minor-patch");
    // and liveness itself reported nothing wrong
    expect(renovateGaps({ present: true, state: "active", lastSuccessAt: FRESH_RUN }, NOW)).toEqual(
      [],
    );
  });

  it("a dashboard probe that THROWS is a gap, never a silent pass", async () => {
    const deps = makeDeps([{ name: "espada" }], { "reddoorla/espada": [sound(1)] });
    deps.dependencyDashboard = async () => {
      throw new Error("boom");
    };
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("probe failed");
  });
});
