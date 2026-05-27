import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
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
    apply: async (planned, { commit }) => {
      await mkdir(dirname(planned.target), { recursive: true });
      await writeFile(planned.target, A11Y_FIXTURES_PAGE_TEMPLATE, "utf-8");
      await commit("feat: add /dev/a11y-fixtures starter route");
      return { kind: "ok" };
    },
  });
}
