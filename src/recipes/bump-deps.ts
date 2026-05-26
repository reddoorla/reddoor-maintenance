import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";

export type BumpDepsGroup = "patch" | "minor" | "major";

export type BumpDepsOptions = {
  group?: BumpDepsGroup;
  spawn?: SpawnFn;
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function outdatedFlagsForGroup(group: BumpDepsGroup): string[] {
  if (group === "major") return ["--latest"];
  if (group === "minor") return [];
  return ["--depth", "0"];
}

function upFlagsForGroup(group: BumpDepsGroup): string[] {
  if (group === "major") return ["--latest"];
  return [];
}

export async function bumpDeps(site: Site, opts: BumpDepsOptions = {}): Promise<RecipeResult> {
  const label = siteLabel(site);
  const group: BumpDepsGroup = opts.group ?? "minor";
  const spawn = opts.spawn ?? defaultSpawn;

  // Pre-flight: the recipe is pnpm-only. A package-lock.json or yarn.lock
  // without pnpm-lock.yaml means the site is still on a different package
  // manager; we refuse to run rather than emit confusing pnpm errors. The
  // onboard recipe pattern (clear "failed" + remediation) gives the caller
  // an actionable next step.
  const hasPnpmLock = await exists(join(site.path, "pnpm-lock.yaml"));
  if (!hasPnpmLock) {
    const hasNpmLock = await exists(join(site.path, "package-lock.json"));
    const hasYarnLock = await exists(join(site.path, "yarn.lock"));
    if (hasNpmLock || hasYarnLock) {
      const competing = hasNpmLock ? "package-lock.json" : "yarn.lock";
      return {
        recipe: "bump-deps",
        site: label,
        status: "failed",
        commits: [],
        notes: `site has ${competing} but no pnpm-lock.yaml — run convert-to-pnpm first`,
      };
    }
  }

  // Working tree must be clean before we run pnpm install, otherwise a
  // desynced-lockfile resync would silently land on top of whatever else
  // the user had in flight.
  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  // Ensure the lockfile reflects the current package.json before we ask
  // pnpm what's outdated. Without this, a desynced lockfile can produce
  // stale or empty outdated reports.
  await spawn("pnpm", ["install"], { cwd: site.path, streaming: true });

  const outdated = await spawn("pnpm", ["outdated", "--json", ...outdatedFlagsForGroup(group)], {
    cwd: site.path,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(outdated.stdout || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const nothingToDo = Object.keys(parsed).length === 0;

  if (nothingToDo) {
    return {
      recipe: "bump-deps",
      site: label,
      status: "noop",
      commits: [],
      notes: `pnpm outdated reported nothing for group=${group}`,
    };
  }

  const branch = branchName("bump-deps");
  await createBranch(site.path, branch);

  // Stream pnpm up's output so long-running upgrades don't look frozen.
  await spawn("pnpm", ["up", ...upFlagsForGroup(group)], {
    cwd: site.path,
    streaming: true,
  });

  const sha = await commit(site.path, `chore(deps): bump dependencies (${group})`);
  const shas = sha ? [sha] : [];

  return {
    recipe: "bump-deps",
    site: label,
    status: shas.length > 0 ? "applied" : "noop",
    commits: shas,
    notes: `branch: ${branch}`,
  };
}
