import { upgradeSvelte4to5 } from "../../recipes/svelte-5/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

const KNOWN_UPGRADES = new Set(["svelte-4-to-5"]);

export type UpgradeCommandOptions = {
  fleet?: string;
  workdir?: string;
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

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: RecipeResult[] = [];
  for (const s of sites) {
    if (upgradeName === "svelte-4-to-5") {
      results.push(await upgradeSvelte4to5(s));
    }
  }

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output, code };
}
