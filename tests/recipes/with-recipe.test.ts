import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withRecipe } from "../../src/recipes/_with-recipe.js";

/** A committed, clean git repo on branch `main` with a single tracked file. */
function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wr-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@reddoor.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "reddoor-test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hi\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  return dir;
}

function branchOf(dir: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
    encoding: "utf-8",
  }).trim();
}

function localBranches(dir: string): string[] {
  return execFileSync("git", ["branch", "--format=%(refname:short)"], {
    cwd: dir,
    encoding: "utf-8",
  })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function readReadme(dir: string): string {
  return execFileSync("cat", ["README.md"], { cwd: dir, encoding: "utf-8" });
}

describe("withRecipe checkout safety", () => {
  it("stays on the maint branch after an APPLIED run (preserves pipeline composition)", async () => {
    // The fleet onboarding pipeline runs recipes in sequence against ONE checkout,
    // each building on the prior's committed files in the working tree. So an
    // applied recipe must NOT restore to base — it leaves the operator on the maint
    // branch with the committed change present.
    const dir = freshRepo();
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });

    const result = await withRecipe<null>({
      name: "sync-configs",
      site: { path: dir, name: "r" },
      plan: async () => ({ kind: "apply", plan: null }),
      apply: async (_p, { commit }) => {
        writeFileSync(join(dir, "added.txt"), "new\n");
        await commit("chore: add file");
        return { kind: "ok" };
      },
    });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(branchOf(dir)).toMatch(/^maint\/sync-configs-/);
    expect(existsSync(join(dir, "added.txt"))).toBe(true); // committed file present in worktree
    expect(localBranches(dir)).toContain("work"); // original branch preserved
  });

  it("restores the operator's original branch after a NOOP-from-apply run (no commits)", async () => {
    // No commits → nothing to compose, so don't leave the operator parked on an
    // empty maint branch; return them to where they started.
    const dir = freshRepo();
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });

    const result = await withRecipe<null>({
      name: "sync-configs",
      site: { path: dir, name: "r" },
      plan: async () => ({ kind: "apply", plan: null }),
      apply: async () => ({ kind: "ok" }), // makes no commits → status noop
    });

    expect(result.status).toBe("noop");
    expect(branchOf(dir)).toBe("work");
  });

  it("force-restores original + deletes the recipe branch when apply THROWS mid-mutation", async () => {
    const dir = freshRepo();
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
    expect(branchOf(dir)).toBe("work");

    await expect(
      withRecipe<null>({
        name: "sync-configs",
        site: { path: dir, name: "r" },
        plan: async () => ({ kind: "apply", plan: null }),
        apply: async () => {
          // Make a TRACKED, uncommitted modification on the recipe branch, then blow up.
          writeFileSync(join(dir, "README.md"), "MUTATED\n");
          throw new Error("boom mid-apply");
        },
      }),
    ).rejects.toThrow(/boom mid-apply/);

    // Back on the original branch, recipe branch deleted, the tracked change discarded.
    expect(branchOf(dir)).toBe("work");
    expect(localBranches(dir)).toContain("work"); // original is NEVER deleted
    expect(localBranches(dir).some((b) => b.startsWith("maint/sync-configs-"))).toBe(false);
    expect(readReadme(dir)).toBe("hi\n"); // checkout -f reverted the tracked WIP edit
  });

  it("force-restores original + deletes the recipe branch when apply RETURNS failed", async () => {
    const dir = freshRepo();
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });

    const result = await withRecipe<null>({
      name: "sync-configs",
      site: { path: dir, name: "r" },
      plan: async () => ({ kind: "apply", plan: null }),
      apply: async () => {
        writeFileSync(join(dir, "README.md"), "MUTATED\n");
        return { kind: "failed", notes: "could not finish" };
      },
    });

    expect(result.status).toBe("failed");
    expect(result.notes).toBe("could not finish");
    expect(branchOf(dir)).toBe("work");
    expect(localBranches(dir)).toContain("work");
    expect(localBranches(dir).some((b) => b.startsWith("maint/sync-configs-"))).toBe(false);
    expect(readReadme(dir)).toBe("hi\n");
  });

  it("does NOT run git clean on failure — untracked (gitignored) operator files survive", async () => {
    const dir = freshRepo();
    // Gitignore the scratch path so the tree stays CLEAN (withRecipe refuses a
    // dirty tree) while the file remains untracked — exactly the case `git clean`
    // would nuke but `checkout -f` leaves alone.
    writeFileSync(join(dir, ".gitignore"), "operator-scratch.txt\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "ignore scratch"], { cwd: dir });
    execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir });
    writeFileSync(join(dir, "operator-scratch.txt"), "do not delete me\n");

    await withRecipe<null>({
      name: "sync-configs",
      site: { path: dir, name: "r" },
      plan: async () => ({ kind: "apply", plan: null }),
      apply: async () => ({ kind: "failed", notes: "fail" }),
    });

    // checkout -f only reverts TRACKED paths; an untracked operator file must remain.
    expect(existsSync(join(dir, "operator-scratch.txt"))).toBe(true);
    expect(readdirSync(dir)).toContain("operator-scratch.txt");
  });
});
