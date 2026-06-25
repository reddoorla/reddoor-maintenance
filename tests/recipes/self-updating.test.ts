import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { selfUpdating } from "../../src/recipes/self-updating/index.js";
import type { GitHub } from "../../src/github/gh.js";

function currentBranchOf(dir: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
    encoding: "utf-8",
  }).trim();
}

function gitInit(dir: string) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@reddoor.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "reddoor-test"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r.git"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "r", scripts: {} }));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
}

type GitHubOverrides = Partial<GitHub>;

function fakeGitHub(over: GitHubOverrides = {}): { gh: GitHub; calls: string[] } {
  const calls: string[] = [];
  const gh: GitHub = {
    openPullRequest: async (repo) => {
      calls.push(`pr:${repo}`);
      return { url: "https://github.com/o/r/pull/1" };
    },
    enableRepoAutoMerge: async (repo) => {
      calls.push(`automerge:${repo}`);
    },
    protectBranch: async (repo, b, checks) => {
      calls.push(`protect:${repo}:${b}:${checks.join(",")}`);
    },
    setRepoSecret: async (repo, name) => {
      calls.push(`secret:${repo}:${name}`);
    },
    repoExists: async () => true,
    defaultBranch: async () => "main",
    filesOnBranch: async () => [],
    branchProtectionContexts: async () => [],
    secretExists: async () => false,
    autoMergeEnabled: async () => false,
    findOpenSelfUpdatingPR: async () => null,
    openPullRequests: async () => [],
    defaultBranchStatus: async () => ({ ciState: "none", lastCommitAt: null }),
    mergedRenovatePullRequests: async () => [],
    dispatchWorkflow: async (repo, workflow, ref) => {
      calls.push(`dispatch:${repo}:${workflow}:${ref}`);
    },
    ...over,
  };
  return { gh, calls };
}

const ALL_PATHS = [".github/workflows/ci.yml", ".github/workflows/renovate.yml", "renovate.json"];

