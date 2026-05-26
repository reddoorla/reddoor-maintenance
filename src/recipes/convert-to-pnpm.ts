import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";
import { readPackageJson, writePackageJson, type PackageJsonLike } from "../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import { rewriteScriptsForPnpm } from "./convert-to-pnpm/script-rewrites.js";

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

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

export async function convertToPnpm(
  site: Site,
  opts: ConvertToPnpmOptions = {},
): Promise<RecipeResult> {
  const label = siteLabel(site);
  const spawn = opts.spawn ?? defaultSpawn;
  const pnpmVersion = opts.pnpmVersion ?? DEFAULT_PNPM_VERSION;

  const pnpmLockPath = join(site.path, "pnpm-lock.yaml");
  const npmLockPath = join(site.path, "package-lock.json");
  const yarnLockPath = join(site.path, "yarn.lock");

  if (await exists(pnpmLockPath)) {
    return {
      recipe: "convert-to-pnpm",
      site: label,
      status: "noop",
      commits: [],
      notes: "site already has pnpm-lock.yaml",
    };
  }

  const hasNpmLock = await exists(npmLockPath);
  const hasYarnLock = await exists(yarnLockPath);
  if (!hasNpmLock && !hasYarnLock) {
    return {
      recipe: "convert-to-pnpm",
      site: label,
      status: "noop",
      commits: [],
      notes: "no convertible lockfile (package-lock.json or yarn.lock) at site root",
    };
  }

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("convert-to-pnpm");
  await createBranch(site.path, branch);

  const shas: string[] = [];

  // Step 1: remove the npm/yarn lockfile(s).
  if (hasNpmLock) await rm(npmLockPath, { force: true });
  if (hasYarnLock) await rm(yarnLockPath, { force: true });
  const sourceLock = hasNpmLock ? "package-lock.json" : "yarn.lock";
  const lockSha = await commit(site.path, `chore(pnpm): remove ${sourceLock}`);
  if (lockSha) shas.push(lockSha);

  // Step 2: pin packageManager + rewrite scripts (single commit — they
  // both touch package.json).
  const pkgPath = join(site.path, "package.json");
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
  const pkgSha = await commit(site.path, "chore(pnpm): pin packageManager + rewrite npm scripts");
  if (pkgSha) shas.push(pkgSha);

  // Step 3: remove any existing flat node_modules from a prior npm/yarn run
  // before pnpm installs. Sharing a node_modules across package managers
  // produces phantom-dep resolution issues (pnpm's nested layout disagrees
  // with what's already on disk). node_modules is gitignored on every
  // reddoor site so this doesn't dirty the tree.
  await rm(join(site.path, "node_modules"), { recursive: true, force: true });

  // Step 4: run pnpm install to materialize pnpm-lock.yaml.
  const installResult = await spawn("pnpm", ["install"], {
    cwd: site.path,
    streaming: true,
  });
  if (installResult.code !== 0) {
    return {
      recipe: "convert-to-pnpm",
      site: label,
      status: "failed",
      commits: shas,
      notes: `pnpm install failed (exit ${installResult.code}). branch ${branch} left for inspection.`,
    };
  }

  const installSha = await commit(site.path, "chore(pnpm): add pnpm-lock.yaml");
  if (installSha) shas.push(installSha);

  return {
    recipe: "convert-to-pnpm",
    site: label,
    status: "applied",
    commits: shas,
    notes: `branch: ${branch}`,
  };
}
