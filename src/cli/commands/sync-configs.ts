import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syncConfigs } from "../../recipes/sync-configs.js";
import { ALL_TEMPLATES, templatesByName } from "../../recipes/sync-configs/templates.js";
import type { ConfigName, RecipeResult } from "../../types.js";

export type SyncConfigsCommandOptions = {
  only?: string;
  dry?: boolean;
};

function parseOnly(value?: string): ConfigName[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => s.trim()) as ConfigName[];
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
    if (existing !== t.contents) {
      lines.push(`would update ${t.path} (config: ${t.config})`);
    }
  }
  if (lines.length === 0) return "no changes needed";
  return lines.join("\n");
}

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `noop: ${r.notes ?? "all configs in sync"}`;
  return `applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runSyncConfigsCommand(
  site: string | undefined,
  opts: SyncConfigsCommandOptions,
): Promise<{ output: string; code: number }> {
  const sitePath = resolve(site ?? process.cwd());
  const which = parseOnly(opts.only);

  if (opts.dry) {
    const output = await dryPlan(sitePath, which);
    return { output, code: 0 };
  }

  const result = await syncConfigs({ path: sitePath }, which ? { which } : {});
  return { output: formatResult(result), code: result.status === "failed" ? 1 : 0 };
}
