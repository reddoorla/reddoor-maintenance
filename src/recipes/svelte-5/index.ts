import { join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { readPackageJson } from "../../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { bumpToSvelte5Versions } from "./step-bump-versions.js";
import { migrateSvelteConfig } from "./step-svelte-config.js";
import { runSvelteMigrate } from "./step-svelte-migrate.js";
import { upgradeTailwind } from "./step-tailwind-upgrade.js";
import { applyGotchaCodemods } from "./step-gotchas.js";
import { verifyMigration } from "./step-verify.js";
import { writeMigrationSummary } from "./step-summary.js";
import { withRecipe } from "../_with-recipe.js";

export type UpgradeSvelte4to5Options = {
  spawn?: SpawnFn;
};

async function alreadyOnSvelte5(cwd: string): Promise<boolean> {
  try {
    const pkg = await readPackageJson(join(cwd, "package.json"));
    const v = pkg.devDependencies?.svelte ?? pkg.dependencies?.svelte;
    return !!v && /^\^?5\./.test(v);
  } catch {
    return false;
  }
}

export async function upgradeSvelte4to5(
  site: Site,
  opts: UpgradeSvelte4to5Options = {},
): Promise<RecipeResult> {
  const spawn = opts.spawn ?? defaultSpawn;

  return withRecipe<true>({
    name: "svelte-4-to-5",
    site,
    plan: async () => {
      if (await alreadyOnSvelte5(site.path)) {
        return { kind: "noop", notes: "site already declares svelte ^5.x" };
      }
      return { kind: "apply", plan: true };
    },
    apply: async (_plan, { commit, cwd }) => {
      const bumped = await bumpToSvelte5Versions(cwd);
      if (bumped) {
        await commit("chore(svelte5): bump svelte/kit/vite/vite-plugin-svelte");
      }

      const configChanged = await migrateSvelteConfig(cwd);
      if (configChanged) {
        await commit("refactor(svelte5): migrate svelte.config.js (drop vitePreprocess)");
      }

      const migrate = await runSvelteMigrate(cwd, spawn);
      if (migrate.ran) {
        await commit("refactor(svelte5): run official svelte-migrate codemod");
      }

      const tw = await upgradeTailwind(cwd, spawn);
      if (tw.ran) {
        await commit("chore(svelte5): tailwindcss 3 → 4 upgrade");
      }

      const codemods = await applyGotchaCodemods(cwd);
      if (codemods.filesChanged > 0) {
        await commit(`refactor(svelte5): apply gotcha codemods (${codemods.filesChanged} files)`);
      }

      await verifyMigration(cwd, spawn);
      await commit("chore(svelte5): pnpm install + check");

      await writeMigrationSummary({
        cwd,
        filesChangedByCodemods: codemods.filesChanged,
        svelteMigrateRan: migrate.ran,
        tailwindUpgraded: tw.ran,
      });
      await commit("docs(svelte5): add MIGRATION_SVELTE_5.md summary");

      return { kind: "ok" };
    },
  });
}
