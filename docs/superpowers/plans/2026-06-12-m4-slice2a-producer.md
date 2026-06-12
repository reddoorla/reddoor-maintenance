# M4 Slice 2a — GitHub-signals producer (nightly → Airtable)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A nightly fleet sweep that persists three GitHub-sourced signals per repo-backed site into Airtable — Renovate-failing-CI count, default-branch CI state, last-commit timestamp — so the cockpit (slice 2b) can read them with zero request-path GitHub calls.

**Architecture:** One new `makeGitHub` method (`defaultBranchStatus`, one GraphQL call) + a pure sweep (`collectGitHubSignals`) over an injected probe pair + a per-row Airtable writer (`updateGitHubSignals`) + a thin `github-signals --fleet --write-airtable` CLI command + a cron step. Reuses the existing fleet-iterate-serial-write pattern and the `RENOVATE_TOKEN` plumbing.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), vitest, the `gh` CLI via `spawn`, Airtable, cac CLI. No new deps.

**Reference (real signatures this builds on):**

- `src/github/gh.ts` — `type CiState = "passing"|"failing"|"pending"|"none"`, `mapRollupState(state)`, the `GitHub` type, `makeGitHub({token,spawn})`, and `openPullRequests` (the GraphQL-via-`gh()` template to mirror).
- `src/alerts/renovate.ts` — `isFailingRenovatePR(pr)`, `OpenPullRequestsProbe = (repo) => Promise<PullRequestSummary[]>`.
- `src/reports/airtable/websites.ts` — `WebsiteRow`, `mapRow`, `siteSlug`, `listWebsites`, and `updateDepsCounts` (the "omit a null sub-value" write pattern to mirror).
- `src/audits/write-audits-to-airtable.ts` — `formatFleetWriteSummary` + `FleetWriteResult` (the `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line CI greps).
- `src/cli/commands/audit.ts` + `src/cli/bin.ts` — the fleet command + cac registration to mirror; `src/cli/commands/report.ts` for the env/config-read pattern.
- `src/alerts/digest-collectors.ts` — `buildRenovateProbe()` (the `RENOVATE_TOKEN`→`GH_TOKEN` token logic to reuse).

**PREREQUISITE (controller, before merge):** create four Websites fields live via Airtable MCP (base `appHG8nLOzULzXOER`, table `Websites`): `Renovate Failing CIs` (number, integer), `Default Branch CI` (single line text), `Last Commit At` (date+time), `GitHub Signals At` (date+time). Additive; nothing else changes.

---

## File Structure

- **Modify** `src/github/gh.ts` — add `defaultBranchStatus` to `GitHub` + `makeGitHub`.
- **Create** `src/audits/github-signals.ts` — `GitHubSignalsRow`, `collectGitHubSignals` (pure), `GitHubSignalsDeps`.
- **Modify** `src/reports/airtable/websites.ts` — 4 new `WebsiteRow` fields + `mapRow` reads + `updateGitHubSignals`.
- **Create** `src/cli/commands/github-signals.ts` — `runGitHubSignalsCommand`.
- **Modify** `src/cli/bin.ts` — register the `github-signals` command.
- **Modify** `.github/workflows/fleet-lighthouse.yml` — a sweep step with `RENOVATE_TOKEN`.
- **Create** `.changeset/m4-slice2a-github-signals.md`.
- **Tests:** `tests/github/default-branch-status.test.ts`, `tests/audits/github-signals.test.ts`, `tests/reports/airtable/update-github-signals.test.ts`.

---

## Task 1: `defaultBranchStatus` GitHub method

**Files:** Modify `src/github/gh.ts`; Test `tests/github/default-branch-status.test.ts`.

- [ ] **Step 1: Write the failing test**

`makeGitHub` takes an injectable `spawn`, so the test fakes the `gh api graphql` stdout. Create `tests/github/default-branch-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";

function fakeSpawn(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: "" });
}

