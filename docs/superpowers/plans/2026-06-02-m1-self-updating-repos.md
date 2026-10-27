# M1 (a+b) — Self-Updating Repos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tool GitHub/CI awareness and a one-shot recipe that turns a fleet repo into a self-updating repo — unified CI gate (format+lint, typecheck, build, a11y), nightly Renovate, patch/minor auto-merge on green, majors → PR.

**Architecture:** A new `src/github/` module shells to the `gh` CLI (via the canonical `defaultSpawn`) for PR/branch-protection/secret operations; a new `self-updating` recipe (on the existing `withRecipe` framework) writes three canonical files + pushes + opens a PR + applies repo settings; those three files also join the `sync-configs` synced set so the standard stays unified fleet-wide. Repo identity comes from a new Airtable `Git repo` field, falling back to the local git remote.

**Tech stack:** TypeScript, the `gh` CLI, `renovatebot/github-action`, GitHub Actions, Airtable JS SDK, vitest, pnpm, tsup, changesets.

**Branch:** create `feat/self-updating-repos` off `main` before Task 1.

**Spec:** [2026-06-02-m1-self-updating-repos-design.md](../specs/2026-06-02-m1-self-updating-repos-design.md). **Decisions locked there:** Renovate as a self-hosted Action; patch/minor auto-merge, majors→PR; CI gate = format+lint→typecheck→build→a11y (+test if present), no lighthouse; **a11y gate is zero-tolerance** (fails on any violation); `gh` CLI (no Octokit); two tokens (`GITHUB_TOKEN` broad on-machine, `RENOVATE_TOKEN` narrow per-repo secret); single token for now.

---

## File Structure

- **Create** `src/github/config.ts` — `readGitHubConfig()`.
- **Create** `src/github/gh.ts` — `makeGitHub({ token, spawn })` → typed wrappers over `gh`.
- **Modify** `src/util/git.ts` — add `push`, `getRemoteUrl`, `parseOwnerRepo`.
- **Modify** `src/cli/commands/audit.ts` + `src/cli/bin.ts` — `--fail-on-violations` + a pure `auditExitCode`.
- **Modify** `src/reports/airtable/websites.ts` — `WebsiteRow.gitRepo` + `mapRow`.
- **Modify** `src/types.ts` — `Site.gitRepo` + three new `ConfigName`s.
- **Modify** `src/inventory/airtable.ts` — thread `gitRepo` into the `Site`.
- **Modify** `src/recipes/sync-configs/templates.ts` — three canonical templates (`ci.yml`, `renovate.yml`, `renovate.json`) + `ALL_TEMPLATES`.
- **Modify** `src/recipes/sync-configs.ts` — add names to `ALL_CONFIG_NAMES`; **mkdir parent dirs** in the write loop.
- **Create** `src/recipes/self-updating/index.ts` — the recipe.
- **Create** `src/cli/commands/self-updating.ts` + **modify** `src/cli/bin.ts` — command wiring + `RecipeName` + `RECIPE_DESCRIPTIONS`.
- **Modify** `tests/types.test.ts` — the hard-coded `ConfigName` lists.
- **Airtable** — new "Git repo" field on Websites (Task 9).

---

## Task 1: git util — `parseOwnerRepo`, `getRemoteUrl`, `push`

**Files:** Modify `src/util/git.ts`; Test `tests/util/git-owner-repo.test.ts` (create).