describe("selfUpdating recipe", () => {
  it("fresh repo: bootstraps files via PR and wires all three settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const startBranch = currentBranchOf(dir);
    const { gh, calls } = fakeGitHub();
    // The push captures the maint branch's committed ci.yml BEFORE the recipe
    // restores the local checkout to the operator's branch (post-push). We assert
    // the bootstrap happened on the pushed branch, not the post-restore worktree.
    let ciOnPushedBranch = false;
    const push = vi.fn(async (cwd: string, branch: string) => {
      ciOnPushedBranch = execFileSync("git", ["ls-tree", "-r", "--name-only", branch], {
        cwd,
        encoding: "utf-8",
      }).includes(".github/workflows/ci.yml");
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(ciOnPushedBranch).toBe(true);
    // Local checkout restored to where the operator started (#2).
    expect(currentBranchOf(dir)).toBe(startBranch);
    expect(push).toHaveBeenCalledOnce();
    expect(calls).toContain("pr:o/r");
    expect(calls).toContain("automerge:o/r");
    expect(calls).toContain("protect:o/r:main:ci / ci");
    expect(calls).toContain("secret:o/r:RENOVATE_TOKEN");
    expect(r.notes).toContain("https://github.com/o/r/pull/1");
    expect(r.commits).toHaveLength(1);
  });

  it("restores the operator's original branch after bootstrapping + pushing the maint branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    // Operator starts on a feature branch, not the default branch.
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
    expect(currentBranchOf(dir)).toBe("work");

    const { gh } = fakeGitHub();
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(push).toHaveBeenCalledOnce();
    // The maint branch was created + pushed, but the local checkout is back on `work`.
    expect(currentBranchOf(dir)).toBe("work");
  });

  it("restores the operator's branch even when the PUSH FAILS (no stranded checkout)", async () => {
    // Regression for round-3 #4: the restore used to live only on the success
    // path, so a push failure after createBranch left the checkout parked on the
    // maint branch with an unpushed commit — and the retry then failed at
    // createBranch ("branch already exists"). The restore now runs in a `finally`.
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
    expect(currentBranchOf(dir)).toBe("work");

    const { gh } = fakeGitHub();
    const push = vi.fn(async () => {
      throw new Error("push rejected: remote unreachable");
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("failed");
    expect(push).toHaveBeenCalledOnce();
    // Critical: despite the failure, the checkout is back on `work`, not stranded
    // on the maint branch — so a retry can re-create the branch cleanly.
    expect(currentBranchOf(dir)).toBe("work");
  });

  it("fully wired: no mutating calls, noop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci / ci"],
      secretExists: async () => true,
    });
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("noop");
    expect(push).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(r.commits).toHaveLength(0);
  });

  it("bootstraps when only some of the CI files are present on the branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => [ALL_PATHS[0]!], // only 1 of 3 present
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci / ci"],
      secretExists: async () => true,
    });
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(push).toHaveBeenCalledOnce();
    expect(calls).toContain("pr:o/r");
  });

  it("fails (without mutating GitHub) when the bootstrap tree is dirty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    writeFileSync(join(dir, "stray.txt"), "uncommitted"); // dirty the tree
    const { gh, calls } = fakeGitHub({ filesOnBranch: async () => [] });
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("failed");
    expect(r.notes).toContain("working tree not clean");
    expect(push).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("reports failed with completed actions when a settings call throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS, // no bootstrap
      autoMergeEnabled: async () => false, // → enableRepoAutoMerge succeeds (1 action)
      branchProtectionContexts: async () => ["ci / ci"],
      secretExists: async () => false, // → setRepoSecret runs, and throws
      setRepoSecret: async () => {
        throw new Error("boom");
      },
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("failed");
    expect(r.notes).toContain("boom");
    expect(r.notes).toContain("completed: enabled auto-merge");
    expect(calls).toContain("automerge:o/r");
  });

  it("self-heals a half-configured repo: only the missing secret is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci / ci"],
      secretExists: async () => false,
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(calls).toEqual(["secret:o/r:RENOVATE_TOKEN"]);
  });

  it("adds the ci check, MERGING it with the branch's existing required contexts", async () => {
    // The branch already requires `other-check` and `foo`; enabling self-updating must
    // ADD `ci / ci` to that set, never REPLACE it (the PUT would otherwise silently drop
    // the repo's pre-existing required checks). Union, in existing-then-desired order.
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["other-check", "foo"],
      secretExists: async () => true,
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(calls).toEqual(["protect:o/r:main:other-check,foo,ci / ci"]);
  });

  it("does not duplicate ci / ci when it is already among the existing contexts but others are missing", async () => {
    // Defensive: if branchProtectionContexts somehow returns a set that lacks REQUIRED_CHECK
    // in the .includes check but the union would re-add it, dedupe keeps a single entry. Here
    // REQUIRED_CHECK is absent so protect runs; the union must not double `foo`.
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["foo", "foo"],
      secretExists: async () => true,
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(calls).toEqual(["protect:o/r:main:foo,ci / ci"]);
  });

  it("does not open a second PR when a self-updating PR is already open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => [],
      findOpenSelfUpdatingPR: async () => "https://github.com/o/r/pull/9",
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci / ci"],
      secretExists: async () => true,
    });
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(push).not.toHaveBeenCalled();
    expect(calls).not.toContain("pr:o/r");
    expect(r.notes).toContain("pull/9");
    expect(r.status).toBe("applied");
  });

  it("fails when there is no git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    // no git init, no gitRepo → resolveRepo returns null
    const { gh } = fakeGitHub();
    const r = await selfUpdating({ path: dir, name: "r" }, { github: gh, renovateToken: "RT" });
    expect(r.status).toBe("failed");
    expect(r.notes).toContain("no Git repo");
  });

  it("refuses a malformed gitRepo without making any gh call (token-to-attacker-repo guard)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub();
    for (const gitRepo of ["../evil", "o", "o/r/x", "o /r", "https://github.com/o/r"]) {
      const r = await selfUpdating(
        { path: dir, name: "r", gitRepo },
        { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
      );
      expect(r.status).toBe("failed");
      expect(r.notes).toMatch(/malformed repo identity/);
    }
    // No mutating gh call should have run for any malformed value.
    expect(calls).toEqual([]);
  });
});
