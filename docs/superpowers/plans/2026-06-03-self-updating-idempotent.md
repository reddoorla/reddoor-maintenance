# Idempotent self-updating ("ensure end-state") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `self-updating` an idempotent operation that drives a repo to a known end-state (CI files on the default branch + auto-merge + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret), checking remote state and acting only on what's missing.

**Architecture:** Add five remote-read methods to the `GitHub` interface, then rewrite the `selfUpdating` recipe to (A) bootstrap the CI files via PR only if they're absent from the default branch, and (B) ensure each repo setting independently via check-then-ensure. The rewrite drops `withRecipe` because ensuring settings must not require a branch. Idempotency provides self-healing for partial-failure (Important #2).

**Tech Stack:** TypeScript (ESM, `exactOptionalPropertyTypes`), vitest, pnpm, `gh` CLI via the existing `spawn` DI.

**Spec:** `docs/superpowers/specs/2026-06-03-self-updating-idempotent-design.md`

---

### Task 1: Add five remote-read methods to the GitHub interface

**Files:**
- Modify: `src/github/gh.ts` (the `GitHub` type + `makeGitHub` return object)
- Test: `tests/github/gh.test.ts`

**Context:** `makeGitHub` wraps the `gh` CLI. `gh(args)` throws on non-zero exit; existence checks that must tolerate a 404 call `spawn` directly and inspect `r.code` (see `repoExists`). The test file uses a `fakeSpawn(result)` helper that records calls and returns `{ code: 0, stdout: "", stderr: "", ...result }` for **every** call.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe("makeGitHub", …)` block in `tests/github/gh.test.ts`:

```ts
it("filesOnBranch returns the subset of paths that exist (code 0)", async () => {
  const { spawn, calls } = fakeSpawn({ code: 0 });
  const gh = makeGitHub({ token: "T", spawn });
  const present = await gh.filesOnBranch("o/r", "main", [".github/workflows/ci.yml", "renovate.json"]);
  expect(present).toEqual([".github/workflows/ci.yml", "renovate.json"]);
  expect(calls[0]!.args).toEqual(["api", "repos/o/r/contents/.github/workflows/ci.yml?ref=main"]);
  expect(calls[1]!.args).toEqual(["api", "repos/o/r/contents/renovate.json?ref=main"]);
});

it("filesOnBranch treats non-zero (404) as absent", async () => {
  const { spawn } = fakeSpawn({ code: 1 });
  const present = await makeGitHub({ token: "T", spawn }).filesOnBranch("o/r", "main", ["renovate.json"]);
  expect(present).toEqual([]);
});

it("branchProtectionContexts parses required contexts; [] on 404", async () => {
  const ok = fakeSpawn({ code: 0, stdout: "ci\nbuild\n" });
  expect(await makeGitHub({ token: "T", spawn: ok.spawn }).branchProtectionContexts("o/r", "main")).toEqual(["ci", "build"]);
  expect(ok.calls[0]!.args).toEqual([
    "api",
    "repos/o/r/branches/main/protection",
    "--jq",
    ".required_status_checks.contexts[]?",
  ]);
  const missing = fakeSpawn({ code: 1, stderr: "Not Found" });
  expect(await makeGitHub({ token: "T", spawn: missing.spawn }).branchProtectionContexts("o/r", "main")).toEqual([]);
});

it("secretExists checks the secret name list", async () => {
  const has = fakeSpawn({ code: 0, stdout: "RENOVATE_TOKEN\nOTHER\n" });
  expect(await makeGitHub({ token: "T", spawn: has.spawn }).secretExists("o/r", "RENOVATE_TOKEN")).toBe(true);
  expect(has.calls[0]!.args).toEqual(["api", "repos/o/r/actions/secrets", "--jq", ".secrets[].name"]);
  const none = fakeSpawn({ code: 0, stdout: "OTHER\n" });
  expect(await makeGitHub({ token: "T", spawn: none.spawn }).secretExists("o/r", "RENOVATE_TOKEN")).toBe(false);
});

