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
  ignoreRulesFor,
  pathsMissingFromHead,
} from "../../src/util/git.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

describe("util/git", () => {
  it("branchName produces a maint/<recipe>-<UTC ms-precision> string", () => {
    const name = branchName("sync-configs", new Date("2026-05-20T10:30:00.123Z"));
    expect(name).toBe("maint/sync-configs-20260520T103000123Z");
  });

  it("branchName uses millisecond precision so two same-second invocations don't collide", () => {
    // Regression: branchName used to be second-precision; parallel runs
    // (or even two terminals firing within the same second) collided on
    // the same branch name. Millisecond precision shrinks the collision
    // window to a single ms.
    const a = branchName("sync-configs", new Date("2026-05-20T10:30:00.123Z"));
    const b = branchName("sync-configs", new Date("2026-05-20T10:30:00.456Z"));
    expect(a).not.toBe(b);
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

  /** A repo with one tracked file and one that .gitignore keeps out. */
  async function repoWithIgnoredFile(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "reddoor-git-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@reddoor.local"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
    await writeFile(join(cwd, ".gitignore"), "secret/\n", "utf-8");
    await writeFile(join(cwd, "kept.txt"), "k", "utf-8");
    execFileSync("mkdir", ["-p", join(cwd, "secret")]);
    await writeFile(join(cwd, "secret/dropped.txt"), "d", "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });
    return cwd;
  }

  it("pathsMissingFromHead finds what `git add -A` silently dropped, and nothing else", async () => {
    const cwd = await repoWithIgnoredFile();
    // `git add -A` exited 0 and staged neither the ignored file nor an error.
    expect(await pathsMissingFromHead(cwd, ["kept.txt", ".gitignore"])).toEqual([]);
    expect(await pathsMissingFromHead(cwd, ["kept.txt", "secret/dropped.txt"])).toEqual([
      "secret/dropped.txt",
    ]);
  });

  it("pathsMissingFromHead reports everything missing when there is no HEAD", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "reddoor-git-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
    // An error may only ever DENY. A git failure must never read as "present".
    expect(await pathsMissingFromHead(cwd, ["a.txt", "b.txt"])).toEqual(["a.txt", "b.txt"]);
  });

  it("ignoreRulesFor names the rule, and returns [] rather than throwing when none matches", async () => {
    const cwd = await repoWithIgnoredFile();
    expect(await ignoreRulesFor(cwd, ["secret/dropped.txt"])).toEqual([
      ".gitignore:1:secret/\tsecret/dropped.txt",
    ]);
    // `git check-ignore` EXITS 1 when nothing matches; the caller is already
    // reporting a failure and must not lose it to a throw from the diagnosis.
    expect(await ignoreRulesFor(cwd, ["kept.txt"])).toEqual([]);
  });
});
