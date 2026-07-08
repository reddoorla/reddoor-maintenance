import { resolve } from "node:path";
import { bumpDeps, type BumpDepsGroup } from "../../recipes/bump-deps.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

const GROUPS: BumpDepsGroup[] = ["patch", "minor", "major"];

export type BumpDepsCommandOptions = {
  group?: string;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runBumpDepsCommand(
  site: string | undefined,
  opts: BumpDepsCommandOptions,
): Promise<{ output: string; code: number }> {
  const group = (opts.group ?? "minor") as BumpDepsGroup;
  if (!GROUPS.includes(group)) {
    throw Object.assign(
      new Error(`unknown --group: ${group}. expected one of ${GROUPS.join(", ")}`),
      { exitCode: 2 },
    );
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  const results = await runRecipeOverSites("bump-deps", sites, (s) => bumpDeps(s, { group }));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
