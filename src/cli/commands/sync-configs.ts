import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syncConfigs } from "../../recipes/sync-configs.js";
import { ALL_TEMPLATES, templatesByName } from "../../recipes/sync-configs/templates.js";
import type { ConfigName, RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

export type SyncConfigsCommandOptions = {
  only?: string;
  dry?: boolean;
  fleet?: string;
  workdir?: string;
};

function parseOnly(value?: string): ConfigName[] | undefined {
  return value ? (value.split(",").map((s) => s.trim()) as ConfigName[]) : undefined;
}

async function dryPlan(cwd: string, which?: ConfigName[]): Promise<string> {
  const targets = which ? templatesByName(which) : ALL_TEMPLATES;
  const lines: string[] = [];
  for (const t of targets) {
    let existing = "";
    try {
      existing = await readFile(join(cwd, t.path), "utf-8");
    } catch {
      // missing file => will be created
    }
    if (existing !== t.contents) lines.push(`would update ${t.path} (config: ${t.config})`);
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

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
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
