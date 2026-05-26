import { join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { siteLabel } from "../../util/site.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../../util/git.js";
import { readPackageJson } from "../../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { bumpToSvelte5Versions } from "./step-bump-versions.js";
import { migrateSvelteConfig } from "./step-svelte-config.js";
import { runSvelteMigrate } from "./step-svelte-migrate.js";
import { upgradeTailwind } from "./step-tailwind-upgrade.js";
import { applyGotchaCodemods } from "./step-gotchas.js";
import { verifyMigration } from "./step-verify.js";
import { writeMigrationSummary } from "./step-summary.js";

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
  const label = siteLabel(site);
  const spawn = opts.spawn ?? defaultSpawn;

  if (await alreadyOnSvelte5(site.path)) {
    return {
      recipe: "svelte-4-to-5",
      site: label,
      status: "noop",
      commits: [],
      notes: "site already declares svelte ^5.x",
    };
  }

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("svelte-4-to-5");
  await createBranch(site.path, branch);

  const shas: string[] = [];

  const bumped = await bumpToSvelte5Versions(site.path);
  if (bumped) {
    const sha = await commit(site.path, "chore(svelte5): bump svelte/kit/vite/vite-plugin-svelte");
    if (sha) shas.push(sha);
  }

  const configChanged = await migrateSvelteConfig(site.path);
  if (configChanged) {
    const sha = await commit(
      site.path,
      "refactor(svelte5): migrate svelte.config.js (drop vitePreprocess)",
    );
    if (sha) shas.push(sha);
  }

  const migrate = await runSvelteMigrate(site.path, spawn);
  if (migrate.ran) {
    const sha = await commit(site.path, "refactor(svelte5): run official svelte-migrate codemod");
    if (sha) shas.push(sha);
  }

  const tw = await upgradeTailwind(site.path, spawn);
  if (tw.ran) {
    const sha = await commit(site.path, "chore(svelte5): tailwindcss 3 → 4 upgrade");
    if (sha) shas.push(sha);
  }

  const codemods = await applyGotchaCodemods(site.path);
  if (codemods.filesChanged > 0) {
    const sha = await commit(
      site.path,
      `refactor(svelte5): apply gotcha codemods (${codemods.filesChanged} files)`,
    );
    if (sha) shas.push(sha);
  }

  await verifyMigration(site.path, spawn);
  const verifySha = await commit(site.path, "chore(svelte5): pnpm install + check");
  if (verifySha) shas.push(verifySha);

  await writeMigrationSummary({
    cwd: site.path,
    filesChangedByCodemods: codemods.filesChanged,
    svelteMigrateRan: migrate.ran,
    tailwindUpgraded: tw.ran,
  });
  const summarySha = await commit(site.path, "docs(svelte5): add MIGRATION_SVELTE_5.md summary");
  if (summarySha) shas.push(summarySha);

  return {
    recipe: "svelte-4-to-5",
    site: label,
    status: shas.length > 0 ? "applied" : "noop",
    commits: shas,
    notes: `branch: ${branch}`,
  };
}