- [ ] **Step 1: Write the failing test** (`tests/util/git-owner-repo.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { parseOwnerRepo } from "../../src/util/git.js";

describe("parseOwnerRepo", () => {
  it("parses https URLs with and without .git", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds.git")).toBe(
      "tucksravin/erpfunds",
    );
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds")).toBe("tucksravin/erpfunds");
  });
  it("parses scp-style git@ URLs", () => {
    expect(parseOwnerRepo("git@github.com:tucksravin/erpfunds.git")).toBe("tucksravin/erpfunds");
  });
  it("strips a trailing slash", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds/")).toBe("tucksravin/erpfunds");
  });
  it("returns null for an unparseable remote", () => {
    expect(parseOwnerRepo("not a url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/util/git-owner-repo.test.ts`
Expected: FAIL — `parseOwnerRepo` not exported.

- [ ] **Step 3: Implement** — append to `src/util/git.ts` (it already has a private `git(cwd, args)` wrapping promisified `execFile`; match that style):

```typescript
/** Derive `owner/repo` from a git remote URL (https or scp-style). Null if unparseable. */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const trimmed = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  // scp-style: git@github.com:owner/repo
  const scp = trimmed.match(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(.+)$/);
  const path = scp ? scp[1]! : trimmed.replace(/^https?:\/\/[^/]+\//, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

/** `origin` remote URL for a checkout, trimmed. Throws (via git) if there's no origin. */
export async function getRemoteUrl(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["remote", "get-url", "origin"]);
  return stdout.trim();
}

/** Push a branch to origin, setting upstream. Throws on non-zero (execFile rejects). */
export async function push(cwd: string, branch: string): Promise<void> {
  await git(cwd, ["push", "-u", "origin", branch]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/util/git-owner-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/git.ts tests/util/git-owner-repo.test.ts
git commit -m "feat(git): parseOwnerRepo + getRemoteUrl + push helpers"
```

---

## Task 2: `readGitHubConfig()`

**Files:** Create `src/github/config.ts`; Test `tests/github/config.test.ts`.

- [ ] **Step 1: Write the failing test** (`tests/github/config.test.ts`) — mirror `tests/reports/search/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readGitHubConfig } from "../../src/github/config.js";

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.RENOVATE_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("readGitHubConfig", () => {
  it("returns null when GITHUB_TOKEN is unset", () => {
    process.env.RENOVATE_TOKEN = "r";
    expect(readGitHubConfig()).toBeNull();
  });
  it("returns the broad token + renovate token when present", () => {
    process.env.GITHUB_TOKEN = "ghp_broad";
    process.env.RENOVATE_TOKEN = "ghp_narrow";
    expect(readGitHubConfig()).toEqual({ token: "ghp_broad", renovateToken: "ghp_narrow" });
  });
  it("falls back renovateToken to the broad token when RENOVATE_TOKEN unset", () => {
    process.env.GITHUB_TOKEN = "ghp_broad";
    expect(readGitHubConfig()).toEqual({ token: "ghp_broad", renovateToken: "ghp_broad" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/github/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/github/config.ts`):

```typescript
export type GitHubConfig = {
  /** Broad PAT used by the tool's own `gh` calls (PRs, branch protection, secrets). */
  token: string;
  /** Narrow PAT stored per-repo as the RENOVATE_TOKEN secret. Falls back to `token`. */
  renovateToken: string;
};

/**
 * Read GitHub config from the environment (credentials.env is loaded into process.env by the CLI).
 * Returns null when GITHUB_TOKEN is unset — the signal that git/GitHub features aren't configured.
 * RENOVATE_TOKEN falls back to GITHUB_TOKEN when unset (a narrower token is recommended but optional).
 */
export function readGitHubConfig(): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const renovateToken = process.env.RENOVATE_TOKEN?.trim() || token;
  return { token, renovateToken };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/github/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/config.ts tests/github/config.test.ts
git commit -m "feat(github): readGitHubConfig (GITHUB_TOKEN + RENOVATE_TOKEN)"
```

---

## Task 3: `gh` CLI wrappers — `src/github/gh.ts`

**Files:** Create `src/github/gh.ts`; Test `tests/github/gh.test.ts`. Uses the canonical `SpawnFn` from `src/audits/util/spawn.ts` (DI for tests; resolves on any exit, caller checks `code`).

- [ ] **Step 1: Write the failing test** (`tests/github/gh.test.ts`):

```typescript
import { describe, it, expect, vi } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";
import type { SpawnFn, SpawnResult } from "../../src/audits/util/spawn.js";

function fakeSpawn(result: Partial<SpawnResult>): { spawn: SpawnFn; calls: any[] } {
  const calls: any[] = [];
  const spawn: SpawnFn = async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts });
    return { code: 0, stdout: "", stderr: "", ...result };
  };
  return { spawn, calls };
}

describe("makeGitHub", () => {
  it("openPullRequest calls gh pr create with the token in env and returns the URL", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: "https://github.com/o/r/pull/7\n" });
    const gh = makeGitHub({ token: "T", spawn });
    const out = await gh.openPullRequest("o/r", {
      head: "maint/x",
      base: "main",
      title: "t",
      body: "b",
    });
    expect(out).toEqual({ url: "https://github.com/o/r/pull/7" });
    expect(calls[0].cmd).toBe("gh");
    expect(calls[0].args).toEqual([
      "pr",
      "create",
      "--repo",
      "o/r",
      "--head",
      "maint/x",
      "--base",
      "main",
      "--title",
      "t",
      "--body",
      "b",
    ]);
    expect(calls[0].opts.env.GH_TOKEN).toBe("T");
  });

  it("enableRepoAutoMerge PATCHes allow_auto_merge", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).enableRepoAutoMerge("o/r");
    expect(calls[0].args).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/o/r",
      "-F",
      "allow_auto_merge=true",
    ]);
  });

  it("protectBranch requires the named checks", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci"]);
    expect(calls[0].args[0]).toBe("api");
    expect(calls[0].args).toContain("-X");
    expect(calls[0].args).toContain("PUT");
    expect(calls[0].args.join(" ")).toContain("repos/o/r/branches/main/protection");
    // the required check context is passed
    expect(calls[0].args.join(" ")).toContain("ci");
  });

  it("setRepoSecret calls gh secret set", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).setRepoSecret("o/r", "RENOVATE_TOKEN", "v");
    expect(calls[0].args).toEqual([
      "secret",
      "set",
      "RENOVATE_TOKEN",
      "--repo",
      "o/r",
      "--body",
      "v",
    ]);
  });

  it("throws on non-zero exit", async () => {
    const { spawn } = fakeSpawn({ code: 1, stderr: "boom" });
    await expect(makeGitHub({ token: "T", spawn }).enableRepoAutoMerge("o/r")).rejects.toThrow(
      "boom",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/github/gh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/github/gh.ts`):

