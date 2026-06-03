import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  onboard,
  AUDIT_DEPS,
  FRAMEWORK_DEPS,
  type OnboardAudit,
} from "../../src/recipes/onboard.js";
import { baselineVersions } from "../../src/configs/baseline-versions.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

/** Stand in for a `pnpm install` that succeeds; for tests we don't actually
 *  modify the lockfile here — readFile/writeFile of package.json is what
 *  the recipe actually commits. */
const fakePnpmInstall: SpawnFn = async (cmd, args) => {
  if (cmd === "pnpm" && args[0] === "install") {
    return { code: 0, stdout: "", stderr: "" };
  }
  throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
};

async function addPnpmLock(cwd: string): Promise<void> {
  await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "add pnpm lock"], { cwd, stdio: "ignore" });
}

describe("recipes/onboard", () => {
  it("returns failed with clear remediation when site has no pnpm-lock.yaml", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await onboard({ path: cwd }, { spawn: fakePnpmInstall });
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/convert-to-pnpm/i);
  });

  it("adds @reddoorla/maintenance + audit deps to a fresh pnpm site", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);

    // Strip pristine-starter's audit deps so we can verify they get added.
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    delete pkg.devDependencies?.["@lhci/cli"];
    delete pkg.devDependencies?.["@playwright/test"];
    delete pkg.devDependencies?.["@axe-core/playwright"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "strip audit deps"], { cwd, stdio: "ignore" });

    const result = await onboard({ path: cwd }, { spawn: fakePnpmInstall });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThanOrEqual(1);

    const after = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(after.devDependencies?.["@reddoorla/maintenance"]).toMatch(/^\^?\d/);
    expect(after.devDependencies?.["@lhci/cli"]).toBeTruthy();
    expect(after.devDependencies?.["@playwright/test"]).toBeTruthy();
    expect(after.devDependencies?.["@axe-core/playwright"]).toBeTruthy();

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/onboard-\d{8}T\d{9}Z$/);
  });

  it("ensures @sveltejs/adapter-netlify (the synced svelte.config imports it) even when missing", async () => {
    // Regression: the sync-configs svelte.config.js template imports
    // @sveltejs/adapter-netlify, so a site can't build without it declared.
    // onboard must add it like any other framework dep — independent of audits.
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);

    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    delete pkg.devDependencies?.["@sveltejs/adapter-netlify"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "strip adapter-netlify"], { cwd, stdio: "ignore" });

    const result = await onboard({ path: cwd }, { spawn: fakePnpmInstall });
    expect(result.status).toBe("applied");

    const after = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(after.devDependencies?.["@sveltejs/adapter-netlify"]).toBe(
      baselineVersions["@sveltejs/adapter-netlify"],
    );
  });

  it("FRAMEWORK_DEPS sources versions from baseline-versions (no hardcoded drift)", () => {
    // Same drift guard as AUDIT_DEPS: framework dep versions must track
    // src/configs/baseline-versions.ts, never be hardcoded literals.
    for (const dep of FRAMEWORK_DEPS) {
      expect(dep.version).toBe(baselineVersions[dep.name]);
    }
  });

  it("returns noop when every needed dep is already present", async () => {
    // pristine-starter already has @lhci/cli, @playwright/test, @axe-core/playwright
    // as devDeps. Add @reddoorla/maintenance manually too.
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);

    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    pkg.devDependencies = {
      ...(pkg.devDependencies ?? {}),
      "@reddoorla/maintenance": "^0.2.0",
    };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add maintenance"], { cwd, stdio: "ignore" });

    const result = await onboard({ path: cwd }, { spawn: fakePnpmInstall });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("respects opts.audits — adding only the requested audit's deps", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);

    // Strip audit deps so we can observe what gets added.
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    delete pkg.devDependencies?.["@lhci/cli"];
    delete pkg.devDependencies?.["@playwright/test"];
    delete pkg.devDependencies?.["@axe-core/playwright"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "strip audit deps"], { cwd, stdio: "ignore" });

    await onboard({ path: cwd }, { spawn: fakePnpmInstall, audits: ["lighthouse"] });

    const after = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    // Lighthouse added; a11y deps left out.
    expect(after.devDependencies?.["@lhci/cli"]).toBeTruthy();
    expect(after.devDependencies?.["@playwright/test"]).toBeFalsy();
    expect(after.devDependencies?.["@axe-core/playwright"]).toBeFalsy();
  });

  it("refuses to run on a dirty working tree", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);
    await writeFile(join(cwd, "dirty.txt"), "x", "utf-8");

    await expect(onboard({ path: cwd }, { spawn: fakePnpmInstall })).rejects.toThrow(
      /working tree/i,
    );
  });

  it("pins @reddoorla/maintenance to a caret range matching this package's own version", async () => {
    // Regression: DEFAULT_PACKAGE_VERSION used to be hardcoded as "^0.2.0" and
    // went three majors stale before anyone noticed. The default should now
    // be derived from this package's own version at runtime.
    const ownPkg = JSON.parse(await readFile(resolve(here, "../../package.json"), "utf-8")) as {
      version?: string;
    };

    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);
    // pristine-starter doesn't ship the reddoorla dep, so onboard will add it.

    await onboard({ path: cwd }, { spawn: fakePnpmInstall });

    const after = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(after.devDependencies?.["@reddoorla/maintenance"]).toBe(`^${ownPkg.version}`);
  });

  it("AUDIT_DEPS sources versions from baseline-versions (no hardcoded drift)", () => {
    // Regression: AUDIT_DEPS versions used to be hardcoded in onboard.ts
    // and would silently drift away from src/configs/baseline-versions.ts.
    // If anyone bumps a baseline version, the onboard recipe must track it
    // automatically — this test catches a re-introduction of the hardcoded
    // literals.
    for (const audit of Object.keys(AUDIT_DEPS) as OnboardAudit[]) {
      for (const dep of AUDIT_DEPS[audit]) {
        expect(dep.version).toBe(baselineVersions[dep.name]);
      }
    }
  });

  it("returns failed when pnpm install errors", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await addPnpmLock(cwd);

    // Strip audit deps so the recipe actually needs to install something.
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    delete pkg.devDependencies?.["@lhci/cli"];
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "strip lhci"], { cwd, stdio: "ignore" });

    const failingSpawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "install error" });
    const result = await onboard({ path: cwd }, { spawn: failingSpawn });
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/pnpm install/i);
  });
});
