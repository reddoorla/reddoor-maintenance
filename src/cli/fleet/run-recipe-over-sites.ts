import type { RecipeName, RecipeResult, Site } from "../../types.js";
import { siteLabel } from "../../util/site.js";

/**
 * Run a recipe across a fleet of sites with PER-SITE failure isolation.
 *
 * The recipes run SEQUENTIALLY (they do git/filesystem work that isn't safe to
 * parallelize), and a throw from any one site is caught and converted into a
 * `failed` RecipeResult so the remaining sites still run. This mirrors how
 * `prepareFleetSites` isolates a bad row during the clone/prep phase — but one
 * layer up, at recipe execution.
 *
 * Without this, the bare `for (const s of sites) results.push(await recipe(s))`
 * loop the fleet commands used to share would abort the WHOLE `--fleet` run the
 * moment one site threw: the recipes throw on a non-clean working tree (and on
 * transient git errors), so a single dirty checkout silently skipped every
 * subsequent site and surfaced as a crash rather than a per-site report.
 *
 * @param recipe the recipe name, used to label a synthesized `failed` result
 *   when `run` throws (the recipe never returned its own result in that case).
 */
export async function runRecipeOverSites(
  recipe: RecipeName,
  sites: Site[],
  run: (site: Site) => Promise<RecipeResult>,
): Promise<RecipeResult[]> {
  const results: RecipeResult[] = [];
  for (const s of sites) {
    try {
      results.push(await run(s));
    } catch (err) {
      results.push({
        recipe,
        site: siteLabel(s),
        status: "failed",
        commits: [],
        notes: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}
