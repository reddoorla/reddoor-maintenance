import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";
import { planGotchaCodemods } from "./svelte-5/step-gotchas.js";

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

/**
 * Standalone codemod pass for sites already on Svelte 5.
 *
 * Applies the same gotcha codemods the full `svelte-4-to-5` migration runs,
 * but skips the version checks and migration steps — useful when Svelte 5
 * surfaces new strictness warnings post-upgrade (e.g. `state_referenced_locally`)
 * and the fleet needs a clean re-application.
 *
 * Plans changes in memory first; only creates the branch + writes + commits
 * when there is something to apply. Re-runs against a clean tree are noop.
 */
export async function svelteCodemods(site: Site): Promise<RecipeResult> {
  const label = siteLabel(site);

  const changes = await planGotchaCodemods(site.path);
  if (changes.length === 0) {
    return {
      recipe: "svelte-codemods",
      site: label,
      status: "noop",
      commits: [],
      notes: "no codemod targets matched",
    };
  }

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("svelte-codemods");
  await createBranch(site.path, branch);

  for (const c of changes) {
    await writeFile(join(site.path, c.rel), c.after, "utf-8");
  }

  const sha = await commit(
    site.path,
    `refactor(svelte5): apply codemods (${changes.length} files)`,
  );

  return {
    recipe: "svelte-codemods",
    site: label,
    status: "applied",
    commits: sha ? [sha] : [],
    notes: `branch: ${branch}`,
  };
}
