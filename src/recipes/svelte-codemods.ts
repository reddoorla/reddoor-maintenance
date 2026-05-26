import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { planGotchaCodemods } from "./svelte-5/step-gotchas.js";
import { withRecipe } from "./_with-recipe.js";

type Change = { rel: string; after: string };

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
  return withRecipe<Change[]>({
    name: "svelte-codemods",
    site,
    plan: async () => {
      const changes = await planGotchaCodemods(site.path);
      if (changes.length === 0) {
        return { kind: "noop", notes: "no codemod targets matched" };
      }
      return { kind: "apply", plan: changes };
    },
    apply: async (changes, { commit, cwd }) => {
      for (const c of changes) {
        await writeFile(join(cwd, c.rel), c.after, "utf-8");
      }
      await commit(`refactor(svelte5): apply codemods (${changes.length} files)`);
      return { kind: "ok" };
    },
  });
}
