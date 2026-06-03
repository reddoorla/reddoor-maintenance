import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { selfUpdating } from "../../src/recipes/self-updating/index.js";
import type { GitHub } from "../../src/github/gh.js";

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
    ...over,
  };
  return { gh, calls };
}

const ALL_PATHS = [".github/workflows/ci.yml", ".github/workflows/renovate.yml", "renovate.json"];

describe("selfUpdating recipe", () => {
  it("fresh repo: bootstraps files via PR and wires all three settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub();
    const push = vi.fn(async () => {});
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(existsSync(join(dir, ".github/workflows/ci.yml"))).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    expect(calls).toContain("pr:o/r");
    expect(calls).toContain("automerge:o/r");
    expect(calls).toContain("protect:o/r:main:ci");
    expect(calls).toContain("secret:o/r:RENOVATE_TOKEN");
    expect(r.notes).toContain("https://github.com/o/r/pull/1");
  });

  it("fully wired: no mutating calls, noop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci"],
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
  });

  it("self-heals a half-configured repo: only the missing secret is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci"],
      secretExists: async () => false,
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(calls).toEqual(["secret:o/r:RENOVATE_TOKEN"]);
  });

  it("adds the ci check when branch protection lacks it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => ALL_PATHS,
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["other-check"],
      secretExists: async () => true,
    });
    const r = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(r.status).toBe("applied");
    expect(calls).toEqual(["protect:o/r:main:ci"]);
  });

  it("does not open a second PR when a self-updating PR is already open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub({
      filesOnBranch: async () => [],
      findOpenSelfUpdatingPR: async () => "https://github.com/o/r/pull/9",
      autoMergeEnabled: async () => true,
      branchProtectionContexts: async () => ["ci"],
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
});
