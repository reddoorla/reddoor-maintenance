import { resolve } from "node:path";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { selfUpdating } from "../../recipes/self-updating/index.js";
import { formatRecipeResult } from "../fleet/format-recipe-result.js";

export type SelfUpdatingCommandOptions = {
  fleet?: string;
  workdir?: string;
  dry?: boolean;
  cwd?: string;
};

export async function runSelfUpdatingCommand(
  site: string | undefined,
  opts: SelfUpdatingCommandOptions,
): Promise<{ output: string; code: number }> {
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

  if (opts.dry) {
    return {
      output: appendSkipNotice(
        sites.map((s) => `[${s.name || s.path}] would enable self-updating`).join("\n"),
        skipped,
      ),
      code: 0,
    };
  }

  const results = await runRecipeOverSites("self-updating", sites, (s) => selfUpdating(s));

  return {
    output: appendSkipNotice(
      results
        .map((r) =>
          formatRecipeResult(r, { noopNote: "already self-updating", commitCount: false }),
        )
        .join("\n"),
      skipped,
    ),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
