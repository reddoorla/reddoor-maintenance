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
    // @playwright/test already present in the fixture → no install spawned. The
    // only spawn is prettier formatting the files this run wrote.
    const installCalls = spawn.calls.filter((c) => c.args[0] === "install");
    expect(installCalls).toHaveLength(0);
    const prettierCalls = spawn.calls.filter((c) => c.args[0] === "exec");
    expect(prettierCalls).toHaveLength(1);
    expect(prettierCalls[0]?.args).toEqual([
      "exec",
      "prettier",
      "--write",
      SMOKE_ROUTES_RELATIVE,
      SMOKE_SPEC_RELATIVE,
      PLAYWRIGHT_CONFIG_RELATIVE,
      "package.json",
    ]);
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

  it("adds only test:smoke on a site without vitest (no failing `test`/`test:unit`)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    delete pkg.devDependencies.vitest; // non-vitest site, and fixture has no `test` script
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("applied");

    const after = await readPkg(cwd);
    expect(after.scripts?.["test:smoke"]).toBe("playwright install chromium && playwright test");
    // No vitest → the shared CI would fail on `vitest: not found`, so neither is added.
    expect(after.scripts?.["test"]).toBeUndefined();
    expect(after.scripts?.["test:unit"]).toBeUndefined();
  });

  it("keeps the verbatim starter manifest when the site's svelte source renders a <footer>", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await mkdir(join(cwd, "src/lib/components"), { recursive: true });
    await writeFile(
      join(cwd, "src/lib/components/Footer.svelte"),
      '<footer class="site-footer">© site</footer>\n',
    );
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("applied");
    expect(await readFile(join(cwd, SMOKE_ROUTES_RELATIVE), "utf-8")).toBe(SMOKE_ROUTES_TEMPLATE);
    expect(result.notes ?? "").not.toMatch(/hydration marker/);
  });

  it("falls back to a `main` hydration marker when svelte source exists but renders no <footer>", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await mkdir(join(cwd, "src/routes"), { recursive: true });
    // A capital-F <Footer /> component tag is NOT a footer element — unless some
    // file renders the literal lowercase tag, the browser never paints a footer
    // landmark and the starter's default marker false-fails every route check
    // (exactly what happened on la-homelessness-initiative).
    await writeFile(
      join(cwd, "src/routes/+page.svelte"),
      '<script>import Footer from "$lib/Footer.svelte";</script>\n<main><h1>bespoke</h1></main>\n<Footer />\n',
    );
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("applied");
    const routes = await readFile(join(cwd, SMOKE_ROUTES_RELATIVE), "utf-8");
    expect(routes).toContain('hydrationMarker: "main"');
    expect(routes).not.toContain('hydrationMarker: "footer"');
    expect(routes).toContain("no <footer> element"); // the manifest comment explains the fallback
    expect(result.notes).toMatch(/hydration marker set to "main"/);
  });

  it("falls back to `body` when the svelte source has neither <footer> nor <main>", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await mkdir(join(cwd, "src/routes"), { recursive: true });
    await writeFile(join(cwd, "src/routes/+page.svelte"), '<div class="app">hi</div>\n');
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    const routes = await readFile(join(cwd, SMOKE_ROUTES_RELATIVE), "utf-8");
    expect(routes).toContain('hydrationMarker: "body"');
    expect(result.notes).toMatch(/hydration marker set to "body"/);
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

  it("prettier-formats only the files it wrote, leaving an untouched operator config out", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const cfg = join(cwd, PLAYWRIGHT_CONFIG_RELATIVE);
    const weird =
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: 'e2e' });\n";
    await writeFile(cfg, weird);
    commitSetup(cwd);

    const spawn = fakeSpawn();
    await smokeSuite({ path: cwd }, { spawn: spawn.fn });

    const prettierCalls = spawn.calls.filter((c) => c.args[0] === "exec");
    expect(prettierCalls).toHaveLength(1);
    const formatted = prettierCalls[0]?.args ?? [];
    expect(formatted).toContain(SMOKE_ROUTES_RELATIVE);
    expect(formatted).toContain(SMOKE_SPEC_RELATIVE);
    expect(formatted).toContain("package.json");
    // The operator's config was left untouched, so it must NOT be reformatted.
    expect(formatted).not.toContain(PLAYWRIGHT_CONFIG_RELATIVE);
  });

  it("flags a prettier failure in notes but still commits (best-effort)", async () => {
    const cwd = await copyFixtureToTmp(pristine); // @playwright/test present → no install
    // Prettier exits non-zero (e.g. not installed); the recipe must still commit.
    const flakyPrettier: SpawnFn = async (_cmd, args) =>
      args[0] === "exec"
        ? { code: 1, stdout: "", stderr: "prettier: not found" }
        : { code: 0, stdout: "", stderr: "" };
    const result = await smokeSuite({ path: cwd }, { spawn: flakyPrettier });

    expect(result.status).toBe("applied");
    expect(result.notes).toMatch(/could not prettier-format/);
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
    // Both spawns fired: `pnpm install` (dep added) then prettier formatting.
    const installCalls = spawn.calls.filter((c) => c.args[0] === "install");
    expect(installCalls).toHaveLength(1);
    expect(installCalls[0]?.cmd).toBe("pnpm");
    const prettierCalls = spawn.calls.filter((c) => c.args[0] === "exec");
    expect(prettierCalls).toHaveLength(1);
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

  it("noops gracefully (not failed) on an unparseable package.json — nothing written", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, "package.json"), "{ this is: not valid json,, }\n");
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("noop");
    expect(result.notes).toMatch(/unparseable package\.json/);
    // The parse happens in the read-only plan phase, so no spec file leaked out.
    await expect(readFile(join(cwd, SMOKE_SPEC_RELATIVE), "utf-8")).rejects.toThrow();
  });

  it("still surfaces the config flag on a full re-run where nothing needs writing (noop + note)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // Fully adopted EXCEPT an unusual config: specs present, all scripts present,
    // @playwright/test present (fixture). The only outstanding item is the config,
    // which must not be touched — but its flag must still reach the operator even
    // though the recipe stages nothing and reports noop.
    await mkdir(dirname(join(cwd, SMOKE_ROUTES_RELATIVE)), { recursive: true });
    await writeFile(join(cwd, SMOKE_ROUTES_RELATIVE), SMOKE_ROUTES_TEMPLATE);
    await writeFile(join(cwd, SMOKE_SPEC_RELATIVE), SMOKE_SPEC_TEMPLATE);
    await writeFile(join(cwd, PLAYWRIGHT_CONFIG_RELATIVE), "export default { custom: true };\n");
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    pkg.scripts = {
      ...pkg.scripts,
      test: "vitest run",
      "test:unit": "vitest run",
      "test:smoke": "playwright install chromium && playwright test",
    };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    commitSetup(cwd);

    const result = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(result.status).toBe("noop"); // nothing left to write
    expect(result.notes).toMatch(/playwright\.config\.ts exists without REDDOOR_SMOKE_PORT/);
  });

  it("is idempotent: a second run makes no further changes", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    const second = await smokeSuite({ path: cwd }, { spawn: fakeSpawn().fn });
    expect(second.status).toBe("noop");
  });
});
