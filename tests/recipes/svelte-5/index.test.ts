import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { upgradeSvelte4to5 } from "../../../src/recipes/svelte-5/index.js";
import { copyFixtureToTmp } from "../_helpers/site-tmpdir.js";
import type { SpawnFn } from "../../../src/audits/util/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const preSvelte5 = resolve(here, "../../fixtures/pre-svelte5");
const pristine = resolve(here, "../../fixtures/pristine-starter");

const fakeSpawnOK: SpawnFn = async () => ({ code: 0, stdout: "", stderr: "" });

describe("recipes/svelte-5: upgradeSvelte4to5", () => {
  it("applies on the pre-svelte5 fixture and produces commits", async () => {
    const cwd = await copyFixtureToTmp(preSvelte5);
    const result = await upgradeSvelte4to5({ path: cwd }, { spawn: fakeSpawnOK });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThanOrEqual(2);

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/svelte-4-to-5-\d{8}T\d{6}Z$/);

    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.svelte).toBe("^5.55.5");

    const summary = await readFile(join(cwd, "MIGRATION_SVELTE_5.md"), "utf-8");
    expect(summary).toMatch(/Svelte 4 → 5 migration summary/);
  });

  it("is a noop on a site already on Svelte 5", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await upgradeSvelte4to5({ path: cwd }, { spawn: fakeSpawnOK });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("refuses when working tree is dirty", async () => {
    const cwd = await copyFixtureToTmp(preSvelte5);
    execFileSync("touch", ["dirty.txt"], { cwd });
    await expect(upgradeSvelte4to5({ path: cwd }, { spawn: fakeSpawnOK })).rejects.toThrow(
      /working tree/i,
    );
  });
});