describe("defaultBranchStatus", () => {
  it("maps the rollup state and returns the commit date", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: {
                  committedDate: "2026-06-01T10:00:00Z",
                  statusCheckRollup: { state: "FAILURE" },
                },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("reddoorla/caltex")).toEqual({
      ciState: "failing",
      lastCommitAt: "2026-06-01T10:00:00Z",
    });
  });

  it("reads SUCCESS as passing", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: {
                  committedDate: "2026-06-02T00:00:00Z",
                  statusCheckRollup: { state: "SUCCESS" },
                },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({
      ciState: "passing",
      lastCommitAt: "2026-06-02T00:00:00Z",
    });
  });

  it("an empty/branchless repo → none + null date", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(JSON.stringify({ data: { repository: { defaultBranchRef: null } } })),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({ ciState: "none", lastCommitAt: null });
  });

  it("no checks reported → none, with the date still returned", async () => {
    const gh = makeGitHub({
      token: "t",
      spawn: fakeSpawn(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: {
                target: { committedDate: "2026-06-03T00:00:00Z", statusCheckRollup: null },
              },
            },
          },
        }),
      ),
    });
    expect(await gh.defaultBranchStatus("o/r")).toEqual({
      ciState: "none",
      lastCommitAt: "2026-06-03T00:00:00Z",
    });
  });

  it("rejects a non owner/repo string", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn("{}") });
    await expect(gh.defaultBranchStatus("not-a-repo")).rejects.toThrow(/owner\/repo/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- default-branch-status`
Expected: FAIL — `gh.defaultBranchStatus is not a function`.

- [ ] **Step 3: Implement**

In `src/github/gh.ts`, add to the `GitHub` type (after `openPullRequests`):

```ts
/** The default branch's latest-commit date + normalized CI rollup, one query. */
defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
```

Add the implementation inside the returned object (after `openPullRequests`):

```ts
    async defaultBranchStatus(repo) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`defaultBranchStatus: expected "owner/repo", got "${repo}"`);
      }
      const query =
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
        "defaultBranchRef{target{... on Commit{committedDate statusCheckRollup{state}}}}}}";
      const out = await gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`]);
      const parsed = JSON.parse(out) as {
        data?: {
          repository?: {
            defaultBranchRef?: { target?: { committedDate?: string; statusCheckRollup?: { state?: string } | null } } | null;
          };
        };
      };
      const target = parsed.data?.repository?.defaultBranchRef?.target;
      return {
        ciState: mapRollupState(target?.statusCheckRollup?.state),
        lastCommitAt: target?.committedDate ?? null,
      };
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- default-branch-status`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/github/gh.ts tests/github/default-branch-status.test.ts
git commit -m "feat(github): defaultBranchStatus — default-branch CI state + last-commit date"
```

---

## Task 2: `collectGitHubSignals` (pure sweep)

**Files:** Create `src/audits/github-signals.ts`; Test `tests/audits/github-signals.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { collectGitHubSignals } from "../../src/audits/github-signals.js";
import type { Site } from "../../src/types.js";
import type { PullRequestSummary } from "../../src/github/gh.js";

function site(over: Partial<Site> = {}): Site {
  return { path: "", name: "caltex", meta: {}, gitRepo: "reddoorla/caltex", ...over } as Site;
}
function pr(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    title: "chore(deps): x",
    url: "https://x",
    headRef: "renovate/x",
    ciState: "failing",
    ...over,
  };
}

