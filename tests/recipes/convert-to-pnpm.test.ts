import { describe, it, expect } from "vitest";
import { readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { convertToPnpm } from "../../src/recipes/convert-to-pnpm.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

/** Spawn that fakes a successful `pnpm install` by writing a placeholder
 *  pnpm-lock.yaml in cwd. */
function fakePnpmInstall(): SpawnFn {
  return async (cmd, args, opts) => {
    if (cmd === "pnpm" && args[0] === "install") {
      const cwd = opts?.cwd ?? process.cwd();
      await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("recipes/convert-to-pnpm", () => {
  it("returns noop when the site already has pnpm-lock.yaml", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add pnpm lock"], { cwd, stdio: "ignore" });

    const result = await convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("returns noop when no lockfile of any kind is present", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() });
    expect(result.status).toBe("noop");
  });

  it("converts an npm-using site: removes package-lock.json, adds pnpm-lock.yaml, pins packageManager", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
      "utf-8",
    );
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add npm lock"], { cwd, stdio: "ignore" });

    const result = await convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThanOrEqual(2);

    expect(await exists(join(cwd, "package-lock.json"))).toBe(false);
    expect(await exists(join(cwd, "pnpm-lock.yaml"))).toBe(true);

    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8")) as {
      packageManager?: string;
    };
    expect(pkg.packageManager).toMatch(/^pnpm@/);

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/convert-to-pnpm-\d{8}T\d{6}Z$/);
  });

  it("rewrites npm references in package.json scripts during conversion", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // Inject npm-style scripts.
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    pkg.scripts = {
      ...(pkg.scripts ?? {}),
      "ci:build": "npm run lint && npm run build",
      bench: "npx playwright test",
    };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
      "utf-8",
    );
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add scripts + lock"], { cwd, stdio: "ignore" });

    await convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() });

    const after = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(after.scripts?.["ci:build"]).toBe("pnpm run lint && pnpm run build");
    expect(after.scripts?.bench).toBe("pnpm dlx playwright test");
  });

  it("also removes yarn.lock if present", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, "yarn.lock"), "# yarn lockfile v1\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add yarn lock"], { cwd, stdio: "ignore" });

    await convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() });

    expect(await exists(join(cwd, "yarn.lock"))).toBe(false);
    expect(await exists(join(cwd, "pnpm-lock.yaml"))).toBe(true);
  });

  it("refuses to run on a dirty working tree", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
      "utf-8",
    );
    // intentionally NOT committing — working tree is now dirty.
    await expect(convertToPnpm({ path: cwd }, { spawn: fakePnpmInstall() })).rejects.toThrow(
      /working tree/i,
    );
  });

  it("returns failed when pnpm install errors", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
      "utf-8",
    );
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add npm lock"], { cwd, stdio: "ignore" });

    const failingSpawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const result = await convertToPnpm({ path: cwd }, { spawn: failingSpawn });
    expect(result.status).toBe("failed");
    expect(result.notes).toMatch(/pnpm install/i);
  });
});