it("autoMergeEnabled reads .allow_auto_merge", async () => {
  const on = fakeSpawn({ code: 0, stdout: "true\n" });
  expect(await makeGitHub({ token: "T", spawn: on.spawn }).autoMergeEnabled("o/r")).toBe(true);
  expect(on.calls[0]!.args).toEqual(["api", "repos/o/r", "--jq", ".allow_auto_merge"]);
  const off = fakeSpawn({ code: 0, stdout: "false\n" });
  expect(await makeGitHub({ token: "T", spawn: off.spawn }).autoMergeEnabled("o/r")).toBe(false);
});

it("findOpenSelfUpdatingPR returns the first matching PR url or null", async () => {
  const found = fakeSpawn({ code: 0, stdout: "https://github.com/o/r/pull/9\n" });
  expect(await makeGitHub({ token: "T", spawn: found.spawn }).findOpenSelfUpdatingPR("o/r")).toBe(
    "https://github.com/o/r/pull/9",
  );
  expect(found.calls[0]!.args).toEqual([
    "api",
    "repos/o/r/pulls?state=open",
    "--jq",
    '.[] | select(.head.ref | startswith("maint/self-updating-")) | .html_url',
  ]);
  const none = fakeSpawn({ code: 0, stdout: "" });
  expect(await makeGitHub({ token: "T", spawn: none.spawn }).findOpenSelfUpdatingPR("o/r")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/github/gh.test.ts`
Expected: FAIL — the new methods don't exist on `GitHub` (type error / `is not a function`).

- [ ] **Step 3: Add the methods to the `GitHub` type**

In `src/github/gh.ts`, add to the `GitHub` type (after `defaultBranch`):

```ts
  filesOnBranch: (repo: string, branch: string, paths: string[]) => Promise<string[]>;
  branchProtectionContexts: (repo: string, branch: string) => Promise<string[]>;
  secretExists: (repo: string, name: string) => Promise<boolean>;
  autoMergeEnabled: (repo: string) => Promise<boolean>;
  findOpenSelfUpdatingPR: (repo: string) => Promise<string | null>;
```

- [ ] **Step 4: Implement the methods in `makeGitHub`**

Add to the returned object in `src/github/gh.ts` (after `defaultBranch`). Note `filesOnBranch` and `branchProtectionContexts` call `spawn` directly to tolerate non-zero exits; the others use `gh()` (which throws on error):

```ts
    async filesOnBranch(repo, branch, paths) {
      const present: string[] = [];
      for (const p of paths) {
        const r = await spawn("gh", ["api", `repos/${repo}/contents/${p}?ref=${branch}`], {
          env,
          timeoutMs: 60_000,
        });
        if (r.code === 0) present.push(p);
      }
      return present;
    },
    async branchProtectionContexts(repo, branch) {
      const r = await spawn(
        "gh",
        ["api", `repos/${repo}/branches/${branch}/protection`, "--jq", ".required_status_checks.contexts[]?"],
        { env, timeoutMs: 60_000 },
      );
      if (r.code !== 0) return []; // 404 = no protection configured
      return r.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    },
    async secretExists(repo, name) {
      const out = await gh(["api", `repos/${repo}/actions/secrets`, "--jq", ".secrets[].name"]);
      return out
        .split("\n")
        .map((l) => l.trim())
        .includes(name);
    },
    async autoMergeEnabled(repo) {
      const out = await gh(["api", `repos/${repo}`, "--jq", ".allow_auto_merge"]);
      return out.trim() === "true";
    },
    async findOpenSelfUpdatingPR(repo) {
      const out = await gh([
        "api",
        `repos/${repo}/pulls?state=open`,
        "--jq",
        '.[] | select(.head.ref | startswith("maint/self-updating-")) | .html_url',
      ]);
      const first = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      return first ?? null;
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/github/gh.test.ts`
Expected: PASS (all prior tests + the 6 new ones).

- [ ] **Step 6: Commit**

```bash
git add src/github/gh.ts tests/github/gh.test.ts
git commit -m "feat(github): add remote-read methods for idempotent self-updating"
```

---

### Task 2: Rewrite the selfUpdating recipe to ensure end-state

**Files:**
- Modify: `src/recipes/self-updating/index.ts` (full rewrite of the recipe body)
- Test: `tests/recipes/self-updating.test.ts` (extend `fakeGitHub`, replace the scenarios)

**Context:** The current recipe uses `withRecipe` and gates everything on a local file-drift check. `RecipeResult` is `{ recipe, site, status, commits, notes? }`; the `site` field is `siteLabel(site)` = `site.name ?? site.path`. Git utilities available from `../../util/git.js`: `branchName`, `createBranch`, `commit`, `isWorkingTreeClean`, `push`, `getRemoteUrl`, `parseOwnerRepo`. The `commit(cwd, msg)` util returns the SHA or `null`.

- [ ] **Step 1: Write the failing tests**

Replace the entire body of `tests/recipes/self-updating.test.ts` with the following. The `gitInit` helper is unchanged from the current file (persists repo identity); `fakeGitHub` gains the five readers with per-scenario overrides.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/recipes/self-updating.test.ts`
Expected: FAIL — the recipe still uses the old drift logic / lacks the new behavior (e.g. "fully wired" still bootstraps, `fakeGitHub` overrides ignored).

- [ ] **Step 3: Rewrite the recipe**

Replace the entire contents of `src/recipes/self-updating/index.ts` with:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { templatesByName } from "../sync-configs/templates.js";
import {
  getRemoteUrl,
  parseOwnerRepo,
  push as gitPush,
  branchName,
  createBranch,
  commit as gitCommit,
  isWorkingTreeClean,
} from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import { readGitHubConfig } from "../../github/config.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";

const SELF_UPDATING_CONFIGS = ["ci", "renovate-action", "renovate-config"] as const;

export type SelfUpdatingDeps = {
  github?: GitHub;
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  renovateToken?: string;
};

function resultOf(
  site: Site,
  status: RecipeResult["status"],
  notes: string,
  commits: string[] = [],
): RecipeResult {
  return { recipe: "self-updating", site: siteLabel(site), status, commits, notes };
}

async function resolveRepo(site: Site): Promise<string | null> {
  if (site.gitRepo) return site.gitRepo;
  try {
    return parseOwnerRepo(await getRemoteUrl(site.path));
  } catch {
    return null;
  }
}

export async function selfUpdating(site: Site, deps: SelfUpdatingDeps = {}): Promise<RecipeResult> {
  const templates = templatesByName([...SELF_UPDATING_CONFIGS]);
  const paths = templates.map((t) => t.path);

  const repo = await resolveRepo(site);
  if (!repo) {
    return resultOf(site, "failed", "no Git repo (set Airtable 'Git repo' or add an origin remote)");
  }

  const cfg = readGitHubConfig();
  const renovateToken = deps.renovateToken ?? cfg?.renovateToken;
  if (!deps.github && !cfg) return resultOf(site, "failed", "GITHUB_TOKEN not set");
  if (!renovateToken) return resultOf(site, "failed", "no RENOVATE_TOKEN available");
  const github = deps.github ?? makeGitHub({ token: cfg!.token });

  const base = await github.defaultBranch(repo).catch(() => "main");
  const actions: string[] = [];
  const commits: string[] = [];

  try {
    // A. CI files on the default branch.
    const present = await github.filesOnBranch(repo, base, paths);
    if (present.length < paths.length) {
      const existingPR = await github.findOpenSelfUpdatingPR(repo);
      if (existingPR) {
        actions.push(`bootstrap PR already open: ${existingPR}`);
      } else {
        if (!(await isWorkingTreeClean(site.path))) {
          return resultOf(site, "failed", "working tree not clean — commit or stash first");
        }
        const branch = branchName("self-updating");
        await createBranch(site.path, branch);
        for (const t of templates) {
          const dest = join(site.path, t.path);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, t.contents, "utf-8");
        }
        const sha = await gitCommit(site.path, "ci: enable self-updating (CI + Renovate auto-merge)");
        if (sha) commits.push(sha);
        await (deps.pushBranch ?? gitPush)(site.path, branch);
        const pr = await github.openPullRequest(repo, {
          head: branch,
          base,
          title: "Enable self-updating (CI + Renovate)",
          body: "Adds the unified CI gate, nightly Renovate, and auto-merge for patch/minor updates.",
        });
        actions.push(`opened PR ${pr.url}`);
      }
    }

    // B. Repo settings — check-then-ensure, each independent (self-healing).
    if (!(await github.autoMergeEnabled(repo))) {
      await github.enableRepoAutoMerge(repo);
      actions.push("enabled auto-merge");
    }
    if (!(await github.branchProtectionContexts(repo, base)).includes("ci")) {
      await github.protectBranch(repo, base, ["ci"]);
      actions.push(`required ci check on ${base}`);
    }
    if (!(await github.secretExists(repo, "RENOVATE_TOKEN"))) {
      await github.setRepoSecret(repo, "RENOVATE_TOKEN", renovateToken);
      actions.push("set RENOVATE_TOKEN secret");
    }
  } catch (err) {
    const done = actions.length ? ` (completed: ${actions.join("; ")})` : "";
    return resultOf(site, "failed", `${(err as Error).message}${done}`, commits);
  }

  return actions.length
    ? resultOf(site, "applied", actions.join("; "), commits)
    : resultOf(site, "noop", "already self-updating", commits);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/recipes/self-updating.test.ts`
Expected: PASS (all six scenarios).

- [ ] **Step 5: Run the full gate**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run`
Expected: tsc clean, lint clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/recipes/self-updating/index.ts tests/recipes/self-updating.test.ts
git commit -m "feat(recipes): make self-updating idempotent (ensure end-state)"
```

---

### Task 3: Changeset

**Files:**
- Create: `.changeset/self-updating-idempotent.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/self-updating-idempotent.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

`self-updating` is now idempotent: it drives a repo to a known end-state (CI files on the default branch + auto-merge + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret), checking remote state and acting only on what's missing. This fixes two gaps: `init`→`self-updating` no longer skips the GitHub wiring just because `sync-configs` already wrote the CI files, and a partial-failure run now self-heals on re-run instead of leaving a repo half-configured. New remote-read methods on the `GitHub` wrapper (`filesOnBranch`, `branchProtectionContexts`, `secretExists`, `autoMergeEnabled`, `findOpenSelfUpdatingPR`).
```

- [ ] **Step 2: Verify formatting + commit**

Run: `pnpm exec prettier --check .changeset/self-updating-idempotent.md`
Expected: "All matched files use Prettier code style!"

```bash
git add .changeset/self-updating-idempotent.md
git commit -m "chore: changeset for idempotent self-updating"
```

---

## Notes for the implementer

- **Do not** change `sync-configs`, `init`, or `withRecipe` — the rewrite only touches `self-updating` and `gh.ts`.
- The recipe no longer imports `withRecipe` or `readMaybe`; remove those imports (the rewrite in Task 2 Step 3 is a full file replacement, so this is automatic).
- `gitCommit` is the aliased import of `commit` from the git util (avoids shadowing).
- Branch protection intentionally sets `["ci"]` rather than unioning with pre-existing contexts — documented YAGNI in the spec; fleet repos have no custom protection.
- Reviewers: **do not** run `git checkout` to a different branch; verify on the current branch.