describe("collectGitHubSignals", () => {
  it("counts failing Renovate PRs and records CI state + last commit per site", async () => {
    const rows = await collectGitHubSignals([site()], {
      openPullRequests: async () => [
        pr(),
        pr({ number: 2, headRef: "renovate/y" }),
        pr({ number: 3, headRef: "feature", ciState: "failing" }),
      ],
      defaultBranchStatus: async () => ({
        ciState: "passing",
        lastCommitAt: "2026-06-01T00:00:00Z",
      }),
    });
    expect(rows).toEqual([
      {
        site: "caltex",
        repo: "reddoorla/caltex",
        renovateFailingCis: 2,
        ciState: "passing",
        lastCommitAt: "2026-06-01T00:00:00Z",
      },
    ]);
  });

  it("skips sites without a gitRepo", async () => {
    const rows = await collectGitHubSignals([site({ gitRepo: null })], {
      openPullRequests: async () => [],
      defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: null }),
    });
    expect(rows).toEqual([]);
  });

  it("records a repo whose probe throws in `skipped`, not in rows", async () => {
    const rows = await collectGitHubSignals(
      [site({ name: "a", gitRepo: "o/a" }), site({ name: "b", gitRepo: "o/b" })],
      {
        openPullRequests: async (r) => {
          if (r === "o/a") throw new Error("boom");
          return [];
        },
        defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: null }),
      },
      (s) => s.skipped.push("ignored"),
    );
    // "o/a" failed its probe → only "b" produces a row.
    expect(rows.map((r) => r.repo)).toEqual(["o/b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- github-signals`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/audits/github-signals.ts`:

```ts
import type { Site } from "../types.js";
import type { CiState, PullRequestSummary } from "../github/gh.js";
import { isFailingRenovatePR } from "../alerts/renovate.js";

/** One swept row, ready for the Airtable writer (slug-keyed by `site`). */
export type GitHubSignalsRow = {
  site: string; // the site name/slug the writer matches on
  repo: string; // owner/repo
  renovateFailingCis: number;
  ciState: CiState;
  lastCommitAt: string | null;
};

/** Injected GitHub reads (so the sweep is pure + testable). */
export type GitHubSignalsDeps = {
  openPullRequests: (repo: string) => Promise<PullRequestSummary[]>;
  defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
};

/** Per repo-backed site: count its failing Renovate PRs + read its default-branch
 *  status. Sites without `gitRepo` are skipped (not errors). A repo whose probe
 *  throws is reported via `onSkip` and produces no row — one GitHub hiccup never
 *  sinks the sweep (mirrors `collectRenovateFailures`). PURE over `deps`. */
export async function collectGitHubSignals(
  sites: Site[],
  deps: GitHubSignalsDeps,
  onSkip: (s: { repo: string }) => void = () => {},
): Promise<GitHubSignalsRow[]> {
  const rows: GitHubSignalsRow[] = [];
  for (const s of sites) {
    const repo = s.gitRepo;
    if (!repo) continue;
    try {
      const prs = await deps.openPullRequests(repo);
      const status = await deps.defaultBranchStatus(repo);
      rows.push({
        site: s.name,
        repo,
        renovateFailingCis: prs.filter(isFailingRenovatePR).length,
        ciState: status.ciState,
        lastCommitAt: status.lastCommitAt,
      });
    } catch {
      onSkip({ repo });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- github-signals`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/audits/github-signals.ts tests/audits/github-signals.test.ts
git commit -m "feat(github-signals): pure fleet sweep — renovate-failing count + CI state + last commit"
```

---

## Task 3: Websites fields + `updateGitHubSignals` writer

**Files:** Modify `src/reports/airtable/websites.ts`; Test `tests/reports/airtable/update-github-signals.test.ts`.

- [ ] **Step 1: Write the failing test**

The repo's airtable tests use a fake base. Mirror the existing `updateDepsCounts` test (find it for the exact fake-base helper) — the controller provides the fake-base shape. Create `tests/reports/airtable/update-github-signals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateGitHubSignals } from "../../../src/reports/airtable/websites.js";

/** Minimal fake matching the `base(table).update([{id,fields}])` surface used by the writers. */
function fakeBase() {
  const calls: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const base = (() => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      calls.push(...recs);
      return recs;
    },
  })) as unknown as Parameters<typeof updateGitHubSignals>[0];
  return { base, calls };
}

