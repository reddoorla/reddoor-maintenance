import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { refusedByGit, undoRefusedWrites, RESTORED_NOTE } from "../_head-guard.js";
import { A11Y_FIXTURES_PAGE_RELATIVE, A11Y_FIXTURES_PAGE_TEMPLATE } from "./template.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route
 * doesn't already exist. The hardcoded URL in `src/configs/lighthouse.ts` +
 * `src/configs/playwright-a11y.ts` targets this path — newly-onboarded sites
 * need the route to exist for either audit to pass. Operator edits to an
 * existing page are never clobbered (noop on existing file).
 */
export async function a11yFixturesPage(site: Site): Promise<RecipeResult> {
  const target = join(site.path, A11Y_FIXTURES_PAGE_RELATIVE);
  return withRecipe<{ target: string }>({
    name: "a11y-fixtures-page",
    site,
    plan: async () => {
      if (await fileExists(target)) {
        return { kind: "noop", notes: `${A11Y_FIXTURES_PAGE_RELATIVE} already exists` };
      }
      return { kind: "apply", plan: { target } };
    },
    apply: async (planned, { commit, cwd }) => {
      await mkdir(dirname(planned.target), { recursive: true });
      await writeFile(planned.target, A11Y_FIXTURES_PAGE_TEMPLATE, "utf-8");
      await commit("feat: add /dev/a11y-fixtures starter route");

      // Did git TAKE it? A site that ignores `src/routes/dev/` (a plausible rule
      // — the route exists only for the audits) gets the file on disk, nothing
      // in the commit, and a result that reads as done. The lighthouse and
      // playwright-a11y configs would then target a route no clone has, and
      // every later run noops on "already exists" (#741).
      const refusal = await refusedByGit(
        cwd,
        [A11Y_FIXTURES_PAGE_RELATIVE],
        "the /dev/a11y-fixtures route",
      );
      if (refusal) {
        await undoRefusedWrites(
          cwd,
          new Map([[A11Y_FIXTURES_PAGE_RELATIVE, null]]),
          refusal.missing,
        );
        return { kind: "failed", notes: refusal.notes + RESTORED_NOTE };
      }
      return { kind: "ok" };
    },
  });
}
