import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../types.js";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import { withRecipe } from "./_with-recipe.js";

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

type Plan = { group: BumpDepsGroup };

export async function bumpDeps(site: Site, opts: BumpDepsOptions = {}): Promise<RecipeResult> {
  const group: BumpDepsGroup = opts.group ?? "minor";
  const spawn = opts.spawn ?? defaultSpawn;

  return withRecipe<Plan>({
    name: "bump-deps",
    site,
    // pnpm install (in plan) mutates the lockfile, so the clean-tree check
    // MUST happen first — otherwise a desynced-lockfile resync would silently
    // land on top of whatever else was in the tree.
    checkTreeFirst: true,
    plan: async () => {
      // Pre-flight: the recipe is pnpm-only. A package-lock.json or yarn.lock
      // without pnpm-lock.yaml means the site is still on a different package
      // manager; we refuse to run rather than emit confusing pnpm errors.
      const hasPnpmLock = await exists(join(site.path, "pnpm-lock.yaml"));
      if (!hasPnpmLock) {
        const hasNpmLock = await exists(join(site.path, "package-lock.json"));
        const hasYarnLock = await exists(join(site.path, "yarn.lock"));
        if (hasNpmLock || hasYarnLock) {
          const competing = hasNpmLock ? "package-lock.json" : "yarn.lock";
          return {
            kind: "failed",
            notes: `site has ${competing} but no pnpm-lock.yaml — run convert-to-pnpm first`,
          };
        }
      }

      // Ensure the lockfile reflects the current package.json before we ask
      // pnpm what's outdated. Without this, a desynced lockfile can produce
      // stale or empty outdated reports.
      await spawn("pnpm", ["install"], { cwd: site.path, streaming: true });

      const outdated = await spawn(
        "pnpm",
        ["outdated", "--json", ...outdatedFlagsForGroup(group)],
        { cwd: site.path },
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(outdated.stdout || "{}") as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      if (Object.keys(parsed).length === 0) {
        return { kind: "noop", notes: `pnpm outdated reported nothing for group=${group}` };
      }
      return { kind: "apply", plan: { group } };
    },
    apply: async ({ group: g }, { commit, cwd }) => {
      // Stream pnpm up's output so long-running upgrades don't look frozen.
      await spawn("pnpm", ["up", ...upFlagsForGroup(g)], { cwd, streaming: true });
      await commit(`chore(deps): bump dependencies (${g})`);
      return { kind: "ok" };
    },
  });
}