describe("updateGitHubSignals", () => {
  it("writes all four fields when every value is present", async () => {
    const { base, calls } = fakeBase();
    await updateGitHubSignals(base, "rec1", {
      renovateFailingCis: 2,
      ciState: "failing",
      lastCommitAt: "2026-06-01T00:00:00Z",
      sweptAt: "2026-06-12T08:30:00Z",
    });
    expect(calls[0]!.id).toBe("rec1");
    expect(calls[0]!.fields).toMatchObject({
      "Renovate Failing CIs": 2,
      "Default Branch CI": "failing",
      "Last Commit At": "2026-06-01T00:00:00Z",
      "GitHub Signals At": "2026-06-12T08:30:00Z",
    });
  });

  it("omits a null lastCommitAt rather than clobbering a prior value", async () => {
    const { base, calls } = fakeBase();
    await updateGitHubSignals(base, "rec1", {
      renovateFailingCis: 0,
      ciState: "none",
      lastCommitAt: null,
      sweptAt: "2026-06-12T08:30:00Z",
    });
    expect("Last Commit At" in calls[0]!.fields).toBe(false);
    expect(calls[0]!.fields).toMatchObject({
      "Renovate Failing CIs": 0,
      "Default Branch CI": "none",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- update-github-signals`
Expected: FAIL — `updateGitHubSignals` not exported.

- [ ] **Step 3: Implement**

In `src/reports/airtable/websites.ts`: add the four fields to `WebsiteRow` (after `dashboardToken`):

```ts
/** GitHub-signals sweep (slice 2a), written nightly by `github-signals --fleet`. */
renovateFailingCis: number | null;
defaultBranchCi: string | null; // "passing" | "failing" | "pending" | "none"
lastCommitAt: string | null;
githubSignalsAt: string | null;
```

In `mapRow`, add (after the `dashboardToken` block):

```ts
    renovateFailingCis: (f["Renovate Failing CIs"] as number | undefined) ?? null,
    defaultBranchCi: (f["Default Branch CI"] as string | undefined) ?? null,
    lastCommitAt: (f["Last Commit At"] as string | undefined) ?? null,
    githubSignalsAt: (f["GitHub Signals At"] as string | undefined) ?? null,
```

Add the writer (mirroring `updateDepsCounts`'s null-omit pattern) at the end of the file:

```ts
/** Persist the GitHub-signals sweep onto a Websites row (slice 2a). A null
 *  `lastCommitAt` is OMITTED so a not-determined-this-run value never clobbers a
 *  previously-good timestamp (mirrors updateDepsCounts' outdated handling). */
export async function updateGitHubSignals(
  base: AirtableBase,
  recordId: string,
  signals: {
    renovateFailingCis: number;
    ciState: string;
    lastCommitAt: string | null;
    sweptAt: string;
  },
): Promise<void> {
  const fields: FieldSet = {
    "Renovate Failing CIs": signals.renovateFailingCis,
    "Default Branch CI": signals.ciState,
    "GitHub Signals At": signals.sweptAt,
  };
  if (signals.lastCommitAt !== null) {
    fields["Last Commit At"] = signals.lastCommitAt;
  }
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}
```

- [ ] **Step 4: Run to verify it passes + the existing websites tests still map**

Run: `pnpm test -- update-github-signals websites`
Expected: PASS. (If any existing `WebsiteRow` fixture in another test now fails to typecheck for missing fields, that's caught in the final `pnpm typecheck` — the controller adds the four fields to shared fixtures if needed. Most tests use `Partial<WebsiteRow>` factories that won't break.)

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/websites.ts tests/reports/airtable/update-github-signals.test.ts
git commit -m "feat(airtable): WebsiteRow GitHub-signals fields + updateGitHubSignals writer"
```

---

## Task 4: The `github-signals --fleet --write-airtable` command

**Files:** Create `src/cli/commands/github-signals.ts`; Modify `src/cli/bin.ts`. (Integration — the gate is `pnpm typecheck && pnpm build`; the pure logic is already tested in Tasks 1–3.)

- [ ] **Step 1: Implement the command**

Mirror `src/cli/commands/audit.ts`'s fleet path and `report.ts`'s env-read. Create `src/cli/commands/github-signals.ts`:

```ts
import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, updateGitHubSignals } from "../../reports/airtable/websites.js";
import type { Site } from "../../types.js";
import { collectGitHubSignals } from "../../audits/github-signals.js";
import { makeGitHub } from "../../github/gh.js";
import {
  formatFleetWriteSummary,
  type FleetWriteResult,
} from "../../audits/write-audits-to-airtable.js";

/** `github-signals --fleet --write-airtable`: sweep every repo-backed site for its
 *  Renovate-failing count + default-branch CI state + last-commit date, write each
 *  row serially (Airtable ~5 req/sec), and emit FLEET_WRITE_SUMMARY for CI. A
 *  missing fleet token is a clean skip (local runs), not a failure. */
export async function runGitHubSignalsCommand(opts: {
  fleet?: boolean;
  writeAirtable?: boolean;
}): Promise<{ output: string; code: number }> {
  if (!opts.fleet || !opts.writeAirtable) {
    return { output: "github-signals currently supports only --fleet --write-airtable", code: 2 };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    return {
      output: "github-signals skipped: no RENOVATE_TOKEN/GH_TOKEN (fleet read) configured.",
      code: 0,
    };
  }
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const gh = makeGitHub({ token });
  const sites: Site[] = websites.map((w) => ({
    path: "",
    name: w.name,
    meta: {},
    ...(w.gitRepo ? { gitRepo: w.gitRepo } : {}),
  }));

  const skipped: string[] = [];
  const rows = await collectGitHubSignals(
    sites,
    {
      openPullRequests: (r) => gh.openPullRequests(r),
      defaultBranchStatus: (r) => gh.defaultBranchStatus(r),
    },
    ({ repo }) => skipped.push(repo),
  );

  const sweptAt = new Date().toISOString();
  const result: FleetWriteResult = { written: [], failed: [] };
  // Serial: Airtable's ~5 req/sec limit (matches writeFleetAuditsToAirtable).
  for (const row of rows) {
    const target = websites.find((w) => siteSlug(w.name) === siteSlug(row.site));
    if (!target) {
      result.failed.push({ slug: siteSlug(row.site), error: "no Websites row matched" });
      continue;
    }
    try {
      await updateGitHubSignals(base, target.id, {
        renovateFailingCis: row.renovateFailingCis,
        ciState: row.ciState,
        lastCommitAt: row.lastCommitAt,
        sweptAt,
      });
      result.written.push({
        siteName: target.name,
        writes: [{ audit: "github-signals", counts: row } as never],
      });
    } catch (e) {
      result.failed.push({ slug: siteSlug(row.site), error: (e as Error).message });
    }
  }
  for (const repo of skipped) result.failed.push({ slug: repo, error: "probe failed (skipped)" });

  return {
    output: formatFleetWriteSummary(result),
    code: result.failed.length > 0 && result.written.length === 0 ? 1 : 0,
  };
}
```

(Note: `WriteSummary.writes[].audit` is a union not including `"github-signals"`; the `as never` cast on that diagnostic-only field avoids widening the shared type for a log line. If the implementer prefers, widen `WriteSummary.writes[].audit` to include `"github-signals"` in `write-audits-to-airtable.ts` instead — either is fine; keep it minimal.)

- [ ] **Step 2: Register in `bin.ts`**

Add the import near the other command imports:

```ts
import { runGitHubSignalsCommand } from "./commands/github-signals.js";
```

Add the command registration (mirror the shape of an existing `cli.command(...).action(...)`; use the repo's `runOrExit`/exit-code helper as the siblings do):

```ts
cli
  .command(
    "github-signals",
    "Sweep the fleet for GitHub signals (Renovate-failing/CI/last-commit) and write Airtable.",
  )
  .option("--fleet", "Run across every site in the Airtable inventory.")
  .option("--write-airtable", "Write each site's signals back to its Websites row.")
  .action((opts) =>
    runOrExit(() =>
      runGitHubSignalsCommand({ fleet: opts.fleet, writeAirtable: opts.writeAirtable }),
    ),
  );
```

(Match the exact `runOrExit`/action wrapper the neighboring commands use in `bin.ts` — read two of them first.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: clean.

- [ ] **Step 4: Smoke the CLI wiring (no token → clean skip)**

Run: `node dist/cli/bin.js github-signals --fleet --write-airtable`
Expected: prints the "skipped: no RENOVATE_TOKEN/GH_TOKEN" line and exits 0 (no Airtable write locally).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/github-signals.ts src/cli/bin.ts
git commit -m "feat(cli): github-signals --fleet --write-airtable command"
```

---

## Task 5: Cron step

**Files:** Modify `.github/workflows/fleet-lighthouse.yml`. (No unit test; gate = valid YAML + the command exists.)

- [ ] **Step 1: Add the sweep step**

After the Lighthouse fleet-write step, add a step that runs the new command with the fleet token. Read the existing Lighthouse step for the exact `node dist/cli/bin.js ...` invocation, the `dist` build step, and the env block, then add (matching indentation/style):

```yaml
- name: Sweep GitHub signals to Airtable
  if: always()
  env:
    AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
    AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
    RENOVATE_TOKEN: ${{ secrets.RENOVATE_TOKEN }}
  run: node dist/cli/bin.js github-signals --fleet --write-airtable
```

(`if: always()` so a Lighthouse flake doesn't skip the GitHub sweep. Match the secret names the Lighthouse step uses — `AIRTABLE_PAT`/`AIRTABLE_BASE_ID` — exactly.)

- [ ] **Step 2: Validate the workflow YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/fleet-lighthouse.yml','utf8'); require('yaml')? null:null; console.log('readable', y.length>0)"` — or simpler, confirm `git diff` shows a well-formed step. (If `yaml`/`js-yaml` isn't a dep, just eyeball the indentation against the neighboring step.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/fleet-lighthouse.yml
git commit -m "ci(github-signals): nightly fleet sweep step in fleet-lighthouse cron"
```

---

## Task 6: Changeset + final gate

- [ ] **Step 1: Changeset** — create `.changeset/m4-slice2a-github-signals.md`:

```md
---
"@reddoorla/maintenance": minor
---

feat(github-signals): nightly fleet sweep persists three GitHub-sourced signals per site to Airtable (M4 slice 2a) — count of Renovate update PRs failing CI, default-branch CI state, and last-commit-to-default-branch timestamp. New `github-signals --fleet --write-airtable` command (runs in the nightly cron with the fleet-read token), a `defaultBranchStatus` GitHub query, and `updateGitHubSignals` Airtable writer. The cockpit reads these (slice 2b) with no request-path GitHub calls.
```

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset/m4-slice2a-github-signals.md
git commit -m "chore(changeset): M4 slice 2a github-signals producer"
```

- [ ] **Step 3: Final full gate** (controller runs)

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green. (`test:dist` included — the lesson from #180/#181.)

Then the AUTONOMY.md 3-lens review (spec / quality / a LIVE lens that runs the real sweep read-only against one repo to confirm the GraphQL shape) before the head-SHA-gated merge.

---

## Self-review

- **Spec coverage:** `defaultBranchStatus` (§3.1) → Task 1; `collectGitHubSignals` (§3.2) → Task 2; fields + `updateGitHubSignals` (§3.2/§3.3) → Task 3; command (§3.4) → Task 4; cron (§3.4) → Task 5. Airtable fields = controller prerequisite (live MCP).
- **Type consistency:** `GitHubSignalsRow`/`GitHubSignalsDeps` defined in Task 2 and consumed unchanged by Task 4; `CiState` reused from `gh.ts`; the writer's `ciState: string` accepts the `CiState` union.
- **No request-path GitHub:** all GitHub access is in the CLI command (nightly), never in `buildCockpitModel`/render. The consumer (2b) reads only the persisted fields.
