import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site, ConfigName } from "../types.js";
import { ALL_TEMPLATES, templatesByName, type ConfigTemplate } from "./sync-configs/templates.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";

export type SyncConfigsOptions = {
  which?: ConfigName[];
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function planDiffs(cwd: string, templates: ConfigTemplate[]): Promise<ConfigTemplate[]> {
  const diffs: ConfigTemplate[] = [];
  for (const t of templates) {
    const existing = await readMaybe(join(cwd, t.path));
    if (existing !== t.contents) diffs.push(t);
  }
  return diffs;
}

export async function syncConfigs(
  site: Site,
  opts: SyncConfigsOptions = {},
): Promise<RecipeResult> {
  const label = siteLabel(site);
  const targets = opts.which ? templatesByName(opts.which) : ALL_TEMPLATES;

  const diffs = await planDiffs(site.path, targets);
  if (diffs.length === 0) {
    return {
      recipe: "sync-configs",
      site: label,
      status: "noop",
      commits: [],
      notes: "all targeted configs already match",
    };
  }

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("sync-configs");
  await createBranch(site.path, branch);

  const shas: string[] = [];
  for (const t of diffs) {
    await writeFile(join(site.path, t.path), t.contents, "utf-8");
    const sha = await commit(site.path, `chore: sync ${t.config} config from @reddoor/maintenance`);
    if (sha) shas.push(sha);
  }

  return {
    recipe: "sync-configs",
    site: label,
    status: "applied",
    commits: shas,
    notes: `branch: ${branch}`,
  };
}
