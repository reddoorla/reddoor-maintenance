import { resolve } from "node:path";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";
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

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  if (opts.dry) {
    return {
      output: sites.map((s) => `[${s.name ?? s.path}] would enable self-updating`).join("\n"),
      code: 0,
    };
  }

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await selfUpdating(s));

  return {
    output: results.map(formatResult).join("\n"),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
