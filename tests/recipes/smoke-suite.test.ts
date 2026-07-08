import { describe, it, expect } from "vitest";
import { writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { smokeSuite } from "../../src/recipes/smoke-suite/index.js";
import {
  SMOKE_ROUTES_RELATIVE,
  SMOKE_ROUTES_TEMPLATE,
  SMOKE_SPEC_RELATIVE,
  SMOKE_SPEC_TEMPLATE,
  PLAYWRIGHT_CONFIG_RELATIVE,
  PLAYWRIGHT_CONFIG_TEMPLATE,
  PLAYWRIGHT_CONFIG_PRE_R11,
} from "../../src/recipes/smoke-suite/template.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

/** A spawn that records calls and never launches anything — the recipe's
 *  `pnpm install` must be mocked (no real install, no network, no boot). */
function fakeSpawn(): { fn: SpawnFn; calls: Array<{ cmd: string; args: readonly string[] }> } {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const fn: SpawnFn = async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, stdout: "", stderr: "" };
  };
  return { fn, calls };
}

/** Commit any working-tree edits so withRecipe's clean-tree check passes. */
function commitSetup(cwd: string): void {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "setup"], { cwd, stdio: "ignore" });
}

async function readPkg(cwd: string): Promise<{
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
}

describe("recipes/smoke-suite", () => {
  it("applies on a site without the suite: writes specs + R1.1 config + script split", async () => {
    const cwd = await copyFixtureToTmp(pristine); // has @playwright/test, no config, no tests/smoke
    const spawn = fakeSpawn();
    const result = await smokeSuite({ path: cwd }, { spawn: spawn.fn });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/smoke-suite-/);

    expect(await readFile(join(cwd, SMOKE_ROUTES_RELATIVE), "utf-8")).toBe(SMOKE_ROUTES_TEMPLATE);
    expect(await readFile(join(cwd, SMOKE_SPEC_RELATIVE), "utf-8")).toBe(SMOKE_SPEC_TEMPLATE);
    expect(await readFile(join(cwd, PLAYWRIGHT_CONFIG_RELATIVE), "utf-8")).toBe(
      PLAYWRIGHT_CONFIG_TEMPLATE,
    );

    const pkg = await readPkg(cwd);
    expect(pkg.scripts?.["test:smoke"]).toBe("playwright install chromium && playwright test");
    expect(pkg.scripts?.["test:unit"]).toBe("vitest run");
    expect(pkg.scripts?.["test"]).toBe("vitest run");
    // @playwright/test already present in the fixture → no install spawned.
    expect(spawn.calls).toHaveLength(0);
  });

  it("preserves an existing test:unit runner and never overwrites a present script", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    pkg.scripts.test = "vitest run --project custom";
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    commitSetup(cwd);

    await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    const after = await readPkg(cwd);
    expect(after.scripts?.["test"]).toBe("vitest run --project custom"); // untouched
    expect(after.scripts?.["test:unit"]).toBe("vitest run --project custom"); // copied from test
    expect(after.scripts?.["test:smoke"]).toBe("playwright install chromium && playwright test");
  });

  it("noops the spec files when they already exist (no clobber)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const routes = join(cwd, SMOKE_ROUTES_RELATIVE);
    await mkdir(dirname(routes), { recursive: true });
    await writeFile(routes, "// operator's custom manifest\n");
    commitSetup(cwd);

    await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(await readFile(routes, "utf-8")).toBe("// operator's custom manifest\n");
  });

  it("leaves a config that already honors REDDOOR_SMOKE_PORT untouched", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const cfg = join(cwd, PLAYWRIGHT_CONFIG_RELATIVE);
    const already = "// has REDDOOR_SMOKE_PORT already\nexport default {};\n";
    await writeFile(cfg, already);
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(await readFile(cfg, "utf-8")).toBe(already);
    expect(result.notes ?? "").not.toMatch(/add the R1.1 port block/);
  });

  it("safe-replaces a recognized pre-R1.1 shared-base config with the R1.1 version", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const cfg = join(cwd, PLAYWRIGHT_CONFIG_RELATIVE);
    await writeFile(cfg, PLAYWRIGHT_CONFIG_PRE_R11);
    commitSetup(cwd);

    await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(await readFile(cfg, "utf-8")).toBe(PLAYWRIGHT_CONFIG_TEMPLATE);
  });

  it("flags an unusual existing config for manual patch, applies the rest", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const cfg = join(cwd, PLAYWRIGHT_CONFIG_RELATIVE);
    const weird =
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: 'e2e' });\n";
    await writeFile(cfg, weird);
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("applied");
    expect(await readFile(cfg, "utf-8")).toBe(weird); // untouched
    expect(result.notes).toMatch(/playwright\.config\.ts exists without REDDOOR_SMOKE_PORT/);
    // the rest still applied
    expect(await readFile(join(cwd, SMOKE_SPEC_RELATIVE), "utf-8")).toBe(SMOKE_SPEC_TEMPLATE);
  });

  it("adds @playwright/test and runs pnpm install when the dep is missing", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    delete pkg.devDependencies["@playwright/test"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    commitSetup(cwd);

    const spawn = fakeSpawn();
    const result = await smokeSuite({ path: cwd }, { spawn: spawn.fn });

    expect(result.status).toBe("applied");
    const after = await readPkg(cwd);
    expect(after.devDependencies?.["@playwright/test"]).toBe("^1.60.0");
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]?.cmd).toBe("pnpm");
    expect(spawn.calls[0]?.args).toEqual(["install"]);
  });

  it("fails the recipe when pnpm install exits non-zero", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    delete pkg.devDependencies["@playwright/test"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    commitSetup(cwd);

    const badSpawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const result = await smokeSuite({ path: cwd }, { spawn: badSpawn });
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/pnpm install failed/);
  });

  it("noops on a site with no package.json (not a node project)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await rm(join(cwd, "package.json"));
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("noop");
    expect(result.notes).toMatch(/no package\.json/);
  });

  it("is idempotent: a second run makes no further changes", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    const second = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(second.status).toBe("noop");
  });
});
