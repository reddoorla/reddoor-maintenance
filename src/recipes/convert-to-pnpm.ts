import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { readPackageJson, writePackageJson, type PackageJsonLike } from "../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import { rewriteScriptsForPnpm } from "./convert-to-pnpm/script-rewrites.js";
import { withRecipe } from "./_with-recipe.js";

export type ConvertToPnpmOptions = {
  spawn?: SpawnFn;
  /** Version string written into package.json's `packageManager` field.
   *  Defaults to the version baked into this package's own pnpm setup. */
  pnpmVersion?: string;
};

/** Pinned default — matches the `packageManager` field of this package
 *  (kept in sync with package.json). Sites can override per-recipe. */
const DEFAULT_PNPM_VERSION = "10.33.1";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type Plan = { hasNpmLock: boolean; hasYarnLock: boolean };

export async function convertToPnpm(
  site: Site,
  opts: ConvertToPnpmOptions = {},
): Promise<RecipeResult> {
  const spawn = opts.spawn ?? defaultSpawn;
  const pnpmVersion = opts.pnpmVersion ?? DEFAULT_PNPM_VERSION;

  const pnpmLockPath = join(site.path, "pnpm-lock.yaml");
  const npmLockPath = join(site.path, "package-lock.json");
  const yarnLockPath = join(site.path, "yarn.lock");

  return withRecipe<Plan>({
    name: "convert-to-pnpm",
    site,
    plan: async () => {
      if (await exists(pnpmLockPath)) {
        return { kind: "noop", notes: "site already has pnpm-lock.yaml" };
      }
      const hasNpmLock = await exists(npmLockPath);
      const hasYarnLock = await exists(yarnLockPath);
      if (!hasNpmLock && !hasYarnLock) {
        return {
          kind: "noop",
          notes: "no convertible lockfile (package-lock.json or yarn.lock) at site root",
        };
      }
      return { kind: "apply", plan: { hasNpmLock, hasYarnLock } };
    },
    apply: async ({ hasNpmLock, hasYarnLock }, { commit, cwd }) => {
      // Step 1: remove the npm/yarn lockfile(s).
      if (hasNpmLock) await rm(npmLockPath, { force: true });
      if (hasYarnLock) await rm(yarnLockPath, { force: true });
      const sourceLock = hasNpmLock ? "package-lock.json" : "yarn.lock";
      await commit(`chore(pnpm): remove ${sourceLock}`);

      // Step 2: pin packageManager + rewrite scripts (single commit — they
      // both touch package.json).
      const pkgPath = join(cwd, "package.json");
      const pkg = await readPackageJson(pkgPath);
      const next: PackageJsonLike = { ...pkg, packageManager: `pnpm@${pnpmVersion}` };

      if (pkg.scripts && typeof pkg.scripts === "object") {
        const { scripts: rewritten, changedCount } = rewriteScriptsForPnpm(
          pkg.scripts as Record<string, string>,
        );
        if (changedCount > 0) {
          next.scripts = rewritten;
        }
      }

      await writePackageJson(pkgPath, next);
      await commit("chore(pnpm): pin packageManager + rewrite npm scripts");

      // Step 3: remove any existing flat node_modules from a prior npm/yarn run
      // before pnpm installs. Sharing a node_modules across package managers
      // produces phantom-dep resolution issues (pnpm's nested layout disagrees
      // with what's already on disk). node_modules is gitignored on every
      // reddoor site so this doesn't dirty the tree.
      await rm(join(cwd, "node_modules"), { recursive: true, force: true });

      // Step 4: run pnpm install to materialize pnpm-lock.yaml.
      const installResult = await spawn("pnpm", ["install"], { cwd, streaming: true });
      if (installResult.code !== 0) {
        return { kind: "failed", notes: `pnpm install failed (exit ${installResult.code})` };
      }

      await commit("chore(pnpm): add pnpm-lock.yaml");
      return { kind: "ok" };
    },
  });
}
