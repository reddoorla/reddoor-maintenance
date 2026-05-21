import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { syncConfigs } from "../../src/recipes/sync-configs.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const clean = resolve(here, "../fixtures/sync-clean");
const drift = resolve(here, "../fixtures/sync-drift");

describe("recipes/sync-configs", () => {
  it("returns noop when every template already matches", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("applies templates that differ and commits one per config", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThan(0);

    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).toContain("@reddoor/maintenance/configs/eslint");

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/sync-configs-\d{8}T\d{6}Z$/);
  });

  it("running twice on drift leaves the second run as a noop", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const first = await syncConfigs({ path: cwd });
    expect(first.status).toBe("applied");
    const second = await syncConfigs({ path: cwd });
    expect(second.status).toBe("noop");
    expect(second.commits).toHaveLength(0);
  });

  it("respects opts.which", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["prettier"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).not.toContain("@reddoor/maintenance/configs/eslint");
  });

  it("refuses to run when the working tree is dirty", async () => {
    const cwd = await copyFixtureToTmp(drift);
    execFileSync("touch", ["dirty.txt"], { cwd });
    await expect(syncConfigs({ path: cwd })).rejects.toThrow(/working tree/i);
  });
});
