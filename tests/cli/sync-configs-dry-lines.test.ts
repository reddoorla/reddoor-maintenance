import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";
import { runSyncConfigsCommand } from "../../src/cli/commands/sync-configs.js";

const here = dirname(fileURLToPath(import.meta.url));
const drift = resolve(here, "../fixtures/sync-drift");
const clean = resolve(here, "../fixtures/sync-clean");

const machine = (out: string) =>
  out.split("\n").filter((l) => /^(DRIFT|CLEAN|SKIPPED|SYNC_CONFIGS_DRIFT) /.test(l));

async function withTrackedBuild(dir: string): Promise<void> {
  await mkdir(join(dir, "build"), { recursive: true });
  await writeFile(join(dir, "build", "app.js"), "x\n", "utf-8");
  execFileSync("git", ["add", "-f", "build/app.js"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "track a build artifact"], { cwd: dir });
}

async function inventory(sites: object[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sync-dry-inv-"));
  const file = join(dir, "fleet.json");
  await writeFile(file, JSON.stringify(sites), "utf-8");
  return file;
}

describe("sync-configs --dry machine lines", () => {
  it("names every drifted file of every site, a clean site once, a skipped site, and a summary", async () => {
    const a = await copyFixtureToTmp(drift);
    const b = await copyFixtureToTmp(drift);
    const c = await copyFixtureToTmp(clean);
    const fleet = await inventory([
      { path: a, name: "slug-a", gitRepo: "reddoorla/repo-a" },
      { path: b, name: "slug-b", gitRepo: "reddoorla/repo-b" },
      { path: c, name: "slug-c", gitRepo: "reddoorla/repo-c" },
      {
        path: join(await mkdtemp(join(tmpdir(), "sync-dry-gone-")), "absent"),
        name: "slug-d",
        gitRepo: "reddoorla/repo-d",
        repoUrl: "file:///nonexistent/reddoor-sync-dry-test.git",
      },
    ]);
    const wd = await mkdtemp(join(tmpdir(), "sync-dry-wd-"));
    const { output, code } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet,
      workdir: wd,
    });
    expect(code).toBe(0);
    const lines = machine(output);

    const plain = run(["sync-configs", "--dry"], a);
    const expectedPaths = plain
      .split("\n")
      .map((l) => /^would (?:update|create) (\S+)/.exec(l)?.[1])
      .filter((p): p is string => p !== undefined)
      .sort();
    expect(expectedPaths.length).toBeGreaterThan(1);

    for (const repo of ["reddoorla/repo-a", "reddoorla/repo-b"]) {
      const paths = lines
        .filter((l) => l.startsWith(`DRIFT ${repo} `))
        .map((l) => l.split(" ")[2])
        .sort();
      expect(paths, repo).toEqual(expectedPaths);
      expect(lines).not.toContain(`CLEAN ${repo}`);
    }
    expect(lines.filter((l) => l.startsWith("CLEAN "))).toEqual(["CLEAN reddoorla/repo-c"]);
    expect(lines.filter((l) => l.includes("reddoorla/repo-c") && !l.startsWith("CLEAN"))).toEqual(
      [],
    );
    const skipped = lines.filter((l) => l.startsWith("SKIPPED "));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/^SKIPPED reddoorla\/repo-d \S/);
    expect(lines.some((l) => /^(DRIFT|CLEAN) reddoorla\/repo-d\b/.test(l))).toBe(false);
    const named = lines
      .filter((l) => !l.startsWith("SYNC_CONFIGS_DRIFT "))
      .map((l) => l.split(" ")[1]);
    expect(named.every((r) => r?.startsWith("reddoorla/repo-"))).toBe(true);
    expect(lines.at(-1)).toBe("SYNC_CONFIGS_DRIFT drifted=2 clean=1 skipped=1 total=4");
    expect(lines.filter((l) => l.startsWith("SYNC_CONFIGS_DRIFT "))).toHaveLength(1);
    expect(output).toMatch(/would update/);
  });

  it("in fleet mode, a checkout it cannot plan is SKIPPED, never CLEAN", async () => {
    const notGit = await mkdtemp(join(tmpdir(), "sync-dry-notgit-"));
    await cp(clean, notGit, { recursive: true });
    const ok = await copyFixtureToTmp(clean);
    const fleet = await inventory([
      { path: notGit, name: "slug-x", gitRepo: "reddoorla/repo-x" },
      { path: ok, name: "slug-y", gitRepo: "reddoorla/repo-y" },
    ]);
    const { output } = await runSyncConfigsCommand(undefined, {
      dry: true,
      fleet,
      workdir: await mkdtemp(join(tmpdir(), "sync-dry-wd-")),
    });
    const lines = machine(output);
    expect(lines.filter((l) => l.includes("reddoorla/repo-x"))).toEqual([
      expect.stringMatching(/^SKIPPED reddoorla\/repo-x dry plan failed: /),
    ]);
    expect(lines).toContain("CLEAN reddoorla/repo-y");
    expect(lines.at(-1)).toBe("SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=1 total=2");
  });

  it("reports .gitignore drift for a tracked build artifact, matching the real run", async () => {
    const dir = await copyFixtureToTmp(clean);
    await withTrackedBuild(dir);
    const dry = run(["sync-configs", "--dry"], dir);
    expect(dry).not.toMatch(/no changes needed/);
    expect(dry).toMatch(/build\/app\.js/);
    const name = dir.split("/").at(-1)!;
    expect(machine(dry)).toEqual([
      `DRIFT ${name} .gitignore`,
      "SYNC_CONFIGS_DRIFT drifted=1 clean=0 skipped=0 total=1",
    ]);
    const real = run(["sync-configs"], dir);
    expect(real).toMatch(/applied: 1 commit/);
  });

  it("a clean repo prints CLEAN and a summary with drifted=0", async () => {
    const dir = await copyFixtureToTmp(clean);
    const dry = run(["sync-configs", "--dry"], dir);
    const name = dir.split("/").at(-1)!;
    expect(dry).toMatch(/no changes needed/);
    expect(machine(dry)).toEqual([
      `CLEAN ${name}`,
      "SYNC_CONFIGS_DRIFT drifted=0 clean=1 skipped=0 total=1",
    ]);
  });

  it("still works on a directory that is not a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-dry-nogit-"));
    await cp(drift, dir, { recursive: true });
    const dry = run(["sync-configs", "--dry"], dir);
    const name = dir.split("/").at(-1)!;
    expect(dry).toMatch(/would create \.gitignore/);
    expect(machine(dry)).toContain(`DRIFT ${name} .gitignore`);
    expect(machine(dry).at(-1)).toMatch(/^SYNC_CONFIGS_DRIFT drifted=1 clean=0 skipped=0 total=1$/);
  });
});

const binPath = resolve(here, "../../dist/cli/bin.js");
function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    encoding: "utf-8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
