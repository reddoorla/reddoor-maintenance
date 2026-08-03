import { describe, it, expect } from "vitest";
import {
  collectProtectionCoverage,
  partitionAcceptedGaps,
  renovateGaps,
  secretScanningGaps,
  ACCEPTED_GAPS,
  RENOVATE_WORKFLOW_FILE,
  type AcceptedGap,
  type ProtectionCoverageDeps,
} from "../../src/audits/protection-coverage.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import type { ExistingRuleset } from "../../src/github/rulesets.js";
import type { WorkflowHealth } from "../../src/github/gh.js";

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
): ProtectionCoverageDeps & { healthCalls: string[] } {
  const healthCalls: string[] = [];
  return {
    healthCalls,
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
    // The real ACCEPTED_GAPS list covers reddoorla/reddoor-maintenance's
    // missing renovate workflow until the operator's supply-chain call.
    const deps = makeDeps(
      [{ name: "reddoor-maintenance" }],
      { "reddoorla/reddoor-maintenance": [sound(1)] },
      { "reddoorla/reddoor-maintenance": { present: false } },
    );
    const rows = await collectProtectionCoverage(ORG, deps, NOW);
    expect(rows[0]!.status).toBe("skipped");
    expect(rows[0]!.detail).toContain("no renovate workflow");
    expect(rows[0]!.detail).toContain("accepted until 2026-08-16");
    expect(rows[0]!.detail).toContain("operator decision pending");
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
