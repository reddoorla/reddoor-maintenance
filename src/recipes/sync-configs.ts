import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site, ConfigName } from "../types.js";
import { ALL_TEMPLATES, templatesByName, type ConfigTemplate } from "./sync-configs/templates.js";
import {
  CANONICAL_GITIGNORE_ENTRIES,
  mergeGitignore,
  findTrackedArtifacts,
} from "./sync-configs/gitignore.js";
import { listTrackedFiles, removeFromIndex } from "../util/git.js";
import { withRecipe } from "./_with-recipe.js";

export type SyncConfigsOptions = {
  which?: ConfigName[];
};

const GITIGNORE_CONFIG: ConfigName = "gitignore";

/** Runtime enumeration of every `ConfigName`. Mirror of the union in
 * `src/types.ts`. Used by CLI `--only` validation; a missing entry would
 * silently accept typos. The type-test in `tests/types.test.ts` guards
 * against drift between this array and the union. */
export const ALL_CONFIG_NAMES: ConfigName[] = [
  "lighthouse",
  "eslint",
  "prettier",
  "playwright-a11y",
  "svelte",
  "gitignore",
];

export function isConfigName(value: string): value is ConfigName {
  return (ALL_CONFIG_NAMES as string[]).includes(value);
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function planTemplateDiffs(
  cwd: string,
  templates: ConfigTemplate[],
): Promise<ConfigTemplate[]> {
  const diffs: ConfigTemplate[] = [];
  for (const t of templates) {
    const existing = await readMaybe(join(cwd, t.path));
    if (existing !== t.contents) diffs.push(t);
  }
  return diffs;
}

type GitignorePlan =
  | { kind: "noop" }
  | { kind: "apply"; content: string; toUntrack: string[]; added: string[] };

async function planGitignore(cwd: string): Promise<GitignorePlan> {
  const existing = await readMaybe(join(cwd, ".gitignore"));
  const merge = mergeGitignore(existing, CANONICAL_GITIGNORE_ENTRIES);
  const tracked = await listTrackedFiles(cwd);
  const toUntrack = findTrackedArtifacts(tracked, CANONICAL_GITIGNORE_ENTRIES);
  if (merge.added.length === 0 && toUntrack.length === 0) return { kind: "noop" };
  return { kind: "apply", content: merge.content, toUntrack, added: merge.added };
}

async function applyGitignore(
  cwd: string,
  plan: Extract<GitignorePlan, { kind: "apply" }>,
): Promise<void> {
  await writeFile(join(cwd, ".gitignore"), plan.content, "utf-8");
  if (plan.toUntrack.length > 0) {
    await removeFromIndex(cwd, plan.toUntrack);
  }
}

export async function syncConfigs(
  site: Site,
  opts: SyncConfigsOptions = {},
): Promise<RecipeResult> {
  const requested = opts.which ?? ALL_TEMPLATES.map((t) => t.config).concat(GITIGNORE_CONFIG);
  const templateNames = requested.filter((c): c is ConfigName => c !== GITIGNORE_CONFIG);
  const templates = templatesByName(templateNames);
  const includeGitignore = requested.includes(GITIGNORE_CONFIG);

  return withRecipe({
    name: "sync-configs",
    site,
    plan: async () => {
      const templateDiffs = await planTemplateDiffs(site.path, templates);
      const gitignorePlan: GitignorePlan = includeGitignore
        ? await planGitignore(site.path)
        : { kind: "noop" };
      if (templateDiffs.length === 0 && gitignorePlan.kind === "noop") {
        return { kind: "noop", notes: "all targeted configs already match" };
      }
      return { kind: "apply", plan: { templateDiffs, gitignorePlan } };
    },
    apply: async ({ templateDiffs, gitignorePlan }, { commit }) => {
      for (const t of templateDiffs) {
        await writeFile(join(site.path, t.path), t.contents, "utf-8");
        await commit(`chore: sync ${t.config} config from @reddoorla/maintenance`);
      }
      if (gitignorePlan.kind === "apply") {
        await applyGitignore(site.path, gitignorePlan);
        await commit(`chore: sync gitignore from @reddoorla/maintenance`);
      }
      return { kind: "ok" };
    },
  });
}
