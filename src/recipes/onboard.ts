import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { readPackageJson, writePackageJson, bumpDep, type PackageJsonLike } from "../util/pkg.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import { selfCaretRange } from "../util/self-version.js";
import { baselineVersions } from "../configs/baseline-versions.js";
import { withRecipe } from "./_with-recipe.js";

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

const AUDIT_DEP_NAMES: Record<OnboardAudit, string[]> = {
  lighthouse: ["@lhci/cli"],
  a11y: ["@playwright/test", "@axe-core/playwright"],
};

/** Look up each audit dep's version in baselineVersions at module load so
 * AUDIT_DEPS can't drift from the single source of truth across releases.
 * Throws at import time if baseline-versions is missing an audit dep —
 * which would be a programming error (every audit dep name above must
 * appear in baselineVersions). */
export const AUDIT_DEPS: Record<
  OnboardAudit,
  Array<{ name: string; version: string }>
> = Object.fromEntries(
  (Object.entries(AUDIT_DEP_NAMES) as Array<[OnboardAudit, string[]]>).map(([audit, names]) => [
    audit,
    names.map((name) => {
      const version = baselineVersions[name];
      if (!version) {
        throw new Error(
          `baseline-versions is missing audit dep "${name}" — add it to src/configs/baseline-versions.ts`,
        );
      }
      return { name, version };
    }),
  ]),
) as Record<OnboardAudit, Array<{ name: string; version: string }>>;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isDeclared(pkg: PackageJsonLike, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

type Plan = {
  pkg: PackageJsonLike;
  toAdd: Array<{ name: string; version: string }>;
};

export async function onboard(site: Site, opts: OnboardOptions = {}): Promise<RecipeResult> {
  const spawn = opts.spawn ?? defaultSpawn;
  const audits = opts.audits ?? (["lighthouse", "a11y"] as OnboardAudit[]);
  const packageVersion = opts.packageVersion ?? selfCaretRange(import.meta.url);

  return withRecipe<Plan>({
    name: "onboard",
    site,
    plan: async () => {
      // Pre-flight: site must already be on pnpm. We don't auto-convert here;
      // that's the convert-to-pnpm recipe's job, and combining them would
      // hide the package-manager transition inside a bigger PR.
      if (!(await exists(join(site.path, "pnpm-lock.yaml")))) {
        return {
          kind: "failed",
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
          kind: "noop",
          notes: `site already has ${PACKAGE_NAME} and audit deps (${audits.join("+")})`,
        };
      }
      return { kind: "apply", plan: { pkg, toAdd } };
    },
    apply: async ({ pkg, toAdd }, { commit, cwd }) => {
      const pkgPath = join(cwd, "package.json");
      let next: PackageJsonLike = pkg;
      for (const dep of toAdd) {
        next = bumpDep(next, dep.name, dep.version);
      }
      await writePackageJson(pkgPath, next);

      // Run pnpm install so the lockfile reflects the new deps before we commit.
      // Stream output — install on a real site can take 30s+.
      const installResult = await spawn("pnpm", ["install"], { cwd, streaming: true });
      if (installResult.code !== 0) {
        return {
          kind: "failed",
          notes: `pnpm install failed (exit ${installResult.code})`,
        };
      }

      await commit(`chore(reddoor): onboard with ${PACKAGE_NAME} ${packageVersion}`);
      return {
        kind: "ok",
        notes: `Added ${toAdd.length} dep(s): ${toAdd.map((d) => d.name).join(", ")}`,
      };
    },
  });
}
