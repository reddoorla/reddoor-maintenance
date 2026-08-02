import { describe, it, expect } from "vitest";
import {
  collectProtectionCoverage,
  type ProtectionCoverageDeps,
} from "../../src/audits/protection-coverage.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import type { ExistingRuleset } from "../../src/github/rulesets.js";

const ORG = "reddoorla";

function sound(id: number, check: string | null = "ci / ci"): ExistingRuleset {
  return { ...desiredRuleset(check), id };
}

function makeDeps(
  repos: Array<{ name: string; visibility?: string; archived?: boolean }>,
  rulesetsByRepo: Record<string, ExistingRuleset[]>,
): ProtectionCoverageDeps {
  return {
    listOrgRepos: async () =>
      repos.map((r) => ({
        name: r.name,
        visibility: r.visibility ?? "public",
        archived: r.archived ?? false,
      })),
    listRepoRulesets: async (repo) =>
      (rulesetsByRepo[repo] ?? []).map((rs) => ({ id: rs.id, name: rs.name })),
    getRuleset: async (repo, id) => {
      const found = (rulesetsByRepo[repo] ?? []).find((rs) => rs.id === id);
      if (!found) throw new Error(`no ruleset ${id} on ${repo}`);
      return found;
    },
  };
}

describe("collectProtectionCoverage", () => {
  it("a sound fleet ruleset is covered; the CI gate is reported, not judged", async () => {
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps([{ name: "espada" }, { name: "dotgithub" }], {
        "reddoorla/espada": [sound(1)],
        "reddoorla/dotgithub": [sound(2, null)], // refs rules only — .github's legitimate state
      }),
    );
    expect(rows).toEqual([
      { repo: "reddoorla/espada", status: "covered", detail: `"${FLEET_RULESET_NAME}"` },
      {
        repo: "reddoorla/dotgithub",
        status: "covered",
        detail: `"${FLEET_RULESET_NAME}" — NO CI gate (refs rules only)`,
      },
    ]);
  });

  it("coverage is judged by SHAPE, not name — a differently-named sound ruleset counts", async () => {
    const mainProtection = { ...sound(9, null), name: "Main Protection" };
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps([{ name: "reddoor-maintenance" }], {
        "reddoorla/reddoor-maintenance": [mainProtection],
      }),
    );
    expect(rows[0]!.status).toBe("covered");
    expect(rows[0]!.detail).toContain("Main Protection");
  });

  it("no rulesets at all is a gap", async () => {
    const rows = await collectProtectionCoverage(ORG, makeDeps([{ name: "fresh-site" }], {}));
    expect(rows).toEqual([
      { repo: "reddoorla/fresh-site", status: "gap", detail: "no repo rulesets at all" },
    ]);
  });

  it("a ruleset with a bypass actor is a gap, with the gap named per ruleset", async () => {
    const armed = { ...sound(3), bypass_actors: [{ actor_id: 5 }] };
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps([{ name: "espada" }], { "reddoorla/espada": [armed] }),
    );
    expect(rows[0]!.status).toBe("gap");
    expect(rows[0]!.detail).toContain("bypass actor");
    expect(rows[0]!.detail).toContain(FLEET_RULESET_NAME);
  });

  it("private and archived repos are skipped, never gaps", async () => {
    const rows = await collectProtectionCoverage(
      ORG,
      makeDeps(
        [
          { name: "the-tower", visibility: "private" },
          { name: "reddoor-test", visibility: "private", archived: true },
        ],
        {},
      ),
    );
    expect(rows.map((r) => r.status)).toEqual(["skipped", "skipped"]);
  });

  it("a probe failure is a GAP (couldn't-verify must never read as fine), and doesn't sink the sweep", async () => {
    const deps = makeDeps([{ name: "flaky" }, { name: "espada" }], {
      "reddoorla/espada": [sound(1)],
    });
    deps.listRepoRulesets = async (repo) => {
      if (repo === "reddoorla/flaky") throw new Error("api 500");
      return [{ id: 1, name: FLEET_RULESET_NAME }];
    };
    const rows = await collectProtectionCoverage(ORG, deps);
    expect(rows[0]).toEqual({
      repo: "reddoorla/flaky",
      status: "gap",
      detail: "probe failed: api 500",
    });
    expect(rows[1]!.status).toBe("covered");
  });
});
