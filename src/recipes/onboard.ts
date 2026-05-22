import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";
import { readPackageJson, writePackageJson, bumpDep, type PackageJsonLike } from "../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import { selfCaretRange } from "../util/self-version.js";

export type OnboardAudit = "lighthouse" | "a11y";

export type OnboardOptions = {
  spawn?: SpawnFn;
  /** Which audit-related deps to ensure. Defaults to all known audits. */
  audits?: OnboardAudit[];
  /** Version range to pin for @reddoorla/maintenance. Defaults to a caret
   *  range against this package's own version at runtime — no manual
   *  syncing required at each minor bump. */
  packageVersion?: string;
};

const PACKAGE_NAME = "@reddoorla/maintenance";

const AUDIT_DEPS: Record<OnboardAudit, Array<{ name: string; version: string }>> = {
  lighthouse: [{ name: "@lhci/cli", version: "^0.15.1" }],
  a11y: [
    { name: "@playwright/test", version: "^1.59.1" },
    { name: "@axe-core/playwright", version: "^4.11.3" },
  ],
};

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

function isDeclared(pkg: PackageJsonLike, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

export async function onboard(site: Site, opts: OnboardOptions = {}): Promise<RecipeResult> {
  const label = siteLabel(site);
  const spawn = opts.spawn ?? defaultSpawn;
  const audits = opts.audits ?? (["lighthouse", "a11y"] as OnboardAudit[]);
  const packageVersion = opts.packageVersion ?? selfCaretRange(import.meta.url);

  // Pre-flight: site must already be on pnpm. We don't auto-convert here;
  // that's the convert-to-pnpm recipe's job, and combining them would
  // hide the package-manager transition inside a bigger PR. Report as
  // a "failed" outcome (with clear remediation) rather than "noop" since
  // no work was done and the caller probably wants to know.
  if (!(await exists(join(site.path, "pnpm-lock.yaml")))) {
    return {
      recipe: "onboard",
      site: label,
      status: "failed",
      commits: [],
      notes: "no pnpm-lock.yaml at site root — run convert-to-pnpm first",
    };
  }

  const pkgPath = join(site.path, "package.json");
  const pkg = await readPackageJson(pkgPath);

  // Determine what's missing. Anything already declared (even at a wildly
  // different version) is left alone — onboard never downgrades.
  const toAdd: Array<{ name: string; version: string }> = [];
  if (!isDeclared(pkg, PACKAGE_NAME)) {
    toAdd.push({ name: PACKAGE_NAME, version: packageVersion });
  }
  for (const audit of audits) {
    for (const dep of AUDIT_DEPS[audit]) {
      if (!isDeclared(pkg, dep.name)) toAdd.push(dep);
    }
  }

  if (toAdd.length === 0) {
    return {
      recipe: "onboard",
      site: label,
      status: "noop",
      commits: [],
      notes: `site already has ${PACKAGE_NAME} and audit deps (${audits.join("+")})`,
    };
  }

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("onboard");
  await createBranch(site.path, branch);

  let next: PackageJsonLike = pkg;
  for (const dep of toAdd) {
    next = bumpDep(next, dep.name, dep.version);
  }
  await writePackageJson(pkgPath, next);

  // Run pnpm install so the lockfile reflects the new deps before we commit.
  // Stream output — install on a real site can take 30s+.
  const installResult = await spawn("pnpm", ["install"], {
    cwd: site.path,
    streaming: true,
  });
  if (installResult.code !== 0) {
    return {
      recipe: "onboard",
      site: label,
      status: "failed",
      commits: [],
      notes: `pnpm install failed (exit ${installResult.code}). branch ${branch} left for inspection.`,
    };
  }

  const sha = await commit(
    site.path,
    `chore(reddoor): onboard with ${PACKAGE_NAME} ${packageVersion}`,
  );
  const shas = sha ? [sha] : [];

  return {
    recipe: "onboard",
    site: label,
    status: "applied",
    commits: shas,
    notes: `branch: ${branch}. Added ${toAdd.length} dep(s): ${toAdd.map((d) => d.name).join(", ")}`,
  };
}
