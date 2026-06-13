import { resolve } from "node:path";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { selfUpdating } from "../../recipes/self-updating/index.js";
import type { RecipeResult } from "../../types.js";

export type SelfUpdatingCommandOptions = {
  fleet?: string;
  workdir?: string;
  dry?: boolean;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? "already self-updating"}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied\n${r.notes ?? ""}`;
}

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

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await selfUpdating(s));

  return {
    output: appendSkipNotice(results.map(formatResult).join("\n"), skipped),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
