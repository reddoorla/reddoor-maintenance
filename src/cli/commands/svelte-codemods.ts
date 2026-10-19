import { resolve } from "node:path";
import { svelteCodemods } from "../../recipes/svelte-codemods.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { formatRecipeResult } from "../fleet/format-recipe-result.js";

export type SvelteCodemodsCommandOptions = {
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

export async function runSvelteCodemodsCommand(
  site: string | undefined,
  opts: SvelteCodemodsCommandOptions,
): Promise<{ output: string; code: number }> {
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

  const results = await runRecipeOverSites("svelte-codemods", sites, (s) => svelteCodemods(s));

  const output = results.map((r) => formatRecipeResult(r)).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
