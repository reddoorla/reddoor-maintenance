import type { RecipeResult, Site } from "../types.js";
import { branchName, commit, createBranch, isWorkingTreeClean } from "../util/git.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";

export type BumpDepsGroup = "patch" | "minor" | "major";

export type BumpDepsOptions = {
  group?: BumpDepsGroup;
  spawn?: SpawnFn;
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
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

  if (!(await isWorkingTreeClean(site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${site.path}`);
  }

  const branch = branchName("bump-deps");
  await createBranch(site.path, branch);

  await spawn("pnpm", ["up", ...upFlagsForGroup(group)], { cwd: site.path });

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
