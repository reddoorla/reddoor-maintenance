import { resolve } from "node:path";
import { upgradeSvelte4to5 } from "../../recipes/svelte-5/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

const KNOWN_UPGRADES = new Set(["svelte-4-to-5"]);

export type UpgradeCommandOptions = {
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runUpgradeCommand(
  upgradeName: string | undefined,
  site: string | undefined,
  opts: UpgradeCommandOptions = {},
): Promise<{ output: string; code: number }> {
  if (!upgradeName || !KNOWN_UPGRADES.has(upgradeName)) {
    throw Object.assign(
      new Error(
        `unknown upgrade: ${upgradeName ?? "(none)"}. expected one of ${[...KNOWN_UPGRADES].join(", ")}`,
      ),
      { exitCode: 2 },
    );
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  // `upgradeName` is validated against KNOWN_UPGRADES above (throws otherwise),
  // so the only reachable upgrade here is the svelte-4-to-5 recipe.
  const results = await runRecipeOverSites("svelte-4-to-5", sites, (s) => upgradeSvelte4to5(s));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
