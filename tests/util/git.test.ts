import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import {
  currentBranch,
  isWorkingTreeClean,
  createBranch,
  commit,
  branchName,
} from "../../src/util/git.js";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

describe("util/git", () => {
  it("branchName produces a maint/<recipe>-<UTC> string", () => {
    const name = branchName("sync-configs", new Date("2026-05-20T10:30:00Z"));
    expect(name).toBe("maint/sync-configs-20260520T103000Z");
  });

  it("currentBranch returns the current branch", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const branch = await currentBranch(cwd);
    expect(branch).toBe("main");
  });

  it("isWorkingTreeClean is true after a fresh commit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    expect(await isWorkingTreeClean(cwd)).toBe(true);
  });

  it("isWorkingTreeClean is false when there is an untracked file", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    execFileSync("touch", ["new.txt"], { cwd });
    expect(await isWorkingTreeClean(cwd)).toBe(false);
  });

  it("createBranch + commit returns SHAs in order", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await createBranch(cwd, "maint/test-20260520T000000Z");
    execFileSync("touch", ["a.txt"], { cwd });
    const shaA = await commit(cwd, "feat: a");
    execFileSync("touch", ["b.txt"], { cwd });
    const shaB = await commit(cwd, "feat: b");
    expect(shaA).toMatch(/^[0-9a-f]{7,40}$/);
    expect(shaB).toMatch(/^[0-9a-f]{7,40}$/);
    expect(shaA).not.toBe(shaB);

    const log = execFileSync("git", ["log", "--format=%s"], { cwd, encoding: "utf-8" });
    expect(log).toContain("feat: a");
    expect(log).toContain("feat: b");
  });

  it("commit returns the noop sentinel when nothing is staged", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await createBranch(cwd, "maint/test-20260520T000001Z");
    const sha = await commit(cwd, "noop commit");
    expect(sha).toBeNull();
  });
});
