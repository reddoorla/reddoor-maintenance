import { resolve } from "node:path";
import { svelteCodemods } from "../../recipes/svelte-codemods.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type SvelteCodemodsCommandOptions = {
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runSvelteCodemodsCommand(
  site: string | undefined,
  opts: SvelteCodemodsCommandOptions,
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

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await svelteCodemods(s));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