```typescript
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";

export type GitHub = {
  openPullRequest: (
    repo: string,
    pr: { head: string; base: string; title: string; body: string },
  ) => Promise<{ url: string }>;
  enableRepoAutoMerge: (repo: string) => Promise<void>;
  protectBranch: (repo: string, branch: string, requiredChecks: string[]) => Promise<void>;
  setRepoSecret: (repo: string, name: string, value: string) => Promise<void>;
  repoExists: (repo: string) => Promise<boolean>;
  defaultBranch: (repo: string) => Promise<string>;
};

export function makeGitHub(deps: { token: string; spawn?: SpawnFn }): GitHub {
  const spawn = deps.spawn ?? defaultSpawn;
  const env = { ...process.env, GH_TOKEN: deps.token };

  async function gh(args: string[]): Promise<string> {
    const r = await spawn("gh", args, { env, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`gh ${args[0]} failed (code ${r.code}): ${r.stderr.trim()}`);
    return r.stdout;
  }

  return {
    async openPullRequest(repo, pr) {
      const out = await gh([
        "pr",
        "create",
        "--repo",
        repo,
        "--head",
        pr.head,
        "--base",
        pr.base,
        "--title",
        pr.title,
        "--body",
        pr.body,
      ]);
      return { url: out.trim() };
    },
    async enableRepoAutoMerge(repo) {
      await gh(["api", "-X", "PATCH", `repos/${repo}`, "-F", "allow_auto_merge=true"]);
    },
    async protectBranch(repo, branch, requiredChecks) {
      // Require the named status checks (strict), no required reviews (solo operator),
      // enforce for admins so auto-merge waits for green.
      const args = [
        "api",
        "-X",
        "PUT",
        `repos/${repo}/branches/${branch}/protection`,
        "-H",
        "Accept: application/vnd.github+json",
        "-F",
        "required_status_checks[strict]=true",
        ...requiredChecks.flatMap((c) => ["-f", `required_status_checks[contexts][]=${c}`]),
        "-F",
        "enforce_admins=true",
        "-F",
        "required_pull_request_reviews=null",
        "-F",
        "restrictions=null",
      ];
      await gh(args);
    },
    async setRepoSecret(repo, name, value) {
      await gh(["secret", "set", name, "--repo", repo, "--body", value]);
    },
    async repoExists(repo) {
      const r = await spawn("gh", ["api", `repos/${repo}`], { env, timeoutMs: 60_000 });
      return r.code === 0;
    },
    async defaultBranch(repo) {
      const out = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"]);
      return out.trim();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/github/gh.test.ts`
