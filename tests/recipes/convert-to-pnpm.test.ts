import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { convertToPnpm, DEFAULT_PNPM_VERSION } from "../../src/recipes/convert-to-pnpm.js";
import { parsePackageManagerField } from "../../src/github/package-manager-pin.js";
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
    // The EXACT pin, not merely "some pnpm version". `/^pnpm@/` passed happily
    // on the year-stale `10.33.1` of #835 — a shape assertion cannot see a
    // wrong value, only a wrong format.
    expect(pkg.packageManager).toBe(`pnpm@${DEFAULT_PNPM_VERSION}`);

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/convert-to-pnpm-\d{8}T\d{9}Z$/);
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

  it("removes node_modules before running pnpm install (no phantom-dep contamination from flat npm install)", async () => {
    const cwd = await copyFixtureToTmp(pristine);

    // Simulate a previously-npm-installed site: lockfile + a populated flat
    // node_modules that pnpm would otherwise inherit and produce phantom-dep
    // resolution issues on top of.
    await writeFile(
      join(cwd, "package-lock.json"),
      JSON.stringify({ name: "test", lockfileVersion: 3 }),
      "utf-8",
    );
    await mkdir(join(cwd, "node_modules", "some-stale-dep"), { recursive: true });
    await writeFile(
      join(cwd, "node_modules", "some-stale-dep", "marker.txt"),
      "stale npm install\n",
      "utf-8",
    );
    // gitignore node_modules so the working tree stays clean — recipes refuse
    // to run on a dirty tree.
    await writeFile(join(cwd, ".gitignore"), "node_modules\n", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add npm lock + stale node_modules"], {
      cwd,
      stdio: "ignore",
    });

    let nodeModulesExistedAtInstall: boolean | null = null;
    const spawn: SpawnFn = async (cmd, args, opts) => {
      if (cmd === "pnpm" && args[0] === "install") {
        const installCwd = opts?.cwd ?? process.cwd();
        nodeModulesExistedAtInstall = await exists(join(installCwd, "node_modules"));
        await writeFile(join(installCwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
    };

    const result = await convertToPnpm({ path: cwd }, { spawn });
    expect(result.status).toBe("applied");
    expect(nodeModulesExistedAtInstall).toBe(false);
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

/**
 * The guard #835 asked for, and the drift it was filed about.
 *
 * `DEFAULT_PNPM_VERSION` sat at `10.33.1` for roughly a year while this repo and
 * all 24 pinned fleet repos ran `pnpm@11.11.0`. Every site the recipe converted
 * was therefore born a year behind the fleet, and no signal fired: the field was
 * well-formed, `pnpm install` succeeded, and the conversion test asserted only
 * that the value matched `/^pnpm@/`.
 *
 * This reads the repo's OWN `packageManager` field rather than a second literal
 * typed beside the constant. That is the whole mechanism: a test comparing two
 * hard-coded strings can only fail when a human edits one of them, which is the
 * original silence wearing a test's clothes. This one fails on the next pnpm
 * bump to this repo — the moment the drift is actually created.
 *
 * It is parsed with `parsePackageManagerField`, the reader the #834 fleet pin
 * guard uses, so this test and that guard cannot disagree about what the field
 * says.
 */
describe("DEFAULT_PNPM_VERSION", () => {
  it("matches this package's own packageManager pin", async () => {
    const raw = await readFile(resolve(here, "../../package.json"), "utf-8");
    const field = parsePackageManagerField(raw);

    // Assert the source of truth RESOLVED before comparing anything to it. A
    // moved package.json, or a dropped `packageManager` field, would otherwise
    // leave this comparing the constant against nothing and passing green —
    // and a check that cannot fail is precisely what #835 is about.
    expect(field.state).toBe("present");
    const pin = field.state === "present" ? field.value : "(unresolved)";
    expect(pin).toMatch(/^pnpm@/);

    expect(pin).toBe(`pnpm@${DEFAULT_PNPM_VERSION}`);
  });
});
