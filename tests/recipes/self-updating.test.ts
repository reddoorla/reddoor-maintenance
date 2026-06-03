import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { selfUpdating } from "../../src/recipes/self-updating/index.js";
import type { GitHub } from "../../src/github/gh.js";

function gitInit(dir: string) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // Persist identity at repo level (not just inline on the init commit) so the
  // recipe's own commit later inherits it. Inline -c covers only that one commit,
  // which left CI runners with no global identity failing on the recipe's commit.
  execFileSync("git", ["config", "user.email", "test@reddoor.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "reddoor-test"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r.git"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "r", scripts: {} }));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
}

function fakeGitHub(): { gh: GitHub; calls: string[] } {
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
    filesOnBranch: async (_repo, _branch, paths) => paths,
    branchProtectionContexts: async () => [],
    secretExists: async () => false,
    autoMergeEnabled: async () => false,
    findOpenSelfUpdatingPR: async () => null,
  };
  return { gh, calls };
}

describe("selfUpdating recipe", () => {
  it("writes the three files, pushes, opens a PR, and applies repo settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh, calls } = fakeGitHub();
    const push = vi.fn(async () => {});
    const result = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: push, renovateToken: "RT" },
    );
    expect(result.status).toBe("applied");
    expect(existsSync(join(dir, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(dir, "renovate.json"))).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    expect(calls).toContain("automerge:o/r");
    expect(calls).toContain("protect:o/r:main:ci");
    expect(calls).toContain("secret:o/r:RENOVATE_TOKEN");
    expect(calls.some((c) => c.startsWith("pr:o/r"))).toBe(true);
    expect(result.notes).toContain("https://github.com/o/r/pull/1");
  });

  it("noops when the three files already exist and match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    const { gh } = fakeGitHub();
    await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    const second = await selfUpdating(
      { path: dir, name: "r", gitRepo: "o/r" },
      { github: gh, pushBranch: vi.fn(async () => {}), renovateToken: "RT" },
    );
    expect(second.status).toBe("noop");
  });
});