Expected: PASS. (If the `protectBranch` argv assertion is over-strict for the chosen `-F`/`-f` mix, adjust the test's `.toContain` checks to match the implementation — keep them behavioral, not byte-exact.)

- [ ] **Step 5: Commit**

```bash
git add src/github/gh.ts tests/github/gh.test.ts
git commit -m "feat(github): gh CLI wrappers (PR, auto-merge, branch protection, secret)"
```

---

## Task 4: `audit --fail-on-violations`

**Files:** Modify `src/cli/commands/audit.ts`, `src/cli/bin.ts`; Test `tests/audits/fail-on-violations.test.ts`. `AuditResult` is in `src/types.ts`; a11y's `details` is `{ totalViolations, byImpact, violations }`; the existing `exitCode()` only fails on `status === "fail"`, and a11y is `"warn"` for non-serious violations — so the flag needs an override.

- [ ] **Step 1: Write the failing test** (`tests/audits/fail-on-violations.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { auditExitCode } from "../../src/cli/commands/audit.js";
import type { AuditResult } from "../../src/types.js";

const a11y = (totalViolations: number, status: AuditResult["status"]): AuditResult => ({
  audit: "a11y",
  site: "s",
  status,
  summary: "",
  details: { totalViolations, byImpact: {}, violations: [] },
});

describe("auditExitCode", () => {
  it("is 0 for a clean run without the flag", () => {
    expect(auditExitCode([a11y(0, "pass")], false)).toBe(0);
  });
  it("is 1 when a result status is fail (existing behavior)", () => {
    expect(auditExitCode([a11y(3, "fail")], false)).toBe(1);
  });
  it("stays 0 on a 'warn' a11y result WITHOUT the flag", () => {
    expect(auditExitCode([a11y(2, "warn")], false)).toBe(0);
  });
  it("is 1 on ANY a11y violations WHEN the flag is set (overrides warn)", () => {
    expect(auditExitCode([a11y(2, "warn")], true)).toBe(1);
  });
  it("is 0 with the flag when a11y has zero violations", () => {
    expect(auditExitCode([a11y(0, "pass")], true)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/audits/fail-on-violations.test.ts`
Expected: FAIL — `auditExitCode` not exported.

- [ ] **Step 3: Implement** — in `src/cli/commands/audit.ts`, replace the private `exitCode(results)` (around line 39) with an exported `auditExitCode(results, failOnViolations)`:

```typescript
export function auditExitCode(results: AuditResult[], failOnViolations: boolean): number {
  if (results.some((r) => r.status === "fail")) return 1;
  if (failOnViolations) {
    const a11yViolations = results
      .filter((r) => r.audit === "a11y")
      .reduce(
        (n, r) =>
          n + ((r.details as { totalViolations?: number } | undefined)?.totalViolations ?? 0),
        0,
      );
    if (a11yViolations > 0) return 1;
  }
  return 0;
}
```

Add `failOnViolations?: boolean` to `AuditCommandOptions` (audit.ts:8-20). At the end of `runAuditCommand` change the return to:

```typescript
return { output, code: auditExitCode(results, opts.failOnViolations === true) };
```

In `src/cli/bin.ts`, add to the `audit` command's option chain and inline `opts` type:

```typescript
  .option("--fail-on-violations", "Exit non-zero if any a11y violations are found (for CI gates)")
```

(cac delivers it as `failOnViolations?: boolean`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/audits/fail-on-violations.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/audit.ts src/cli/bin.ts tests/audits/fail-on-violations.test.ts
git commit -m "feat(audit): --fail-on-violations (a11y CI gate, overrides warn)"
```

---

## Task 5: `WebsiteRow.gitRepo` + `Site.gitRepo` threading

**Files:** Modify `src/reports/airtable/websites.ts`, `src/types.ts`, `src/inventory/airtable.ts`; Test `tests/inventory/airtable-gitrepo.test.ts` (create) + existing website fixtures.

- [ ] **Step 1: Add `gitRepo` to `WebsiteRow` + `mapRow`** in `src/reports/airtable/websites.ts`. After the `searchConsoleProperty` field in the type:

```typescript
/** GitHub repo identity as `owner/repo`. Null = no git wiring → self-update ops skip
 *  (or, for local runs, fall back to the checkout's origin remote). */
gitRepo: string | null;
```

In `mapRow`, after the `searchConsoleProperty:` line:

```typescript
    gitRepo: (f["Git repo"] as string | undefined) ?? null,
```

- [ ] **Step 2: Add `gitRepo` to the `Site` type** in `src/types.ts` (the `Site` type, after `repoUrl?`):

```typescript
  /** GitHub repo identity as `owner/repo`, when known (from Airtable). */
  gitRepo?: string;
```

- [ ] **Step 3: Write the failing test** (`tests/inventory/airtable-gitrepo.test.ts`) — assert `fromAirtableBase` puts `gitRepo` on the Site. Mirror the existing inventory/airtable test harness (a fake base returning one Websites row with `Git repo`); if no such harness exists, build a minimal fake `AirtableBase` whose `select().eachPage` yields one record with `fields["Git repo"] = "o/r"`, and assert `sites[0].gitRepo === "o/r"`.

```typescript
import { describe, it, expect } from "vitest";
import { fromAirtableBase } from "../../src/inventory/airtable.js";

function fakeBase(fields: Record<string, unknown>) {
  const records = [{ id: "rec1", fields }];
  return ((table: string) => ({
    select: () => ({
      eachPage: async (page: (recs: any[], next: () => void) => void) => {
        page(records, () => {});
      },
    }),
  })) as never;
}

describe("fromAirtableBase gitRepo", () => {
  it("threads the Git repo field onto the Site", async () => {
    const provider = fromAirtableBase(
      fakeBase({
        Name: "ERP",
        url: "https://erpfunds.com",
        "maintenence freq": "Monthly",
        "Git repo": "tucksravin/erpfunds",
      }),
      { workdir: "/tmp/sites" },
    );
    const sites = await provider();
    expect(sites[0]!.gitRepo).toBe("tucksravin/erpfunds");
  });
});
```

(Adjust field keys to match what `listWebsites`/`mapRow` actually read — `Name`, `url`, `maintenence freq` are the real Airtable names. Verify against `mapRow` before finalizing.)

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm exec vitest run tests/inventory/airtable-gitrepo.test.ts`
Expected: FAIL — `sites[0].gitRepo` is undefined.

- [ ] **Step 5: Implement** — in `src/inventory/airtable.ts`, where the `Site` is built (around lines 42-48), add after the `repoUrl` assignment:

```typescript
if (w.gitRepo) site.gitRepo = w.gitRepo;
```

- [ ] **Step 6: Run to verify it passes + fix fixtures**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — every `WebsiteRow` fixture now misses `gitRepo`. Add `gitRepo: null,` after each fixture's `searchConsoleProperty:` line (find them with `pnpm exec tsc --noEmit 2>&1 | grep gitRepo`). Then:

Run: `pnpm exec vitest run tests/inventory/airtable-gitrepo.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/reports/airtable/websites.ts src/types.ts src/inventory/airtable.ts tests
git commit -m "feat(airtable): Git repo field → WebsiteRow.gitRepo → Site.gitRepo"
```

---

## Task 6: Three canonical CI/Renovate templates in the synced set

**Files:** Modify `src/recipes/sync-configs/templates.ts`, `src/types.ts`, `src/recipes/sync-configs.ts`, `tests/types.test.ts`; Test `tests/recipes/ci-templates.test.ts` (create). **Gotcha:** the sync-configs apply write loop does NOT create parent dirs — `.github/workflows/` must be `mkdir`'d.

- [ ] **Step 1: Add the three `ConfigName`s** to the union in `src/types.ts` (the `ConfigName` type, lines ~20-26): add `| "ci"`, `| "renovate-action"`, `| "renovate-config"`.

- [ ] **Step 2: Add the same three to `ALL_CONFIG_NAMES`** in `src/recipes/sync-configs.ts` (lines ~23-30): `"ci"`, `"renovate-action"`, `"renovate-config"`.

- [ ] **Step 3: Update `tests/types.test.ts`** — add three `_okN` assignment lines (after the existing ones ~74-79) for the three new names, and add `"ci"`, `"renovate-action"`, `"renovate-config"` to the `all` array (~86-93) that's compared with `ALL_CONFIG_NAMES`.

- [ ] **Step 4: Write the failing test** (`tests/recipes/ci-templates.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { ALL_TEMPLATES, templatesByName } from "../../src/recipes/sync-configs/templates.js";

describe("CI/Renovate canonical templates", () => {
  it("registers the three new files at the right paths", () => {
    const byPath = Object.fromEntries(ALL_TEMPLATES.map((t) => [t.config, t.path]));
    expect(byPath["ci"]).toBe(".github/workflows/ci.yml");
    expect(byPath["renovate-action"]).toBe(".github/workflows/renovate.yml");
    expect(byPath["renovate-config"]).toBe("renovate.json");
  });
  it("ci.yml runs the four-layer gate including a11y with --fail-on-violations", () => {
    const ci = templatesByName(["ci"])[0]!.contents;
    expect(ci).toContain("prettier --check");
    expect(ci).toContain("eslint");
    expect(ci).toContain("build");
    expect(ci).toContain("reddoor-maint audit --only a11y --fail-on-violations");
    expect(ci).not.toContain("lighthouse");
  });
  it("renovate.json auto-merges patch/minor but not major", () => {
    const cfg = JSON.parse(templatesByName(["renovate-config"])[0]!.contents);
    const rules = cfg.packageRules as Array<Record<string, unknown>>;
    const patchMinor = rules.find(
      (r) =>
        Array.isArray(r.matchUpdateTypes) && (r.matchUpdateTypes as string[]).includes("minor"),
    );
    const major = rules.find(
      (r) =>
        Array.isArray(r.matchUpdateTypes) && (r.matchUpdateTypes as string[]).includes("major"),
    );
    expect(patchMinor!.automerge).toBe(true);
    expect(major!.automerge).toBe(false);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm exec vitest run tests/recipes/ci-templates.test.ts`
Expected: FAIL — templates not registered.

- [ ] **Step 6: Implement the templates** in `src/recipes/sync-configs/templates.ts` — add three `ConfigTemplate` consts (literal `contents`, trailing newline, like the `prettier` template) and add them to `ALL_TEMPLATES`:

```typescript
const ci: ConfigTemplate = {
  config: "ci",
  path: ".github/workflows/ci.yml",
  contents: `name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prettier --check .
      - run: pnpm exec eslint .
      - run: pnpm exec svelte-kit sync && pnpm exec svelte-check --tsconfig ./tsconfig.json
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm exec reddoor-maint audit --only a11y --fail-on-violations
      - name: Test (if present)
        run: |
          if node -e "process.exit(require('./package.json').scripts?.test ? 0 : 1)"; then
            pnpm test
          else
            echo "no test script — skipping"
          fi
`,
};

const renovateAction: ConfigTemplate = {
  config: "renovate-action",
  path: ".github/workflows/renovate.yml",
  contents: `name: renovate
on:
  schedule:
    - cron: "0 7 * * 1"
  workflow_dispatch:
jobs:
  renovate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: renovatebot/github-action@v40
        with:
          token: \${{ secrets.RENOVATE_TOKEN }}
        env:
          RENOVATE_REPOSITORIES: \${{ github.repository }}
`,
};

const renovateConfig: ConfigTemplate = {
  config: "renovate-config",
  path: "renovate.json",
  contents: `{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "schedule": ["before 7am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["patch", "minor"], "automerge": true, "platformAutomerge": true },
    { "matchUpdateTypes": ["major"], "automerge": false }
  ]
}
`,
};
```

Add `ci, renovateAction, renovateConfig` to the `ALL_TEMPLATES` array.

- [ ] **Step 7: Fix the mkdir gotcha** — in `src/recipes/sync-configs.ts`, the apply write loop (`for (const t of templateDiffs) { await writeFile(join(site.path, t.path), ...) }`) must create parent dirs. Add the import `import { mkdir } from "node:fs/promises";` (if not present) and change the loop body to:

```typescript
for (const t of templateDiffs) {
  const dest = join(site.path, t.path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, t.contents, "utf-8");
  await commit(`chore: sync ${t.config} config from @reddoorla/maintenance`);
}
```

(Add `dirname` to the `node:path` import.)

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm exec vitest run tests/recipes/ci-templates.test.ts tests/types.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 9: Commit**

```bash
git add src/recipes/sync-configs/templates.ts src/recipes/sync-configs.ts src/types.ts tests/types.test.ts tests/recipes/ci-templates.test.ts
git commit -m "feat(sync-configs): add canonical ci.yml + renovate.yml + renovate.json (unified CI), mkdir parents"
```

---

## Task 7: the `self-updating` recipe

**Files:** Create `src/recipes/self-updating/index.ts`; Test `tests/recipes/self-updating.test.ts`. Reuses the three templates from Task 6 (single source of truth) + Task 1 (`push`, `getRemoteUrl`, `parseOwnerRepo`) + Task 2 (`readGitHubConfig`) + Task 3 (`makeGitHub`).

- [ ] **Step 1: Write the failing test** (`tests/recipes/self-updating.test.ts`) — inject fakes for the GitHub client and a push spy; use a temp dir as the site (with the three files absent so it applies). Mirror the recipe-test style:

```typescript
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { selfUpdating } from "../../src/recipes/self-updating/index.js";
import type { GitHub } from "../../src/github/gh.js";

function gitInit(dir: string) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r.git"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "r", scripts: {} }));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t.co", "-c", "user.name=t", "commit", "-qm", "init"], {
    cwd: dir,
  });
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

  it("noops when the three files already exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "su-"));
    gitInit(dir);
    // pre-write current template contents so the plan sees no drift
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/recipes/self-updating.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/recipes/self-updating/index.ts`). Resolve the repo (`site.gitRepo` else parse origin), plan = apply unless all three files already match, apply = write files (mkdir) + commit + push + PR + settings:

```typescript
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { templatesByName } from "../sync-configs/templates.js";
import { getRemoteUrl, parseOwnerRepo, push as gitPush } from "../../util/git.js";
import { readGitHubConfig } from "../../github/config.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";

const SELF_UPDATING_CONFIGS = ["ci", "renovate-action", "renovate-config"] as const;

export type SelfUpdatingDeps = {
  github?: GitHub;
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  renovateToken?: string;
};

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
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

  return withRecipe<{ repo: string; renovateToken: string }>({
    name: "self-updating",
    site,
    plan: async () => {
      const repo = await resolveRepo(site);
      if (!repo)
        return {
          kind: "failed",
          notes: "no Git repo (set Airtable 'Git repo' or add an origin remote)",
        };

      const cfg = readGitHubConfig();
      const renovateToken = deps.renovateToken ?? cfg?.renovateToken;
      if (!deps.github && !cfg) return { kind: "failed", notes: "GITHUB_TOKEN not set" };
      if (!renovateToken) return { kind: "failed", notes: "no RENOVATE_TOKEN available" };

      let drift = false;
      for (const t of templates) {
        if ((await readMaybe(join(site.path, t.path))) !== t.contents) drift = true;
      }
      if (!drift) return { kind: "noop", notes: "self-updating files already in place" };
      return { kind: "apply", plan: { repo, renovateToken } };
    },
    apply: async (planned, { commit, branch, cwd }) => {
      for (const t of templates) {
        const dest = join(cwd, t.path);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, t.contents, "utf-8");
      }
      await commit("ci: enable self-updating (CI + Renovate auto-merge)");

      const push = deps.pushBranch ?? gitPush;
      await push(cwd, branch);

      const github = deps.github ?? makeGitHub({ token: readGitHubConfig()!.token });
      const base = await github.defaultBranch(planned.repo).catch(() => "main");
      const pr = await github.openPullRequest(planned.repo, {
        head: branch,
        base,
        title: "Enable self-updating (CI + Renovate)",
        body: "Adds the unified CI gate, nightly Renovate, and auto-merge for patch/minor updates.",
      });
      await github.enableRepoAutoMerge(planned.repo);
      await github.protectBranch(planned.repo, base, ["ci"]);
      await github.setRepoSecret(planned.repo, "RENOVATE_TOKEN", planned.renovateToken);

      return { kind: "ok", notes: `self-updating enabled — PR ${pr.url}` };
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/recipes/self-updating.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + clean. (The noop test relies on `withRecipe`'s clean-tree check; if the first apply leaves the temp repo on a `maint/*` branch with the files committed, the second run re-reads them as matching → noop. If the clean-tree guard interferes, set `checkTreeFirst: false` reasoning holds — the files are committed, tree is clean.)

- [ ] **Step 5: Commit**

```bash
git add src/recipes/self-updating/index.ts tests/recipes/self-updating.test.ts
git commit -m "feat(recipes): self-updating — bootstrap CI + Renovate + auto-merge per repo"
```

---

## Task 8: CLI command `self-updating`

**Files:** Create `src/cli/commands/self-updating.ts`; Modify `src/cli/bin.ts`, `src/types.ts` (`RecipeName`); Test `tests/cli/self-updating-command.test.ts`.

- [ ] **Step 1: Add `"self-updating"` to the `RecipeName` union** in `src/types.ts` (lines ~10-18).

- [ ] **Step 2: Write the failing test** (`tests/cli/self-updating-command.test.ts`) — mirror an existing command test; assert single-site routing returns a `{ output, code }` and that `--dry` doesn't touch GitHub. Build a minimal harness pointing at a temp git repo (reuse the `gitInit` helper from Task 7 or factor it into `tests/helpers/`). Assert exit `code` is 0 on a dry run.

```typescript
import { describe, it, expect, vi } from "vitest";
// ... import runSelfUpdatingCommand, set up a temp repo, run with { dry: true }, assert code 0 + output mentions "would".
```

(Full harness mirrors `tests/cli` patterns; if none exist for recipe commands, assert the command module's pure routing: `--dry` returns code 0 without calling the GitHub client.)

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run tests/cli/self-updating-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** (`src/cli/commands/self-updating.ts`) — mirror `src/cli/commands/sync-configs.ts` (resolveSites + cloneIfNeeded for fleet, loop the recipe, format results, `code = 1` if any failed). `--dry` reports which repos would be bootstrapped without writing/PRing:

```typescript
import { resolve } from "node:path";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";
import { selfUpdating } from "../../recipes/self-updating/index.js";
import type { RecipeResult } from "../../types.js";

export type SelfUpdatingCommandOptions = {
  fleet?: string;
  workdir?: string;
  dry?: boolean;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? "already self-updating"}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied\n${r.notes ?? ""}`;
}

export async function runSelfUpdatingCommand(
  site: string | undefined,
  opts: SelfUpdatingCommandOptions,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd,
  });
  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }
  if (opts.dry) {
    return {
      output: sites.map((s) => `[${s.name ?? s.path}] would enable self-updating`).join("\n"),
      code: 0,
    };
  }
  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await selfUpdating(s));
  return {
    output: results.map(formatResult).join("\n"),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
```

- [ ] **Step 5: Register in `src/cli/bin.ts`** — import `runSelfUpdatingCommand`, add `"self-updating"` to `RECIPE_DESCRIPTIONS` (TS will force this), and add the command (mirror `bump-deps`):

```typescript
cli
  .command(
    "self-updating [site]",
    "Bootstrap a repo to keep itself updated (CI + Renovate + auto-merge).",
  )
  .option("--dry", "List what would be enabled without writing or opening PRs")
  .option("--fleet <inventory>", 'Inventory file (.json or .mjs/.js), or "airtable"')
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(async (site, opts) => runOrExit(() => runSelfUpdatingCommand(site, opts), opts));
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm exec vitest run tests/cli/self-updating-command.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/self-updating.ts src/cli/bin.ts src/types.ts tests/cli/self-updating-command.test.ts
git commit -m "feat(cli): self-updating command (single + --fleet + --dry)"
```

---

## Task 9: Airtable field, full gate, changeset, PR

**Files:** Create `.changeset/self-updating-repos.md`.

- [ ] **Step 1: Create the Airtable field** — via the Airtable MCP, on the Websites table (`tblerElkKDif2VqrO`, base `appHG8nLOzULzXOER`): a single-line text field named **"Git repo"** (description: "GitHub repo as owner/repo, e.g. tucksravin/erpfunds. Drives the self-updating recipe."). Idempotent — skip if it exists.

- [ ] **Step 2: Write the changeset** (`.changeset/self-updating-repos.md`):

```markdown
---
"@reddoorla/maintenance": minor
---

M1: self-updating repos. New `reddoor-maint self-updating [site]` recipe bootstraps a repo to keep itself current — writes a unified CI workflow (format+lint, typecheck, build, a11y with `--fail-on-violations`; no lighthouse), a nightly self-hosted Renovate workflow, and `renovate.json` (patch/minor auto-merge on green, majors → PR); pushes, opens a PR, enables branch protection + auto-merge, and sets the `RENOVATE_TOKEN` secret. The three files join the `sync-configs` canonical set so the CI standard stays unified fleet-wide.

- New `src/github/` (gh CLI wrappers + config); `GITHUB_TOKEN` + `RENOVATE_TOKEN` in credentials.env.
- New Airtable Websites "Git repo" field → `WebsiteRow.gitRepo` → `Site.gitRepo` (falls back to the checkout's origin remote for local runs).
- `audit --fail-on-violations` (a11y CI gate; exits non-zero on any a11y violation).
```

- [ ] **Step 3: Full local gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS. (Per project rule: `pnpm lint` before pushing — CI prettier-checks every file.)

- [ ] **Step 4: Live verify (operator-assisted)** — on one real repo (e.g. erpfunds): ensure `GITHUB_TOKEN` + `RENOVATE_TOKEN` are in `~/.config/reddoor-maint/credentials.env` and the site's a11y is clean, then `reddoor-maint self-updating --dry` (lists the site), then a real run on a throwaway/test repo first to confirm the PR opens, branch protection lands, the secret is set, and a Renovate run produces an auto-merging patch/minor PR. Tune `ci.yml` script names (`svelte-kit sync`, `check`, `build`) to the real Reddoor SvelteKit conventions if they differ.

- [ ] **Step 5: Commit + push + PR**

```bash
git add .changeset/self-updating-repos.md
git commit -m "chore: changeset for M1 self-updating repos"
git push -u origin feat/self-updating-repos
gh pr create --title "feat: M1 — self-updating repos (CI + Renovate + auto-merge)" --body "<summary; links the spec + roadmap>"
```

---

## Self-Review Notes

- **Spec coverage:** M1a identity+auth → Tasks 1,2,3,5; the unified CI + a11y gate → Tasks 4,6; the recipe + settings + PR → Task 7; CLI → Task 8; Airtable field + verify → Task 9. The two-token model (Task 2), `gh`-CLI choice (Task 3), zero-tolerance a11y (Task 4 + the `--fail-on-violations` in the ci.yml template Task 6), and sync-configs unification (Task 6) all map. Non-goals (M1c push+PR in other recipes, M1d status aggregation) are not in any task — correct.
- **Type consistency:** `GitHub` interface (Task 3) is consumed by Task 7's `SelfUpdatingDeps.github`. `ConfigName` additions (Task 6) match the template `config` fields and `ALL_CONFIG_NAMES`. `Site.gitRepo` (Task 5) is read by `resolveRepo` (Task 7). `auditExitCode` signature (Task 4) is stable. `parseOwnerRepo`/`getRemoteUrl`/`push` (Task 1) used in Task 7.
- **Known soft spots to validate during execution (flagged, not placeholders):** (1) the `protectBranch` `gh api` argv may need tuning to GitHub's exact field syntax — the test asserts behaviorally; verify on the first real repo. (2) The exact site CI script names (`svelte-kit sync`/`check`/`build`) assume Reddoor SvelteKit conventions — Task 9's live verify tunes them. (3) The `self-updating.test.ts` noop case depends on `withRecipe`'s clean-tree behavior after the first apply — adjust if the temp-repo tree isn't clean.

```

```
