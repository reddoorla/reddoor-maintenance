import { describe, it, expect } from "vitest";
import { writeFile, readFile, rm, mkdir, realpath } from "node:fs/promises";
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
import { PRETTIER_FLAG_NOTE } from "../../src/recipes/_prettier.js";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

/** A spawn that records calls and never launches anything — the recipe's
 *  `pnpm install` must be mocked (no real install, no network, no boot). */
type Call = { cmd: string; args: readonly string[]; opts?: SpawnOptions };
function fakeSpawn(): { fn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const fn: SpawnFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, ...(opts !== undefined ? { opts } : {}) });
    return { code: 0, stdout: "", stderr: "" };
  };
  return { fn, calls };
}

/** Stands in for a populated `node_modules/.bin`, so the absolute-path spawn
 *  can be asserted without installing the fixture's devDependencies. */
const SITE_PRETTIER = "/site/node_modules/.bin/prettier";
const resolveSitePrettier = async () => SITE_PRETTIER;
/** After the fix there is no `pnpm exec` argv: prettier's own argv starts at
 *  `--write`, so a re-introduced `exec` shows up as a missing call here. */
const isPrettierCall = (c: { args: readonly string[] }) => c.args[0] === "--write";

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

describe("the emitted spec's error allowlists", () => {
  // The real thing, verbatim from Chromium on 2026-09-04 (vida-legacy-foundation
  // /contact, sitekey of a widget already full at Cloudflare's 10-hostname cap).
  // It arrives as an UNCAUGHT exception, i.e. through page.on("pageerror").
  const REAL_110200 = "TurnstileError: [Cloudflare Turnstile] Error: 110200";

  /** Evaluate one `const NAME: RegExp[] = [...]` literal out of the template. */
  function patterns(name: string): RegExp[] {
    const m = new RegExp(`const ${name}: RegExp\\[\\] = (\\[[\\s\\S]*?\\]);`).exec(
      SMOKE_SPEC_TEMPLATE,
    );
    expect(m, `${name} not found in the emitted spec`).not.toBeNull();
    return new Function(`return ${m![1]}`)() as RegExp[];
  }

  it("keeps Turnstile console telemetry allowed — a 403 beacon is noise, not a failure", () => {
    const console = patterns("ALLOWED_CONSOLE_PATTERNS");
    expect(console.some((re) => re.test(REAL_110200))).toBe(true);
  });

  it("does NOT allow an uncaught TurnstileError: the widget throwing IS the failure", () => {
    // This suite watched a broken widget ship and stayed green, because the
    // console pattern was also applied to pageerror and matched the throw by
    // name. A sitekey served from a hostname its widget doesn't list mints no
    // token at all, which on a `Require Turnstile` site buckets 100% of leads.
    const thrown = patterns("ALLOWED_PAGEERROR_PATTERNS");
    expect(thrown.some((re) => re.test(REAL_110200))).toBe(false);
    // ...and the vimeo carve-out that motivated the shared list still applies to
    // both, so the split narrows exactly one thing.
    expect(thrown.some((re) => re.test("Error from player.vimeo.com"))).toBe(true);
  });

  it("wires the pageerror handler to the stricter list", () => {
    // Guards the other half: two correct arrays are useless if the handler reads
    // the wrong one.
    expect(SMOKE_SPEC_TEMPLATE).toMatch(
      /page\.on\("pageerror", \(err\) => \{\s*if \(isAllowedThrow\(err\.message\)\) return;/,
    );
  });
});

describe("recipes/smoke-suite", () => {
  it("applies on a site without the suite: writes specs + R1.1 config + script split", async () => {
    const cwd = await copyFixtureToTmp(pristine); // has @playwright/test, no config, no tests/smoke
    const spawn = fakeSpawn();
    const result = await smokeSuite(
      { path: cwd },
      { spawn: spawn.fn, resolvePrettier: resolveSitePrettier },
    );

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
    const prettierCalls = spawn.calls.filter(isPrettierCall);
    expect(prettierCalls).toHaveLength(1);
    expect(prettierCalls[0]?.args).toEqual([
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
    await smokeSuite({ path: cwd }, { spawn: spawn.fn, resolvePrettier: resolveSitePrettier });

    const prettierCalls = spawn.calls.filter(isPrettierCall);
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
      isPrettierCall({ args })
        ? { code: 1, stdout: "", stderr: "prettier: not found" }
        : { code: 0, stdout: "", stderr: "" };
    const result = await smokeSuite(
      { path: cwd },
      { spawn: flakyPrettier, resolvePrettier: resolveSitePrettier },
    );

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
    const result = await smokeSuite(
      { path: cwd },
      { spawn: spawn.fn, resolvePrettier: resolveSitePrettier },
    );

    expect(result.status).toBe("applied");
    const after = await readPkg(cwd);
    expect(after.devDependencies?.["@playwright/test"]).toBe("^1.60.0");
    // Both spawns fired: `pnpm install` (dep added) then prettier formatting.
    const installCalls = spawn.calls.filter((c) => c.args[0] === "install");
    expect(installCalls).toHaveLength(1);
    expect(installCalls[0]?.cmd).toBe("pnpm");
    const prettierCalls = spawn.calls.filter(isPrettierCall);
    expect(prettierCalls).toHaveLength(1);
    // Install first, THEN resolve and format: a site that just gained its
    // devDependencies has a prettier to run, and the order is what makes that
    // true on a checkout that arrived without node_modules.
    expect(spawn.calls.findIndex((c) => c.args[0] === "install")).toBeLessThan(
      spawn.calls.findIndex(isPrettierCall),
    );
  });

  it("runs the SITE's own prettier by absolute path, under a timeout — never `pnpm exec`", async () => {
    const cwd = await copyFixtureToTmp(pristine); // @playwright/test present → no install
    const spawn = fakeSpawn();
    const result = await smokeSuite(
      { path: cwd },
      { spawn: spawn.fn, resolvePrettier: resolveSitePrettier },
    );

    expect(spawn.calls).toHaveLength(1);
    const call = spawn.calls[0]!;
    // The resolved binary itself, not `pnpm exec prettier`: on the fleet path
    // the clone has no node_modules, and `pnpm exec` would first run a full,
    // unbounded install in the client's repo and then fall through to the
    // CALLING repo's prettier and exit 0 (#737).
    expect(call.cmd).toBe(SITE_PRETTIER);
    expect(call.args[0]).toBe("--write");
    expect(call.args).not.toContain("exec");
    // Without a timeout the default spawn never detaches and never kills.
    expect(call.opts?.timeoutMs).toBe(60_000);
    expect(call.opts?.cwd).toBe(cwd);
    // The green is positive: the target's own prettier ran and exited 0.
    expect(result.status).toBe("applied");
    expect(result.notes ?? "").not.toContain(PRETTIER_FLAG_NOTE);
  });

  it("resolves that prettier from the checkout itself when none is injected", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // node_modules must be ignored first or withRecipe's clean-tree gate throws on it.
    await writeFile(join(cwd, ".gitignore"), "node_modules\n", "utf-8");
    commitSetup(cwd);
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(cwd, "node_modules", ".bin", "prettier"), "#!/bin/sh\nexit 0\n", "utf-8");
    const spawn = fakeSpawn();

    await smokeSuite({ path: cwd }, { spawn: spawn.fn });

    // Not merely "not pnpm": the exact binary inside THIS checkout. realpath on
    // both sides — mkdtemp hands back /var/folders/…, a symlink on macOS.
    expect(spawn.calls.map((c) => c.cmd)).toEqual([
      await realpath(join(cwd, "node_modules", ".bin", "prettier")),
    ]);
  });

  it("never shells out into a clone with no prettier: it skips, flags, and still commits", async () => {
    // The fleet path exactly — `prepareFleetSites` clones and never installs,
    // so every site arrives without node_modules. Nothing may run there.
    const cwd = await copyFixtureToTmp(pristine); // @playwright/test present → no install
    const spawn = fakeSpawn();
    const result = await smokeSuite({ path: cwd }, { spawn: spawn.fn });

    expect(spawn.calls).toEqual([]);
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toContain(PRETTIER_FLAG_NOTE);
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

// --- git must actually TAKE the suite (#741). This is the sharpest case of the
//     class: package.json is tracked and always changes, so the commit succeeds
//     and the result reads "applied" while the specs the suite consists of are
//     in no commit at all.

describe("recipes/smoke-suite: the commit must carry the specs", () => {
  async function siteIgnoring(body: string): Promise<string> {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, ".gitignore"), body, "utf-8");
    commitSetup(cwd);
    return cwd;
  }

  const headTree = (cwd: string): string[] =>
    execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], { cwd, encoding: "utf-8" })
      .split("\0")
      .filter(Boolean);

  const gitOut = (cwd: string, args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

  const onDisk = (cwd: string, rel: string): Promise<string | null> =>
    readFile(join(cwd, rel), "utf-8").then(
      (s) => s,
      () => null,
    );

  it("GRANTS a normal install — every installed path is in HEAD's tree", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await smokeSuite(
      { path: cwd },
      { spawn: fakeSpawn().fn, resolvePrettier: resolveSitePrettier },
    );
    expect(result.status).toBe("applied");
    const tree = headTree(cwd);
    for (const rel of [SMOKE_ROUTES_RELATIVE, SMOKE_SPEC_RELATIVE, PLAYWRIGHT_CONFIG_RELATIVE]) {
      expect(tree, `${rel} was written but not committed`).toContain(rel);
    }
  });

  it("REFUSES when the site ignores tests/ — the package.json edit alone is not the suite", async () => {
    const cwd = await siteIgnoring("node_modules\ntests/\n");
    const result = await smokeSuite(
      { path: cwd },
      { spawn: fakeSpawn().fn, resolvePrettier: resolveSitePrettier },
    );

    // Before the guard this was "applied": the package.json script split and
    // playwright.config.ts landed, so `commit()` returned a SHA, and a site
    // whose smoke suite consists of two files git refused counted as rolled out.
    expect(result.status).toBe("failed");
    expect(result.notes).toContain(SMOKE_ROUTES_RELATIVE);
    expect(result.notes).toContain(SMOKE_SPEC_RELATIVE);
    expect(result.notes).toContain(".gitignore:2:tests/");
    const tree = headTree(cwd);
    expect(tree).not.toContain(SMOKE_ROUTES_RELATIVE);
    expect(tree).not.toContain(SMOKE_SPEC_RELATIVE);
    // The half-install is rolled back whole: the specs git refused are off disk
    // (or the next run noops "already exists"), and the package.json scripts
    // that promised to run them went with the discarded commit.
    expect(await onDisk(cwd, SMOKE_ROUTES_RELATIVE)).toBeNull();
    expect(await onDisk(cwd, SMOKE_SPEC_RELATIVE)).toBeNull();
    expect((await readPkg(cwd)).scripts?.["test:smoke"]).toBeUndefined();
    expect(gitOut(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(gitOut(cwd, ["status", "--porcelain"])).toBe("");
  });
});
