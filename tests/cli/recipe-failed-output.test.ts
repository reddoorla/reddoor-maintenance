import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { RecipeResult, Site } from "../../src/types.js";

// A failed recipe result reaches the command's formatter two ways: the recipe
// returns `status: "failed"` (bump-deps' competing-lockfile refusal), or it
// throws and runRecipeOverSites turns the throw into one. Before the shared
// formatter, bump-deps, upgrade and sync-configs printed both as
// `applied: 0 commit(s)`.
const recipe = vi.hoisted(() => ({
  impl: async (_site: Site): Promise<RecipeResult> => {
    throw new Error("unset");
  },
}));

vi.mock("../../src/recipes/bump-deps.js", () => ({
  bumpDeps: (site: Site) => recipe.impl(site),
}));
vi.mock("../../src/recipes/svelte-5/index.js", () => ({
  upgradeSvelte4to5: (site: Site) => recipe.impl(site),
}));
vi.mock("../../src/recipes/sync-configs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/recipes/sync-configs.js")>()),
  syncConfigs: (site: Site) => recipe.impl(site),
}));

const { runBumpDepsCommand } = await import("../../src/cli/commands/bump-deps.js");
const { runUpgradeCommand } = await import("../../src/cli/commands/upgrade.js");
const { runSyncConfigsCommand } = await import("../../src/cli/commands/sync-configs.js");

let dir: string;
let label: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recipe-failed-"));
  label = basename(dir);
});

const commands: Array<[string, (site: string) => Promise<{ output: string; code: number }>]> = [
  ["bump-deps", (site) => runBumpDepsCommand(site, {})],
  ["upgrade", (site) => runUpgradeCommand("svelte-4-to-5", site, {})],
  ["sync-configs", (site) => runSyncConfigsCommand(site, {})],
];

describe.each(commands)("%s prints a failed recipe as failed", (name, run) => {
  it("when the recipe returns status failed", async () => {
    recipe.impl = async () => ({
      recipe: "bump-deps",
      site: label,
      status: "failed",
      commits: [],
      notes: "site has package-lock.json but no pnpm-lock.yaml — run convert-to-pnpm first",
    });
    const res = await run(dir);
    expect(res.output).toBe(
      `[${label}] failed: site has package-lock.json but no pnpm-lock.yaml — run convert-to-pnpm first`,
    );
    expect(res.code).toBe(1);
  });

  it("when the recipe throws", async () => {
    recipe.impl = async () => {
      throw new Error(`${name} exploded`);
    };
    const res = await run(dir);
    expect(res.output).toBe(`[${label}] failed: unexpected error: ${name} exploded`);
    expect(res.code).toBe(1);
  });
});
