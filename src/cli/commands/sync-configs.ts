import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { syncConfigs, ALL_CONFIG_NAMES, isConfigName } from "../../recipes/sync-configs.js";
import { ALL_TEMPLATES, templatesByName } from "../../recipes/sync-configs/templates.js";
import {
  CANONICAL_GITIGNORE_ENTRIES,
  mergeGitignore,
} from "../../recipes/sync-configs/gitignore.js";
import type { ConfigName, RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type SyncConfigsCommandOptions = {
  only?: string;
  dry?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function parseOnly(value?: string): ConfigName[] | undefined {
  if (!value) return undefined;
  const names = value.split(",").map((s) => s.trim());
  for (const n of names) {
    if (!isConfigName(n)) {
      throw Object.assign(
        new Error(`unknown config in --only: "${n}". Valid: ${ALL_CONFIG_NAMES.join(", ")}`),
        { exitCode: 2 },
      );
    }
  }
  return names as ConfigName[];
}

async function dryPlanGitignore(cwd: string): Promise<string | null> {
  let existing: string | null;
  try {
    existing = await readFile(join(cwd, ".gitignore"), "utf-8");
  } catch {
    return "would create .gitignore";
  }
  const merge = mergeGitignore(existing, CANONICAL_GITIGNORE_ENTRIES);
  if (merge.added.length === 0) return null;
  return `would update .gitignore (${merge.added.length} canonical entries to add)`;
}

async function dryPlan(cwd: string, which?: ConfigName[]): Promise<string> {
  const includeGitignore = which ? which.includes("gitignore") : true;
  const templateTargets = which
    ? templatesByName(which.filter((c): c is ConfigName => c !== "gitignore"))
    : ALL_TEMPLATES;

  const lines: string[] = [];
  for (const t of templateTargets) {
    let existing = "";
    try {
      existing = await readFile(join(cwd, t.path), "utf-8");
    } catch {
      // missing file => will be created
    }
    if (existing !== t.contents) lines.push(`would update ${t.path} (config: ${t.config})`);
  }
  if (includeGitignore) {
    const gi = await dryPlanGitignore(cwd);
    if (gi) lines.push(gi);
  }
  return lines.length === 0 ? "no changes needed" : lines.join("\n");
}

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? "all configs in sync"}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runSyncConfigsCommand(
  site: string | undefined,
  opts: SyncConfigsCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd,
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  if (opts.dry) {
    const blocks: string[] = [];
    for (const s of sites) {
      blocks.push(`[${s.name ?? s.path}]\n` + (await dryPlan(s.path, which)));
    }
    return { output: blocks.join("\n\n"), code: 0 };
  }

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await syncConfigs(s, which ? { which } : {}));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output, code };
}
