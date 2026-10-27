# New-Site Wiring, Launch Disposition, Skill Edits, Records and Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model delivery and the matching harness survive the whole life of a site — `prismic-ci` runs on a positional checkout so `/new-site` can install it on day one, `launch` refuses to draft while the `/dev/match` twin is live in production, the two skills say what the recipes now do, and the four falsified or missing claims (Renovate propagation, the forward-merge rule, the 08-31 importer claim, the absent orientation line) are corrected where a reader lands.

**Architecture:** One shared `resolveOwnerRepo(site)` in `src/util/git.ts` replaces `self-updating`'s private copy and unblocks `prismic-ci` on a path (`localPath()` never sets `gitRepo`). `launch` gains two disposition steps around the existing chain: a filesystem pre-flight before any GitHub write, and an HTTP `dev-guard` against the DEPLOYED url after the Websites-row lookup, both demanding positive evidence. Everything else is prose in four repos plus five issues.

**Tech Stack:** TypeScript (ESM, tsup), vitest 4, cac 6; `gh` CLI; Markdown (skills, runbooks, journals).

**Spec:** `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` §C5 ("new-site, matching-a-page, launch"), §C6 ("Records"), §D10 (product fixes deferred to an issue). C5's gate: _the prismic-models workflow has one real run — a harmless model PR on Beachfront (operator merges; RED tier) whose comment and apply jobs both succeed, with the run URL in Beachfront's journal._

**Depends on:**

- **Plan A (`reddoorla/claude-skills`) must be merged and installed** before Tasks 7–9. They edit `skills/new-site/SKILL.md` and `skills/matching-a-page/SKILL.md` **inside the new repo**, and their gate is that the edit is visible through the symlink `~/.claude/skills/<name>`. Plan A must have produced: the repo at `$HOME/Documents/GitHub/claude-skills` with `skills/<name>/` for all seven, `install.sh` run once (unsandboxed, by the operator), and `test/skills.test.mjs` green.
- **Plan BC (`match-harness`) is NOT a hard dependency for MERGING, but it OWES this plan a test.** Task 4's guard string (`if (!dev)` against `$app/environment`) and Task 8's invocation line are the recipe's contract as fixed in the decisions; they are written here whether or not BC has landed. Task 8's Phase-0 text names `reddoor-maint match-harness <site-path> --ref <url>`, which is BC's CLI. The one-way coupling to name out loud: **nothing on disk today satisfies `matchingDisposition`'s predicate**, so its passing branch is proved only by the fixture Task 4 writes. BC must install the exact guard source given in Task 4 Step 3 and its recipe test must assert `(await matchingDisposition(installedDir)).ok` by IMPORTING the predicate — restating the regex lets the two drift silently. Carried into the maintenance PR body (Task 6 Step 4) so BC's executor cannot miss it.
- **Plan D is independent.** It owns `docs/migration.md` and `prismic-seed`; this plan opens the `carryOver` issue D's own text points at (Task 12, issue 3) and duplicates none of its tasks.
- Tasks 1–6 depend on nothing outside this plan.

**Repos touched:**

| Repo                 | Branch                                        | Where                                                                                                                            |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| reddoor-maintenance  | `feat/prismic-ci-positional-and-launch-guard` | worktree `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/wiring` (mandatory per its CLAUDE.md:54)            |
| claude-skills        | `feat/skill-edits-for-recipe`                 | `/Users/tuckerlemos/Documents/GitHub/claude-skills` (created by plan A)                                                          |
| reddoor-starter      | `docs/webflow-pipeline-records`               | worktree `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/.worktrees/webflow-records` (`.worktrees/` ignored, .gitignore:35) |
| beachfront-dentistry | `chore/prismic-models-first-run`              | `/Users/tuckerlemos/Documents/GitHub/beachfront-dentistry` (clean on `main` at `f1a4155`; one-file change, no worktree)          |

Referred to below as `$MAINT`, `$SKILLS`, `$STARTER`, `$BF`. Never commit on `main` in any of them.

**Assumptions:**

1. The maintenance main checkout is on `feat/audit-check-battery` (HEAD `9cd173a`) with an unrelated dirty `src/prospect/site-checks.ts` from another session. The worktree is cut from **whatever `origin/main` is when you run Task 0** — it moves (it was `686b08d` while this plan was drafted and `b18d369` hours later), so record the SHA you actually get rather than matching one written here. `origin/main` is where `docs/workJournal.md` lives; the checkout's branch does not have it. **Every `CLAUDE.md` line number below is against `origin/main`, not against that dirty checkout** — the checkout's `CLAUDE.md` is a divergent 128-line file and its numbers do not match (this is exactly what stale-lines Task 5 guards against).
2. The decisions name three homes for the Renovate-propagation correction (prismic-ci template, runbook, sync-configs templates). Grep finds a **fourth**: `src/recipes/self-updating/index.ts:36-38` makes the same claim about the same refs. The starter's "enumerate the defect class before fixing an instance" rule applies, so Task 3 fixes all four. Flagged rather than silently extended.
3. Plan A's installability test forbids any `/Users/<name>/` path in a tracked skill file, so plan A must already have replaced `matching-a-page/SKILL.md:173`'s absolute `file://` playwright import to go green. Task 8 Step 1 greps for it and treats an already-correct line as done rather than editing it twice.
4. `$REDDOOR_REPOS` (default `$HOME/Documents/GitHub`) is plan A's rewrite of the `~/Documents/GitHub` literals in `new-site/SKILL.md` lines 20, 71, 84. Task 7 Step 1 greps which form the file actually uses and matches it — new prose must never introduce a second convention.
5. The `dev-guard` probe's liveness control is **`/health`**, not `/dev/a11y-fixtures`. Every starter-derived repo ships `src/routes/health/+server.ts` with an explicit `export const prerender = false` (verified here on reddoor-starter, beachfront-dentistry and vida-legacy-foundation; the 29-navy session counted 23 of 23), so a 200 is a live function invocation rather than a static file served off a CDN. **This decision was overturned in implementation — `bebf445`.** Its first form used `/dev/a11y-fixtures`, which every native site does ship; the premise was true and the conclusion still wrong, because it makes the launch gate depend on an unguarded dev route staying publicly reachable on a client's production site. The obvious class-fix for dev routes shipping in production — one `src/routes/dev/+layout.server.ts` with `if (!dev) error(404)` — would delete the control and make every correctly-guarded site fail its launch, reported as "host down, wrong url, or the axe fixture route was deleted". A gate whose liveness signal is removed by fixing the defect the gate exists to police is not a sound control.
6. Beachfront's `PRISMIC_WRITE_TOKEN` was present on 2026-08-14, the workflow is active with zero runs, and the 2026-09-08 nightly reported `38 model(s) match Prismic` at `f1a4155` (current `main`). Task 11 re-checks all three before opening the PR rather than trusting this line.
7. `29 NAVY`'s token env name is `PRISMIC_TOKEN_29_NAVY` (`prismicTokenEnvName`, `src/prismic/models/token.ts:27-38`: upper-case, non-alphanumerics to `_`, trimmed).

---

## File structure

**reddoor-maintenance** (`$MAINT`)

- Modify: `src/util/git.ts` — add `resolveOwnerRepo` after `getRemoteUrl` (:132-135)
- Modify: `src/recipes/self-updating/index.ts:11-13,70-103,110` — delete the private `resolveRepo`, call the shared one
- Modify: `src/recipes/prismic-ci/index.ts:15,113-124` — resolve the repo the same way
- Modify: `src/recipes/prismic-ci/template.ts:63-68` — the propagation correction (`REUSABLE_WORKFLOW_PIN` docblock)
- Modify: `src/recipes/prismic-ci/template.ts:81-82` — the SAME false claim a second time, in the `isPinResolved` docblock
- Modify: `src/recipes/sync-configs/templates.ts:82-85` — same correction, ci.yml wording
- Modify: `src/recipes/self-updating/index.ts:35-38` — same correction, fourth file
- Modify: `docs/runbooks/prismic-model-delivery.md:122` + new `### After every reddoorla/.github tag` after :124
- Modify: `src/recipes/launch.ts` — `probe` dep, `matchingDisposition`, the `dev-guard` step, `probe` step kind
- Modify: `src/cli/commands/launch.ts:9-23` — export `formatStep`, add the branch for the new kind
- Modify: `CLAUDE.md:194-195` — cherry-pick, never `git merge starter/main` (spec C6 says `:116`; that number is STALE — it is from a divergent working checkout, not from `origin/main`, where `CLAUDE.md` is 206 lines)
- Modify: `docs/workJournal.md` — append the entry from Task 13
- Test: `tests/util/git-owner-repo.test.ts`, `tests/recipes/prismic-ci.test.ts`, `tests/recipes/launch.test.ts`
- Create: `tests/cli/launch-command.test.ts` — the `probe` formatter branch (there is no launch CLI test today)
- Create: `.changeset/prismic-ci-positional-and-launch-guard.md`
- Create: `docs/superpowers/plans/2026-09-08-webflow-pipeline-e-wiring-and-records.md` (this file, copied in)

**claude-skills** (`$SKILLS`)

- Modify: `skills/new-site/SKILL.md` — steps 6b/6c/6d/6e, three verification items, one hand-off line
- Modify: `skills/matching-a-page/SKILL.md` — Workspace (:96-117), Phase 0 steps 1/8 and the probe block (:123-183), new `## Launch disposition` after `## Whole sites` (:469)
- Modify: `docs/workJournal.md` — append the entry from Task 13

**reddoor-starter** (`$STARTER`)

- Modify: `CLAUDE.md:180` — one orientation-table row
- Modify: `docs/workJournal.md` — the 2026-09-08 entry + a forward pointer under the 2026-09-05 backfill heading (:14)

**beachfront-dentistry** (`$BF`)

- Modify: `customtypes/settings/index.json:20` — one label
- Modify: `docs/workJournal.md` — the entry from Task 13, carrying the run URLs

---

### Task 0: Worktree, branch, plan committed, baseline green

**Files:** Create: `$MAINT/docs/superpowers/plans/2026-09-08-webflow-pipeline-e-wiring-and-records.md` (copy)

- [ ] **Step 1: Cut the worktree from `origin/main`**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git fetch origin
git worktree add .worktrees/wiring -b feat/prismic-ci-positional-and-launch-guard origin/main
cd .worktrees/wiring && pnpm install --frozen-lockfile && git log --oneline -1
```

Expected: one line naming the current `origin/main` commit — **record it verbatim**; Task 6 diffs against it. Do NOT try to match a SHA written in this plan: `origin/main` moved from `686b08d` to `b18d369` in the hours this plan was drafted, so a different SHA is normal and is not evidence of a wrong branch. If `git worktree add` or `pnpm install` is denied by the sandbox, re-run that one command unsandboxed; it writes only inside this repo.

- [ ] **Step 2: Copy this plan in and make it prettier-clean**

`pnpm verify` runs `prettier --check .` and `.prettierignore` does not exclude `docs/superpowers/`, so an unformatted plan reds CI before any code is judged.

```bash
export MAINT=/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/wiring
cp /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/docs/superpowers/plans/2026-09-08-webflow-pipeline-e-wiring-and-records.md "$MAINT/docs/superpowers/plans/"
cd "$MAINT" && pnpm exec prettier --write docs/superpowers/plans/2026-09-08-webflow-pipeline-e-wiring-and-records.md && pnpm exec prettier --check docs/superpowers/
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 3: Record the green baseline**

```bash
cd "$MAINT" && pnpm build && pnpm test 2>&1 | tail -n 5
```

Expected: `Test Files  N passed (N)` / `Tests  M passed (M)`, no `failed`. Write N and M down — Task 6's `pnpm verify` must show strictly more tests.

- [ ] **Step 4: Commit**

```bash
cd "$MAINT" && git add docs/superpowers/plans/2026-09-08-webflow-pipeline-e-wiring-and-records.md
git commit -m "docs: plan E — new-site wiring, launch disposition, skill edits, records

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: `resolveOwnerRepo` — one repo-identity resolver, shared

**Files:** Modify: `$MAINT/src/util/git.ts:132-140` · Modify: `$MAINT/src/recipes/self-updating/index.ts:11-13,70-103,110` · Test: `$MAINT/tests/util/git-owner-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/util/git-owner-repo.test.ts` (its current imports are `parseOwnerRepo, isOwnerRepo, sameOwnerRepo` on line 2 — extend that list):

```ts
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOwnerRepo } from "../../src/util/git.js";

describe("resolveOwnerRepo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owner-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers an explicit gitRepo over the checkout's origin", async () => {
    execFileSync("git", ["remote", "add", "origin", "https://github.com/other/thing.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir, gitRepo: "reddoorla/espada" })).toBe(
      "reddoorla/espada",
    );
  });

  it("derives owner/repo from origin when the site carries no gitRepo", async () => {
    // The whole reason this helper is shared: `localPath()` (src/inventory/local.ts:11)
    // builds a positional Site with NO gitRepo, so every recipe that read
    // site.gitRepo directly refused a checkout passed by path.
    execFileSync("git", ["remote", "add", "origin", "git@github.com:reddoorla/29-navy.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir })).toBe("reddoorla/29-navy");
  });

  it("returns null — not a throw — when there is no gitRepo and no origin", async () => {
    expect(await resolveOwnerRepo({ path: dir })).toBeNull();
  });

  it("throws on a malformed explicit gitRepo before any caller can use it", async () => {
    await expect(resolveOwnerRepo({ path: dir, gitRepo: "--flag" })).rejects.toThrow(/owner\/repo/);
  });

  it("throws on a malformed identity derived from origin", async () => {
    // The fixture must be a value that fails AFTER parseOwnerRepo, not one that
    // fails to parse. `--flag` (the case above) has no slash, so parseOwnerRepo
    // returns null and this helper returns null instead of throwing. And an
    // origin of `https://github.com/ok/--evil` is NOT malformed by this repo's
    // rules: `-` is inside OWNER_REPO_RE's character class (src/util/git.ts:94),
    // so isOwnerRepo("ok/--evil") is TRUE. A traversal segment is what the
    // explicit `repo.includes("..")` reject at src/util/git.ts:100 catches:
    // parseOwnerRepo takes the LAST TWO path segments, so this origin parses to
    // "../evil" — verified against the real parser, not assumed.
    execFileSync("git", ["remote", "add", "origin", "https://github.com/ok/../evil"], {
      cwd: dir,
    });
    await expect(resolveOwnerRepo({ path: dir })).rejects.toThrow(/from origin/);
  });
});
```

Add `beforeEach, afterEach` to the vitest import on line 1.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$MAINT" && pnpm exec vitest run tests/util/git-owner-repo.test.ts
```

Expected: the file fails to collect — `does not provide an export named 'resolveOwnerRepo'`.

- [ ] **Step 3: Implement**

In `src/util/git.ts`, add `import type { Site } from "../types.js";` at the top (`src/types.ts` has no imports of its own, so this cannot cycle), and insert between `getRemoteUrl` (ends :135) and the `push` docblock (:137):

```ts
/**
 * Resolve the `owner/repo` a recipe will act on. An explicit `site.gitRepo`
 * (Airtable, or a JSON inventory) wins; otherwise derive it from the checkout's
 * `origin`.
 *
 * Returns `null` when there is nothing to act on (no `gitRepo`, no origin) — a
 * benign "nothing wired" state. THROWS when a value IS present but does not
 * match the strict `owner/repo` shape: callers write repo secrets, branch
 * protection and pull requests at this identity, so a typo'd or
 * attacker-controlled value must be rejected here, before the first `gh` call.
 *
 * Extracted from `self-updating`'s private `resolveRepo` because `prismic-ci`
 * read `site.gitRepo` directly and therefore refused every POSITIONAL run with
 * "no Git repo on this site" — `localPath()` (src/inventory/local.ts:11) builds
 * `{ path, name }` and nothing else. A site being bootstrapped is exactly the
 * case that has no Airtable row yet (`--fleet airtable` filters pre-launch
 * statuses), so the positional path is the ONLY one `/new-site` can use.
 */
export async function resolveOwnerRepo(site: Site): Promise<string | null> {
  if (site.gitRepo) {
    if (!isOwnerRepo(site.gitRepo)) {
      throw new Error(
        `refusing to act on malformed repo identity: expected "owner/repo", got ${JSON.stringify(site.gitRepo)}`,
      );
    }
    return site.gitRepo;
  }
  let fromOrigin: string | null;
  try {
    fromOrigin = parseOwnerRepo(await getRemoteUrl(site.path));
  } catch {
    return null;
  }
  if (fromOrigin === null) return null;
  if (!isOwnerRepo(fromOrigin)) {
    throw new Error(
      `refusing to act on malformed repo identity from origin: ${JSON.stringify(fromOrigin)}`,
    );
  }
  return fromOrigin;
}
```

Then in `src/recipes/self-updating/index.ts` delete lines 70–103 (the `resolveRepo` docblock and function) verbatim, replace `getRemoteUrl,` / `parseOwnerRepo,` / `isOwnerRepo,` (lines 11-13 of the `../../util/git.js` import) with `resolveOwnerRepo,`, and change line 110 from `repo = await resolveRepo(site);` to `repo = await resolveOwnerRepo(site);`. Nothing else in that file uses the three removed names (`grep -n "isOwnerRepo\|parseOwnerRepo\|getRemoteUrl"` returns only the import lines and the deleted body).

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/util/git-owner-repo.test.ts tests/recipes/self-updating.test.ts && pnpm exec tsc --noEmit
```

Expected: both files pass (self-updating's existing suite is the regression guard on the extraction), `tsc` silent.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && git add -A && git commit -m "refactor(git): share resolveOwnerRepo, so a recipe can resolve a positional checkout

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `prismic-ci` resolves a positional checkout

**Files:** Modify: `$MAINT/src/recipes/prismic-ci/index.ts:15,113-124` · Test: `$MAINT/tests/recipes/prismic-ci.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("prismicCi", …)` in `tests/recipes/prismic-ci.test.ts`, next to the two existing identity tests (:272-286). `prismicSite()` already `git init`s the tmpdir and writes `slicemachine.config.json` + a lockfile.

```ts
it("resolves the repo from origin when the site has no gitRepo (the positional path)", async () => {
  // `reddoor-maint prismic-ci <path>` builds a Site with no gitRepo at all
  // (src/inventory/local.ts:11). Before resolveOwnerRepo this ALWAYS failed
  // with "no Git repo on this site", which is why /new-site could never install
  // model delivery on a site that has no Airtable row yet.
  await prismicSite();
  git(["remote", "add", "origin", "https://github.com/reddoorla/espada.git"]);
  const { d } = deps();
  const r = await prismicCi({ path: dir, name: "Espada" }, d);
  expect(r.status).toBe("applied");
  expect(d.github!.secretExists).toHaveBeenCalledWith("reddoorla/espada", SECRET);
});

it("fails on a malformed origin rather than letting it reach gh", async () => {
  await prismicSite();
  // Same fixture as the git-owner-repo test, for the same reason: this origin
  // parses to "../evil" and is rejected by isOwnerRepo's explicit `..` check
  // (src/util/git.ts:100). Do NOT use `.../ok/--evil` here — `-` is inside
  // OWNER_REPO_RE's class (git.ts:94), so "ok/--evil" is ACCEPTED and the recipe
  // would proceed to call secretExists("ok/--evil", SECRET), failing both
  // assertions below permanently rather than red-then-green.
  git(["remote", "add", "origin", "https://github.com/ok/../evil"]);
  const { d } = deps();
  const r = await prismicCi({ path: dir, name: "Espada" }, d);
  expect(r.status).toBe("failed");
  expect(r.notes).toMatch(/from origin/);
  expect(d.github!.secretExists).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$MAINT" && pnpm exec vitest run tests/recipes/prismic-ci.test.ts -t "positional path"
```

Expected: `expected 'failed' to be 'applied'`, with `r.notes` = `no Git repo on this site (set Airtable 'Git repo')`.

- [ ] **Step 3: Implement**

In `src/recipes/prismic-ci/index.ts`, replace `isOwnerRepo,` on line 15 with `resolveOwnerRepo,` in the `../../util/git.js` import, and replace lines 113–124:

```ts
const repo = site.gitRepo;
if (!repo) {
  return resultOf(site, "failed", "no Git repo on this site (set Airtable 'Git repo')");
}
if (!isOwnerRepo(repo)) {
  return resultOf(
    site,
    "failed",
    `refusing to act on malformed repo identity: expected "owner/repo", got ${JSON.stringify(repo)}`,
  );
}
```

with:

```ts
let repo: string | null;
try {
  repo = await resolveOwnerRepo(site);
} catch (err) {
  // A malformed identity aborts before any `gh` write — surfaced as a recipe
  // failure rather than being interpolated into an API path.
  return resultOf(site, "failed", messageOf(err));
}
if (!repo) {
  return resultOf(site, "failed", "no Git repo (set Airtable 'Git repo' or add an origin remote)");
}
```

Leave the comment block at :109-112 in place and extend its first sentence to `1. Repo identity — from Airtable's 'Git repo' or, on a positional run, the checkout's origin.`

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/recipes/prismic-ci.test.ts tests/cli/prismic-ci-command.test.ts
```

Expected: all pass, including the two pre-existing identity tests (`/git repo/i` still matches the reworded refusal; `/owner\/repo/` still matches the explicit-gitRepo throw).

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && git add -A && git commit -m "fix(prismic-ci): resolve owner/repo from origin, so a positional run works

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Renovate does not bump an installed pin — five instances, four files

**Files:** Modify: `$MAINT/src/recipes/prismic-ci/template.ts:63-68` and `:81-82` · `$MAINT/src/recipes/sync-configs/templates.ts:82-85` · `$MAINT/src/recipes/self-updating/index.ts:35-38` · `$MAINT/docs/runbooks/prismic-model-delivery.md:122,124`

No unit test asserts these comment bodies (`grep -rn "github-actions manager" tests/` is empty); the verification is a grep pair — the false sentence gone from the source tree, the corrected one present in each of the four files.

- [ ] **Step 1: Establish the class before fixing an instance — with a grep that can actually see it**

The obvious single-phrase grep is not sufficient, and knowing why is the point of this step. The sentence wraps across a line break in `sync-configs/templates.ts` (`…and Renovate's` / `github-actions manager bumps the pinned…`, lines 83-84), so a line-oriented grep for `"Renovate's github-actions manager"` **misses the very instance Step 4 goes on to edit**. Run both:

```bash
cd "$MAINT"
grep -rn "Renovate's github-actions manager\|Renovate bumps its pinned\|Renovate bumps the per-repo pin" src docs --exclude-dir=plans
echo "--- multiline-capable, catches the wrapped one ---"
grep -rn "github-actions manager" src docs --exclude-dir=plans
```

Expected — **five code/doc hits, in four files**, verified on 2026-09-08:

| File:line                                     | Verdict                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/recipes/prismic-ci/template.ts:38`       | **NOT a defect.** "is what a human (and Renovate's github-actions manager) reads" is true — Renovate's manager does read a `uses:` tag. Leave it alone. |
| `src/recipes/prismic-ci/template.ts:65`       | defect — Step 2                                                                                                                                         |
| `src/recipes/prismic-ci/template.ts:81-82`    | defect, the SAME claim a second time in `isPinResolved`'s docblock — Step 3                                                                             |
| `src/recipes/sync-configs/templates.ts:83-84` | defect, **only the second grep finds it** (wrapped) — Step 4                                                                                            |
| `src/recipes/self-updating/index.ts:36-37`    | defect — Step 5                                                                                                                                         |
| `docs/runbooks/prismic-model-delivery.md:122` | defect — Step 6                                                                                                                                         |

`--exclude-dir=plans` is load-bearing: Task 0 Step 2 copied this plan into `docs/superpowers/plans/`, and every Before block below quotes the false sentence verbatim. Without the exclusion the grep can never come back empty, no matter how many sources are fixed. If a hit appears that is not in this table, fix it too and say so in the journal.

- [ ] **Step 2: `prismic-ci/template.ts` — replace lines 63-68**

Before (inside the `REUSABLE_WORKFLOW_PIN` docblock):

```ts
 * TO RE-RESOLVE after a future `reddoorla/.github` release: set `sha` to
 * `gh api repos/reddoorla/.github/commits/<tag> --jq .sha` and `tag` to that
 * tag. Nothing else changes. Renovate's github-actions manager bumps the
 * already-installed `uses:` line per site repo; this constant is what NEW
 * rollouts install, so a stale value here is not a broken fleet, only a fleet
 * whose newest members start one version behind.
```

After:

```ts
 * TO RE-RESOLVE after a future `reddoorla/.github` release: set `sha` to
 * `gh api repos/reddoorla/.github/commits/<tag> --jq .sha` and `tag` to that
 * tag — and then PROPAGATE, because NOTHING BUMPS AN INSTALLED PIN
 * AUTOMATICALLY — and Renovate here is unreliable rather than absent. It HAS
 * bumped this exact ref (espada#40, v1.2.0 -> v1.3.0, merged 2026-07-26; 17
 * repos moved on that tag), but proposed NEITHER v1.4.0 nor v1.4.1 for the
 * ci.yml caller, which was swept BY HAND (beachfront-dentistry#36). Do not
 * look for those PRs by author: Renovate runs self-hosted here with a PAT, so
 * its PRs are authored by `tucksravin` and an `app/renovate` filter returns a
 * confident empty set. Filter on the head branch `renovate/*`. (The installed
 * prismic-models.yml files still pinning v1.4.0 are NOT stale: `gh api
 * repos/reddoorla/.github/compare/v1.4.0...v1.4.1` returns only ci.yml, so
 * that file is byte-identical across the tags.) Propagation is three
 * steps: (1) re-resolve this constant, (2) release @reddoorla/maintenance,
 * (3) `reddoor-maint prismic-ci --fleet airtable` — gate 6 content-compares
 * the installed file and opens a corrective PR per stale repo — plus ONE
 * POSITIONAL RUN PER PRE-LAUNCH SITE, which the Airtable inventory excludes
 * (`src/inventory/airtable.ts` filters `building`/`launching`).
```

- [ ] **Step 3: `prismic-ci/template.ts` — the second instance, in `isPinResolved`'s docblock (lines 81-82)**

Same file, eighteen lines further down, same false claim. Step 2's block does not cover it.

Before:

```ts
 * whatever token the workflow holds), and Renovate's github-actions manager
 * bumps the pin per repo when `reddoorla/.github` tags a new version.
```

After:

```ts
 * whatever token the workflow holds). Nothing bumps the pin per repo when
 * `reddoorla/.github` tags a new version — Renovate bumps this ref only
 * sometimes and skipped the last two tags; see the propagation note on
 * {@link REUSABLE_WORKFLOW_PIN} above.
```

- [ ] **Step 4: `sync-configs/templates.ts` — replace lines 82-85**

Before:

```ts
// this file's `ci` entry). Ownership is split instead: the STARTER clone
// provides each site's ci.yml shape at bootstrap, and Renovate's
// github-actions manager bumps the pinned reusable-workflow ref per repo when
// reddoorla/.github tags a new version. The caller job name `ci` + the
```

After:

```ts
// this file's `ci` entry). Ownership is split instead: the STARTER clone
// provides each site's ci.yml shape at bootstrap, and the pinned
// reusable-workflow ref is VERIFIED after each reddoorla/.github tag —
// Renovate bumps it only sometimes (it did for v1.3.0; not for v1.4.0 or
// v1.4.1, which was hand-swept across 21 repos on 2026-09-01). The caller
// job name `ci` + the
```

- [ ] **Step 5: `self-updating/index.ts` — replace lines 35-38**

Before:

```ts
// the 2026-08-02 architecture review found. The starter clone owns ci.yml's
// shape; Renovate bumps its pinned reusable-workflow ref per repo (proven:
// its github-actions manager already updates action pins on fleet sites, and
// reddoorla/.github publishes the tags it tracks).
```

After:

```ts
// the 2026-08-02 architecture review found. The starter clone owns ci.yml's
// shape, and its pinned reusable-workflow ref must be VERIFIED after each
// reddoorla/.github tag rather than assumed. Renovate does bump this ref
// sometimes — espada#40 carried v1.2.0 -> v1.3.0 on 2026-07-26 — but it
// proposed neither v1.4.0 nor v1.4.1, and v1.4.1 was hand-swept on
// 2026-09-01. The earlier "(proven)" was an inference from ordinary action
// pins rather than an observation of this ref; the fix is to observe it.
```

- [ ] **Step 6: The runbook — line 122's last sentence, plus a new subsection**

Replace the trailing `Nothing else changes. Renovate's github-actions manager bumps the per-repo pin afterwards, like any other pinned action.` on line 122 with `Then propagate — see "After every \`reddoorla/.github\` tag" below.`and insert after line 124 (before the`---` on :126):

```markdown
### After every `reddoorla/.github` tag

**Never assume an installed pin was bumped — verify it.** Renovate bumps this ref only sometimes: it carried v1.2.0 → v1.3.0 across the fleet in July (espada#40, merged 2026-07-26), then proposed neither v1.4.0 nor v1.4.1, and v1.4.1 reached the fleet only because ci.yml was swept by hand across 21 repos. Two traps when you check. Renovate runs self-hosted here with a PAT, so its PRs are authored by `tucksravin` — an author-filtered search returns a confident empty set, so filter on the head branch `renovate/*` instead. And an older pin is not by itself staleness: every installed `prismic-models.yml` still pins v1.4.0 and that is CORRECT, because `gh api repos/reddoorla/.github/compare/v1.4.0...v1.4.1` returns only `ci.yml` — prismic-models.yml is byte-identical across the two tags. (Worded without the phrase "Renovate's github-actions manager" on purpose — that string is the tripwire Step 7 greps for, and the correction must not re-trip it.)

So a tag is three more steps, not one:

1. Re-resolve `REUSABLE_WORKFLOW_PIN` in `src/recipes/prismic-ci/template.ts`.
2. Release `@reddoorla/maintenance` (the recipe ships in the package).
3. `reddoor-maint prismic-ci --fleet airtable` — gate 6 content-compares the installed workflow, so a stale pin is corrected by a fresh PR per repo — **plus one positional run per pre-launch site**, because `--fleet airtable` filters `building` and `launching` rows out of the inventory entirely.

Step 3 is the whole propagation mechanism. Skipping it leaves the fleet on whatever it installed the day it was bootstrapped.
```

- [ ] **Step 7: Verify — the false claim is gone, the correction is present in four files**

Both greps carry `--exclude-dir=plans`. This plan file lives in `docs/superpowers/plans/` (Task 0 Step 2 put it there) and quotes every corrected sentence verbatim in its Before blocks, so an unscoped grep returns those quotations forever and this gate could never pass.

```bash
cd "$MAINT"
grep -rn "Renovate's github-actions manager\|Renovate bumps its pinned\|Renovate bumps the per-repo pin" src docs --exclude-dir=plans ; echo "exit=$?"
grep -rn "github-actions manager" src docs --exclude-dir=plans ; echo "wrapped-check-exit=$?"
grep -rln "never opened a" src docs --exclude-dir=plans
pnpm exec prettier --check src docs && pnpm exec vitest run tests/recipes/prismic-ci.test.ts tests/build/reusable-prismic-workflow.test.ts
```

Expected: the first grep prints **only** `src/recipes/prismic-ci/template.ts:38` (the benign "is what a human (and Renovate's github-actions manager) reads", deliberately untouched — see Step 1's table) with `exit=0`; the second prints that same single line, proving the wrapped `sync-configs` instance is gone too; the third lists exactly the four files (`prismic-ci/template.ts`, `sync-configs/templates.ts`, `self-updating/index.ts`, `docs/runbooks/prismic-model-delivery.md`); prettier and both suites green.

- [ ] **Step 8: Commit**

```bash
cd "$MAINT" && git add -A && git commit -m "docs: nothing bumps an installed workflow pin — the re-run is the mechanism

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `launch` — a matching disposition pre-flight and a production dev-guard

**Files:** Modify: `$MAINT/src/recipes/launch.ts:25-29,39-55,69-76,117-126` · Modify: `$MAINT/src/cli/commands/launch.ts:9-23` · Test: `$MAINT/tests/recipes/launch.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/recipes/launch.test.ts`, add to the imports:

```ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Add a `probe` to the shared `deps()` helper (:56-67) so every existing test runs a launched site's happy path — without this they inherit the `global.fetch` stub, which answers 200 to everything and is exactly the state the guard must fail on:

```ts
    probe: async (url: string) => {
      if (url.endsWith("/dev/match/home"))
        return { status: 404, body: "<div><h1>404</h1><p>Not found</p></div>" };
      return { status: 200, body: "<h1>Fixtures</h1>" };
    },
```

Change the step-name assertion on line 75 to:

```ts
expect(result.steps.map((s) => s.name)).toEqual([
  "matching-disposition",
  "self-updating",
  "dev-guard",
  "audit",
  "draft",
]);
```

Then add five cases inside `describe("recipes/launch", …)`:

```ts
it("stops at dev-guard when the matching twin still answers 200 in production", async () => {
  const base = makeFakeBase(websitesSeed());
  const result = await launch(siteOf(), {
    ...deps(base),
    probe: async () => ({ status: 200, body: "<h1>Home</h1>" }),
  });
  expect(result.complete).toBe(false);
  const guard = result.steps.find((s) => s.name === "dev-guard");
  expect(guard?.result).toMatchObject({ kind: "error" });
  expect((guard?.result as { message: string }).message).toMatch(/live in production/);
});

it("stops at dev-guard when the 404 is not this site's own error page", async () => {
  // A parked domain, a CDN 404 and a deleted route all answer 404. Only the
  // site's own +error.svelte renders <h1>404</h1>. Without the marker the guard
  // would pass on a site that is simply gone.
  const base = makeFakeBase(websitesSeed());
  const result = await launch(siteOf(), {
    ...deps(base),
    probe: async (url: string) =>
      url.endsWith("/dev/match/home")
        ? { status: 404, body: "<html><body>Page not found · Netlify</body></html>" }
        : { status: 200, body: "<h1>Fixtures</h1>" },
  });
  expect(result.complete).toBe(false);
  const guard = result.steps.find((s) => s.name === "dev-guard");
  expect((guard?.result as { message: string }).message).toMatch(/own error page/);
});

it("stops at dev-guard when the liveness control does not answer 200", async () => {
  const base = makeFakeBase(websitesSeed());
  const result = await launch(siteOf(), {
    ...deps(base),
    probe: async (url: string) =>
      url.endsWith("/dev/match/home")
        ? { status: 404, body: "<h1>404</h1>" }
        : { status: 503, body: "" },
  });
  expect(result.complete).toBe(false);
  const guard = result.steps.find((s) => s.name === "dev-guard");
  expect((guard?.result as { message: string }).message).toMatch(/proves nothing/);
});

it("stops before bootstrap when the checkout serves an unguarded /dev/match twin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-disposition-"));
  await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
  await writeFile(
    join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
    "export const prerender = false;\nexport async function load({ params }) {\n  return { uid: params.uid };\n}\n",
  );
  const base = makeFakeBase(websitesSeed());
  let bootstrapped = false;
  const result = await launch(
    { path: dir, name: "Acme Co" },
    {
      ...deps(base),
      bootstrap: async (): Promise<RecipeResult> => {
        bootstrapped = true;
        return { recipe: "self-updating", site: "Acme Co", status: "applied", commits: [] };
      },
    },
  );
  expect(result.complete).toBe(false);
  expect(result.steps.map((s) => s.name)).toEqual(["matching-disposition"]);
  expect(bootstrapped).toBe(false);
  await rm(dir, { recursive: true, force: true });
});

it("passes the pre-flight once the twin route carries the dev guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "launch-disposition-ok-"));
  await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
  await writeFile(
    join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
    'import { dev } from "$app/environment";\nimport { error } from "@sveltejs/kit";\nexport const prerender = false;\nexport async function load({ params }) {\n  if (!dev) error(404, { message: "Not found" });\n  return { uid: params.uid };\n}\n',
  );
  const base = makeFakeBase(websitesSeed());
  const result = await launch({ path: dir, name: "Acme Co" }, deps(base));
  expect(result.complete).toBe(true);
  expect(result.steps[0]!.result).toMatchObject({
    kind: "probe",
    message: expect.stringContaining("dev guard"),
  });
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd "$MAINT" && pnpm exec vitest run tests/recipes/launch.test.ts
```

Expected: the first assertion fails with `expected [ 'self-updating', 'audit', 'draft' ] to deeply equal [ 'matching-disposition', 'self-updating', 'dev-guard', 'audit', 'draft' ]`, and every new case fails (`Cannot find` step `dev-guard` / `result.complete` is `true`).

- [ ] **Step 3: Implement `launch.ts`**

Add to the imports at the top:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
```

Extend `LaunchStepResult` (:25-29) with one member — `{ kind: "probe"; message: string }` — placed before `{ kind: "error"; … }`. Add to `LaunchDeps` (:39-55):

```ts
  /** HTTP probe for `dev-guard`. Defaults to global fetch. INJECTED in tests:
   *  the suite stubs `global.fetch` for the Airtable attachment upload and that
   *  stub answers 200 to everything — which is precisely the state this step
   *  exists to fail on. */
  probe?: (url: string) => Promise<{ status: number; body: string }>;
```

Add above `export async function launch`:

```ts
/** The site's OWN 404. `src/routes/+error.svelte` renders `<h1>{page.status}</h1>`,
 *  so a real SvelteKit 404 from this app carries an `<h1>404</h1>`; a parked
 *  domain, a CDN 404 and a dead host do not. "The route is gone" and "the site
 *  is gone" must not look the same to this gate. */
const SITE_404_MARKER = /<h1[^>]*>\s*404\s*<\/h1>/i;

const MATCH_ROUTE_DIR = "src/routes/dev/match";
const MATCH_GUARD_FILE = "src/routes/dev/match/[uid]/+page.server.ts";

/**
 * Pre-flight: a checkout that still carries the matching twin must carry the
 * dev guard the `match-harness` recipe installs with it. Nothing is deleted at
 * launch — the harness stays for the next round — so the guard is the whole
 * mechanism keeping `/dev/match/*` off the production build.
 *
 * Filesystem only, and it runs BEFORE any GitHub write: a site that will fail
 * the deployed check should not first acquire branch protection and an audit.
 */
export async function matchingDisposition(
  sitePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!existsSync(join(sitePath, MATCH_ROUTE_DIR))) {
    return { ok: true, message: `no ${MATCH_ROUTE_DIR} in this checkout` };
  }
  let source: string;
  try {
    source = await readFile(join(sitePath, MATCH_GUARD_FILE), "utf-8");
  } catch {
    return {
      ok: false,
      message: `${MATCH_ROUTE_DIR} exists but ${MATCH_GUARD_FILE} could not be read — the twin's disposition cannot be established`,
    };
  }
  if (!(source.includes("$app/environment") && /if\s*\(\s*!\s*dev\s*\)/.test(source))) {
    return {
      ok: false,
      message: `${MATCH_GUARD_FILE} has no \`if (!dev)\` guard on \`$app/environment\` — the matching twin would ship`,
    };
  }
  return { ok: true, message: `${MATCH_GUARD_FILE} carries the dev guard` };
}

const defaultProbe = async (url: string): Promise<{ status: number; body: string }> => {
  const res = await fetch(url, { redirect: "follow" });
  return { status: res.status, body: await res.text() };
};
```

**Contract with plan BC — read this before believing the passing branch.** `matchingDisposition`'s accept condition is `source.includes("$app/environment") && /if\s*\(\s*!\s*dev\s*\)/`, and today **nothing in any repo produces a file that satisfies it**; the only proof of the green branch is the fixture this plan's own test writes. Two things follow, and both are obligations, not observations:

- **The exact source BC must install** into `src/routes/dev/match/[uid]/+page.server.ts`, per the decisions, is:

  ```ts
  import { dev } from "$app/environment";
  import { error } from "@sveltejs/kit";

  export const prerender = false;

  export async function load({ params }) {
    if (!dev) error(404, { message: "Not found" });
    // …
  }
  ```

  A guard written `if (dev === false)`, or with the `!dev` split across a line break, is silently REJECTED by this regex even though it is correct. If BC needs a different shape, the predicate changes here first.

- **BC's recipe test must import this predicate, not restate the regex.** `matchingDisposition` is exported for exactly that: BC's `tests/recipes/match-harness.test.ts` asserts `(await matchingDisposition(installedSiteDir)).ok === true` against the file its own template just wrote. Restating the regex in BC would let the two drift and prove nothing. Note this in the maintenance PR body (Task 6 Step 4) so BC's executor sees it.

**Beachfront will FAIL this pre-flight from the moment this ships, and that is not a regression.** `beachfront-dentistry/src/routes/dev/match/[uid]/+page.server.ts` exists today with `export const prerender = false` and **no `$app/environment` import at all** (verified 2026-09-08) — it imports `$lib/prismicio`, `$lib/beachfront-pages.js` and the catalog collections loader instead. So `reddoor-maint launch` on Beachfront stops at step 0 with "`src/routes/dev/match/[uid]/+page.server.ts` has no `if (!dev)` guard on `$app/environment`". That verdict is CORRECT — that route ships a Prismic-fetching twin into the production build — and the fix is C3 (`match-harness` re-installing the guarded route on Beachfront), not a loosening here. Say so in the maintenance PR body; do not let a launch attempt read it as a break.

Inside `launch()`, after `const base = …` (:73) add `const probe = deps.probe ?? defaultProbe;`, and immediately after `const stop = …` (:76) insert step 0:

```ts
// 0. Matching disposition — filesystem, before any GitHub write.
const disposition = await matchingDisposition(site.path);
steps.push({
  name: "matching-disposition",
  result: disposition.ok
    ? { kind: "probe", message: disposition.message }
    : { kind: "error", message: disposition.message },
});
if (!disposition.ok) return stop();
```

Then, between the Websites-row lookup's closing `}` (:125) and `try { const auditWrite = …` (:126), insert the deployed check:

```ts
// 2b. The dev guard, on the DEPLOYED build. Two halves, both required:
//     /dev/match/home must 404 WITH this site's own error page, and
//     /health must answer 200. Without the second, a dead host, a wrong url
//     and a parked domain all "pass" the first — an absent error granting a
//     green, which is the one shape this fleet does not allow. /health and
//     NOT a dev route: every starter-derived repo ships it with
//     `export const prerender = false`, so a 200 is a live invocation — and a
//     dev-route control would be deleted by the very dev-layout guard this
//     check exists to encourage.
//     Reading the deployed url makes this a production-build check by
//     construction; no local build can substitute.
const origin = target.url.replace(/\/+$/, "");
let twin: { status: number; body: string };
let control: { status: number; body: string };
try {
  twin = await probe(`${origin}/dev/match/home`);
  control = await probe(`${origin}/health`);
} catch (err) {
  steps.push({ name: "dev-guard", result: errorOf(err) });
  return stop();
}
if (control.status !== 200) {
  steps.push({
    name: "dev-guard",
    result: {
      kind: "error",
      message: `${origin}/health answered ${control.status}, not 200 — the twin's 404 proves nothing (host down, wrong url, or the site is not serving functions)`,
    },
  });
  return stop();
}
if (twin.status !== 404 || !SITE_404_MARKER.test(twin.body)) {
  steps.push({
    name: "dev-guard",
    result: {
      kind: "error",
      message:
        twin.status === 404
          ? `${origin}/dev/match/home 404s, but not with this site's own error page — cannot tell the guard from a dead route`
          : `${origin}/dev/match/home answered ${twin.status} — the matching twin is live in production`,
    },
  });
  return stop();
}
steps.push({
  name: "dev-guard",
  result: {
    kind: "probe",
    message: `${origin}/dev/match/home 404 (site error page), /health 200`,
  },
});
```

- [ ] **Step 4: Implement the CLI formatter — and give it the one assertion it has never had**

`src/cli/commands/launch.ts` `formatStep` falls through to `const rec = r.result;` (:18), so `tsc` fails on the new member until a branch exists. **That failure is not a test.** `tsc` going quiet is an absent error, and there is no launch CLI test in this repo at all (`ls tests/cli | grep -i launch` returns nothing), so a branch that emitted the wrong verb or the wrong padding would ship green. Export the function and assert its output.

Change line 9 from `function formatStep(` to `export function formatStep(` — it is currently module-private, and `formatResult` (:25) is too, so there is nothing else to assert against. Then insert after the `draft` branch (:15-17):

```ts
if (r.kind === "probe") return `${name.padEnd(20)} ok — ${r.message}`;
```

Create `tests/cli/launch-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatStep } from "../../src/cli/commands/launch.js";

describe("cli/launch formatStep", () => {
  it("renders a probe step as an ok line carrying its evidence", () => {
    expect(formatStep("dev-guard", { kind: "probe", message: "404 (site error page)" })).toBe(
      "dev-guard            ok — 404 (site error page)",
    );
  });

  it("still renders an error step as an error line", () => {
    expect(formatStep("dev-guard", { kind: "error", message: "live in production" })).toBe(
      "dev-guard            error: live in production",
    );
  });
});
```

`"dev-guard"` is 9 characters, so `padEnd(20)` adds 11 spaces and the template's own separator adds a 12th: **exactly 12 spaces** between `dev-guard` and `ok —` / `error:`. Both literals above were checked against `"dev-guard".padEnd(20) + " ok — …"` in node before being written down. Getting the padding wrong is the point — the assertion fails on a formatter that is only nearly right, which is what `tsc --noEmit` alone cannot do.

- [ ] **Step 5: Run everything and watch it pass**

```bash
cd "$MAINT" && pnpm exec tsc --noEmit && pnpm exec vitest run tests/recipes/launch.test.ts tests/cli/launch-command.test.ts
```

Expected: `tsc` silent; `tests/recipes/launch.test.ts` `14 passed` (9 pre-existing + 5 new) and `tests/cli/launch-command.test.ts` `2 passed`.

- [ ] **Step 6: Break it on purpose, and watch the right test go red**

A guard that only checks the status code passes on a dead host. Prove the marker half is load-bearing: temporarily change `if (twin.status !== 404 || !SITE_404_MARKER.test(twin.body))` to `if (twin.status !== 404)` and re-run.

```bash
cd "$MAINT" && pnpm exec vitest run tests/recipes/launch.test.ts -t "not this site's own error page"
```

Expected: that one test FAILS (`expected true to be false`) while the others pass. Restore the condition and re-run to green before committing.

- [ ] **Step 7: Commit**

```bash
cd "$MAINT" && git add -A && git commit -m "feat(launch): refuse to draft while the /dev/match twin is live in production

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The maintenance merge rule — cherry-pick, never `git merge starter/main`

**Files:** Modify: `$MAINT/CLAUDE.md:194-195`

**The spec says `CLAUDE.md:116`. That number is STALE — do not use it.** It was read off the maintenance working checkout, which sits on `feat/audit-check-battery` with a divergent 128-line `CLAUDE.md`. The worktree you are in is cut from `origin/main`, where the file is 206 lines and these two lines are at **194-195** (`git show origin/main:CLAUDE.md | grep -n 'Forward-merge only'` → 194, verified 2026-09-08). Editing 116-117 in the worktree lands in unrelated work-journal prose.

- [ ] **Step 1: Locate by text, not by number — then replace the two lines**

```bash
cd "$MAINT" && grep -n "Forward-merge only" CLAUDE.md
```

Expected: one hit, at **194**. If it reports a different number, `origin/main` has moved again — use the number it reports, not the one written here, and note the drift in the journal. If it reports zero hits or more than one, stop: something else changed this file.

Before (lines 194-195):

```markdown
`/new-site <slug> --track blux`. Forward-merge only (`git merge starter/main`
in that repo); never merge it back.
```

After:

```markdown
`/new-site <slug> --track blux`. **Cherry-pick, never `git merge
  starter/main`** — the forward-merge rule this line used to carry was a
landmine: native-ize (reddoor-starter#106) deleted the whole Blux layer, so
the merge applies 178 deletions as clean, CONFLICT-FREE removals and strips
`src/lib/blux*`, every `Blux*` slice and the fidelity gates, with only
`README.md` conflicting so nothing warns you (verified 2026-09-01; the rule
was replaced in that repo's own CLAUDE.md, reddoor-starter-blux#2). Adopt a
shared improvement with `git fetch starter && git cherry-pick <sha>`, and
never merge that repo back into this one.
```

- [ ] **Step 2: Verify against the authority, not against memory**

```bash
cd "$MAINT" && grep -n "cherry-pick" CLAUDE.md && sed -n '24,30p' /Users/tuckerlemos/Documents/GitHub/reddoor-starter-blux/CLAUDE.md
```

Expected: the new line prints, and the blux repo's own trap prints `git merge starter/main` applies those 178 deletions as clean, CONFLICT-FREE` — the two now say the same thing.

- [ ] **Step 3: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write CLAUDE.md && git add -A && git commit -m "docs: the blux track is cherry-pick only — the forward-merge rule was a landmine

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Changeset, `pnpm verify`, adversarial review, PR

**Files:** Create: `$MAINT/.changeset/prismic-ci-positional-and-launch-guard.md` · Modify: `$MAINT/docs/workJournal.md`

- [ ] **Step 1: Write the changeset**

```bash
cd "$MAINT" && cat > .changeset/prismic-ci-positional-and-launch-guard.md <<'EOF'
---
"@reddoorla/maintenance": minor
---

`prismic-ci` now resolves a positional checkout, and `launch` refuses to draft while a site's matching twin is live.

`reddoor-maint prismic-ci <path>` always failed with "no Git repo on this site": the positional inventory provider builds `{ path, name }` and nothing else, and the recipe read `site.gitRepo` directly. A site being bootstrapped is exactly the case with no Airtable row — `--fleet airtable` filters `building` and `launching` out — so the positional path was the only one `/new-site` could use, and it did not work. `resolveOwnerRepo` (extracted from `self-updating`, now shared in `src/util/git.ts`) derives `owner/repo` from `origin` when no explicit identity is set, and still throws rather than passing a malformed one to `gh` — malformed meaning a value that is not two clean `owner/repo` segments, or one carrying a `..` traversal (an origin of `https://github.com/ok/../evil` parses to `../evil` and is rejected). A missing origin is not malformed: that returns `null` and the recipe reports "no Git repo".

`launch` gains two disposition steps. `matching-disposition` runs first, on the filesystem: a checkout carrying `src/routes/dev/match` without the `if (!dev)` guard stops the chain before any GitHub write. `dev-guard` runs against the DEPLOYED url and requires both halves of a positive result — `/dev/match/home` must answer 404 **with this site's own error page**, and `/health` must answer 200 as the liveness control. A dead host, a wrong url and a parked domain fail the second, so none of them can pass the first.

Also corrected: Renovate bumps an installed reusable-workflow pin only sometimes. It carried v1.2.0 → v1.3.0 across 17 repos in July, then proposed neither v1.4.0 nor v1.4.1, and v1.4.1 was hand-swept across 21 repos. The claim was written down **five times across four files** (twice in `prismic-ci/template.ts`, once each in `sync-configs/templates.ts`, `self-updating/index.ts` and the delivery runbook); all five are fixed. Propagation is re-resolve → release → re-run `prismic-ci` fleet-wide plus positionally per pre-launch site.
EOF
pnpm exec prettier --write .changeset/prismic-ci-positional-and-launch-guard.md
```

- [ ] **Step 2: The full gate**

```bash
cd "$MAINT" && pnpm verify 2>&1 | tail -n 20
```

Expected: typecheck, eslint + prettier, build, coverage and `test:dist` all green, with strictly more tests than Task 0 Step 3's M (at least +7: 5 launch, 2 prismic-ci; plus 5 in `git-owner-repo`).

- [ ] **Step 3: Adversarial review (required for a maintenance PR)**

Run `/code-review high` over the branch diff. Expect it to probe at least: whether `resolveOwnerRepo` can now reach `gh` with an identity `self-updating` would have rejected (it cannot — same two throws), whether the `dev-guard` regex can match a 404 rendered by a _different_ site behind the same url (it can; the control is what makes that a mis-configured Airtable row rather than a false green, and the message says so), and whether `matchingDisposition` passes a site whose guard is present but unreachable at runtime (it does — this is a source check, named as one).

- [ ] **Step 4: Journal, push, PR**

Append the maintenance entry from Task 13 to `docs/workJournal.md`, then:

```bash
cd "$MAINT" && pnpm exec prettier --write docs/workJournal.md && git add -A
git commit -m "docs: journal — positional prismic-ci, the launch dev-guard, and four corrected claims

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/prismic-ci-positional-and-launch-guard
gh pr create -R reddoorla/reddoor-maintenance --base main \
  --title "prismic-ci resolves a positional checkout; launch refuses a live matching twin" \
  --body-file - <<'EOF'
Spec C5 of `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`.

- `resolveOwnerRepo` shared in `src/util/git.ts`; `self-updating`'s private copy deleted; `prismic-ci` uses it, so `reddoor-maint prismic-ci <path>` works on a site that has no Airtable row yet.
- `launch` gains `matching-disposition` (filesystem, before any GitHub write) and `dev-guard` (deployed url: `/dev/match/home` → 404 with the site's own error page, `/health` → 200 as the liveness control).
- Renovate does not bump an installed pin — the claim was written five times across four files (twice in `prismic-ci/template.ts`, once each in `sync-configs/templates.ts`, `self-updating/index.ts` and the runbook, which now carries an "After every `reddoorla/.github` tag" section). One mention at `template.ts:38` is true and deliberately untouched.
- `CLAUDE.md`: the blux track is cherry-pick only.

**Two things reviewers should know, because neither is visible in the diff.**

1. **`matchingDisposition` is a contract with the `match-harness` recipe (plan BC), and nothing satisfies it yet.** It accepts a `+page.server.ts` that imports `$app/environment` and contains `if (!dev)`. The predicate is exported for BC's test to IMPORT — BC's recipe test must assert `(await matchingDisposition(installedDir)).ok` against the file its own template writes, never restate the regex here, or the two drift and the passing branch is proved only by this PR's fixture.
2. **`reddoor-maint launch beachfront-dentistry` now stops at step 0, and that is the correct verdict, not a regression.** Beachfront's `src/routes/dev/match/[uid]/+page.server.ts` has `prerender = false` and no `$app/environment` import — it fetches Prismic and would ship the twin into production. The fix is C3 re-installing the guarded route there, not loosening the predicate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Merge when CI is green and the review is clean (GREEN tier)**

```bash
gh pr view <n> -R reddoorla/reddoor-maintenance --json files --jq '.files[].path'
gh pr merge <n> -R reddoorla/reddoor-maintenance --squash --delete-branch
```

Check the file list first — a fleet branch stacked on another open PR drags it onto main.

---

### Task 7: `/new-site` — steps 6b, 6c, 6d, 6e, and the verification items

**Files:** Modify: `$SKILLS/skills/new-site/SKILL.md:90` (insert after), `:103-117` (verification), `:122-126` (hand-off)

- [ ] **Step 1: Branch, and settle the path convention this file uses**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills && git checkout main && git pull && git checkout -b feat/skill-edits-for-recipe
grep -n 'REDDOOR_REPOS\|Documents/GitHub' skills/new-site/SKILL.md
```

Expected: either `$REDDOOR_REPOS/<slug>` (plan A did the rewrite) or `~/Documents/GitHub/<slug>` (it did not). **Use whichever form the file already uses** in every line you add. The steps below are written with `$REDDOOR_REPOS`. Never write a literal `/Users/...` path — plan A's `test/skills.test.mjs` fails on one.

- [ ] **Step 2: Insert the three sub-steps after line 90 (the end of step 6)**

**They must be indented sub-bullets of step 6, NOT top-level `6b.` / `6c.` / `6d.` lines.** `6b.` is not a valid CommonMark ordered-list marker (a marker is digits followed by `.` or `)`), so a flush-left `6b.` paragraph terminates the surrounding list, and the `7.` and `8.` that follow start a fresh one. This file's list runs 1–8 and its own prose cross-references those numbers ("re-run after step 6", "AFTER step 8's push and step 4's protection"), so breaking the list breaks the references. Step 6's continuation indent is **3 spaces** — match it exactly, and the whole block nests inside item 6 with the numbering untouched.

````markdown
- **6b — PROMPT the operator, Prismic write token 🔴.** Dashboard → the
  repository → Settings → API & Security → create a **Custom Types API write
  token**. Not a content API token, not the CLI's `PRISMIC_TOKEN` (runbook §3
  in reddoor-maintenance `docs/runbooks/prismic-model-delivery.md`). Then set
  it in two places, **pasting at the prompt — never on the command line**:
  - `gh secret set PRISMIC_WRITE_TOKEN --repo reddoorla/<slug>` — the site's
    own delivery secret. Absent, the workflow reds the repo on its FIRST
    model PR: the reusable workflow's dry job runs on every `pull_request`
    with no secret condition, and the CLI exits 1 with "no write token".
  - `gh secret set PRISMIC_TOKEN_<NAME> --repo reddoorla/reddoor-maintenance`
    — the central nightly drift sweep. `<NAME>` is the **Prismic repository
    name** upper-snaked (`vida-legacy` → `VIDA_LEGACY`, `29-navy` →
    `29_NAVY`); the authority is
    `reddoor-maint prismic-models <site-path> --tokens`, not a guess.

  Then open a PR on reddoor-maintenance adding
  `PRISMIC_TOKEN_<NAME>: ${{ secrets.PRISMIC_TOKEN_<NAME> }}` to the env
  block of `.github/workflows/fleet-prismic-drift.yml` (the alphabetical list
  at lines 107-121). The sweep still skips the site while its Websites row is
  `building`/`launching`, so until launch the per-repo workflow is its only
  guard — which is why 6c is not optional.

  ⚠️ ORDER: 6b and 6c run AFTER step 8's push and step 4's protection. 6c
  opens a PR, which the ruleset accepts; it cannot run against an empty repo.

- **6c — Install model delivery.** From the reddoor-maintenance checkout (it
  holds the CLI and the credentials; site repos lack the fleet's deps):

  ```bash
  cd $REDDOOR_REPOS/reddoor-maintenance && node dist/cli/bin.js prismic-ci $REDDOOR_REPOS/<slug>
  ```

  Expected: `[<slug>] applied: opened PR <url>`. Merge that PR (its title is
  "Deliver Prismic model changes from merged PRs"). Needs
  `@reddoorla/maintenance` at or past the 2026-09-08 release that made a
  positional run resolve `owner/repo` from `origin`; on an older checkout
  write a one-line JSON inventory instead
  (`[{"name":"<slug>","path":"…/<slug>","gitRepo":"reddoorla/<slug>"}]`) and
  pass `--fleet <that file> --workdir $REDDOOR_REPOS`. Never
  `--fleet airtable` for a bootstrapping site — pre-launch rows are filtered
  out of that inventory.

- **6d — Read the result. Three of the four outcomes are not "done":**
  - `noop: not a Prismic site (no repositoryName) — skipped` → the
    `your-prismic-repo-name` sentinel is still in `slicemachine.config.json`.
    Step 6 is not done and **nothing was delivered**. Re-run after step 6.
  - `failed: … has no PRISMIC_WRITE_TOKEN Actions secret` → do 6b.
  - `failed: … lockfile pins @reddoorla/maintenance X, which has no
prismic-models command` → bump the dep and commit the lockfile.
  - `noop: delivery workflow already current on main` → done; the step is
    idempotent and content-compares, so a stale pin is corrected by a new PR.
````

After inserting, confirm the list did not break: `grep -n '^[0-9]\+\. ' skills/new-site/SKILL.md` must still show exactly eight top-level markers, `1.` through `8.`, in order.

- [ ] **Step 3: Add three verification items after line 117**

```markdown
- Model delivery exists AND has run:
  - `gh workflow list -R reddoorla/<slug>` shows `prismic-models active`.
  - `gh secret list -R reddoorla/<slug>` shows `PRISMIC_WRITE_TOKEN`.
  - the build's FIRST model PR (`/figma-slices` lands `model.json` files)
    carries a `### Prismic model delta` comment, and
    `gh run list -R reddoorla/<slug> --workflow prismic-models.yml` shows a run
    whose conclusion is success. **A workflow with zero runs proves nothing** —
    Beachfront's sat installed and unexercised for three weeks.
```

- [ ] **Step 4: Add one line to the hand-off (after line 126)**

```markdown
From here, **model changes ride PRs**. Never push models with a Custom Types API
script or Slice Machine's Push button (runbook §1) — the workflow on merge is
the only writer, and a hand push makes the nightly drift verdict a lie.
```

- [ ] **Step 5: Verify the edit is live through the symlink**

```bash
readlink ~/.claude/skills/new-site
test "$(grep -c PRISMIC_WRITE_TOKEN ~/.claude/skills/new-site/SKILL.md)" -ge 3 && echo "write-token-lines ok"
grep -n '^[0-9]\+\. ' skills/new-site/SKILL.md | wc -l
grep -n '/Users/' skills/new-site/SKILL.md ; echo "users-grep-exit=$?"
```

Expected: the symlink resolves into this repo; `write-token-lines ok` — `grep -c` counts matching LINES and the inserted text puts `PRISMIC_WRITE_TOKEN` on **three** of them (6b's `gh secret set`, 6d's `failed: …` outcome, and the new verification item), so the threshold is `-ge 3`, not `2`; the top-level marker count is still `8` (Step 2's list-integrity check); the last grep prints nothing with `users-grep-exit=1` (before it, `grep -c` is not part of the `&&` chain, so its exit code cannot mask this one).

- [ ] **Step 6: Commit**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills && git add skills/new-site/SKILL.md
git commit -m "new-site: mint the write token and install prismic-ci at bootstrap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `matching-a-page` — the recipe owns the workspace; the skill owns the protocol

**Files:** Modify: `$SKILLS/skills/matching-a-page/SKILL.md:96-117`, `:123-126`, `:163-164`, `:166-170` + `:173`, insert after `:469`

- [ ] **Step 1: Check what plan A already fixed**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills && grep -n 'file:///Users\|@playwright/test' skills/matching-a-page/SKILL.md
```

If line 173 still reads `import { chromium } from "file:///Users/…/node_modules/playwright/index.mjs";`, Step 4 replaces it. If it already reads `@playwright/test`, Step 4 is a no-op — record that and move on.

- [ ] **Step 2: Replace the Workspace section (lines 98-109)**

Before:

````markdown
Everything this workflow produces lives in **`matching/` at the project
root**, git-ignored (add the ignore in Phase 0). Not the scratchpad — the
spec and ledger must survive the session.

```
matching/
  spec/        # downloaded reference: HTML, CSS, scripts, assets
  SPEC.md      # Phase 1 output: section census + per-section spec
  LEDGER.md    # created in Phase 0, appended forever
  states/      # paired interaction-state screenshots (Phase 5/6)
  out*/        # page-diff runs (one dir per run: out-r1, out-r2…)
```
````

After:

````markdown
Everything this workflow produces lives in **`matching/` at the project root**,
installed by `reddoor-maint match-harness <site-path> --ref <url>` in Phase 0 —
never hand-created. **Scripts and records are TRACKED; captures are IGNORED.**
The recipe writes the `.gitignore` block and the `CLAUDE.md` rules; do not edit
either by hand. (The earlier rule here — git-ignore all of `matching/` — was
overturned on Beachfront: `CLAUDE.md` told every future session to run
`matching/gate.sh`, and on a fresh clone those files did not exist, while
`LEDGER.md`, the only audit trail, lived in exactly one unbacked place.)

```
matching/
  harness.json     # TRACKED, site-edited: ref, cand, matrix, thresholds,
                   #   refMark/candMark, selfHosts, pages{key:{uid,ref,cand,anchors[],spec,group}}
  harness.mjs      # TRACKED, recipe-owned read layer: REF/CAND/MATRIX/PAGES/TOTALS,
                   #   plus --env, --table and --check-ref for the two bash gates
  gate.sh          # TRACKED: page-diff per page × matrix → out-<tag>-<page>/
  census.sh        # TRACKED: style-census per page × matrix
  next.mjs         # TRACKED: ranked backlog from the latest clean run per page
  strikes.mjs      # TRACKED: 3-strike stall detector
  build-spec.mjs · census-count.mjs · floors.mjs · census-deviations.mjs   # TRACKED
  spec-sections/   # TRACKED: _chrome.md, _header.md and the per-page sections
  LEDGER.md        # TRACKED: created by the recipe, appended forever
  SPEC.md          # TRACKED: Phase 1 output
  spec/ out*/ *.log *.json *.png   # IGNORED (except harness.json): reference capture and gate runs
```
````

- [ ] **Step 3: Phase 0 — insert two sub-steps under step 1, and replace step 8**

Same list-marker trap as Task 7: `1b.` is not a CommonMark ordered-list marker, and Phase 0's list runs **1–8** with prose elsewhere in the file referencing those numbers. Insert them as **indented sub-bullets of step 1** (its continuation indent is 3 spaces) after line 126, so the numbering survives untouched.

````markdown
- **1b — Install the harness.** Do not create these files by hand:

  ```bash
  reddoor-maint match-harness <site-path> --ref <reference origin> \
    [--cand http://localhost:5173] [--matrix 1440,390]
  ```

  It installs `matching/` (the Workspace tree), the `.gitignore` block, the
  dev-guarded `/dev/match/[uid]` route, the `src/lib/site-pages.js` scaffold
  and its fixture-vs-model test, appends the round rules to the site's
  `CLAUDE.md`, and commits on `maint/match-harness-<ts>`. It is
  install-if-absent: re-running never overwrites a file you have edited
  (`harness.json`, `floors.mjs`, `census-deviations.mjs`, `spec-sections/*`,
  `LEDGER.md`, `site-pages.js`), and safe-replaces a recipe-owned script only
  when it is byte-identical to the previous template. Then fill `pages` in
  `harness.json`: one entry per page you will gate, one anchor per census
  section.

- **1c — Run the reference preflight before believing any number.**
  `node matching/harness.mjs --check-ref` — it fails closed (exit 2) unless
  `REF/` answers 200 with no redirect, the body carries `refMark` and does
  NOT carry `candMark`, and the effective host is neither in `selfHosts` nor
  equal to the candidate's. This exists because Beachfront's reference DIED:
  `beachfront-dentistry.webflow.io` now 404s on every path and the `www` apex
  301s to our own Netlify build, so three of that project's tools had been
  comparing the candidate with itself. **Capture the reference with its
  assets into `matching/spec/` in this phase** (step 5) — the client's site
  does not outlive the cutover.
````

After inserting, confirm Phase 0's list is intact: `awk '/^### Phase 0/,/^### Phase 1/' skills/matching-a-page/SKILL.md | grep -c '^[0-9]\+\. '` must still be `8`.

Replace lines 163-164 (step 8):

Before:

```markdown
8. Create `matching/LEDGER.md` (format above) and the `matching/` gitignore
   entry.
```

After:

```markdown
8. Confirm the gate refuses a page with no `SPEC.md` section yet:
   `bash matching/gate.sh smoke home` must exit non-zero saying the page has no
   spec section. That refusal IS the Phase 1 gate working — a harness that runs
   before a spec exists measures nothing and reports a number for it.
```

- [ ] **Step 4: The probe block (lines 166-170, and the import on line 173)**

Replace the parenthetical and the import so the probe runs from the SITE, which already ships playwright (`reddoor-starter/package.json:30` `"@playwright/test": "^1.60.0"`, Beachfront likewise).

**The parenthetical does not end where it looks like it ends.** The sentence runs to line 170, and the `try/finally` rule shares its lines. Read `sed -n '166,173p' skills/matching-a-page/SKILL.md` before touching it. Replacing 166-169 strands line 170 as a dangling fragment; replacing 166-170 with a shorter block silently DELETES the leaked-chromium rule — so the After block below carries that sentence forward verbatim.

Before (lines 166-170, quoted in full):

```markdown
Probe pattern (write probes to `matching/` or the scratchpad; run with the
sandbox disabled; import playwright from this skill's own node_modules by
absolute `file://` URL — adjust the home path if this skill is ever copied
elsewhere). ALWAYS `try/finally` the close — a thrown `evaluate` otherwise
leaks a headless chromium, and enough of those starve test runners:
```

And line 173:

```js
import { chromium } from "file:///Users/tuckerlemos/.claude/skills/matching-a-page/node_modules/playwright/index.mjs";
```

After (replaces all five lines 166-170):

```markdown
Probe pattern (write probes to `matching/`; **run them from the site root** —
the site's own `@playwright/test` provides chromium, so no path into this skill
is needed and none can go stale; run with the sandbox disabled). ALWAYS
`try/finally` the close — a thrown `evaluate` otherwise leaks a headless
chromium, and enough of those starve test runners:
```

And line 173 becomes:

```js
import { chromium } from "@playwright/test";
```

Verify the seam: `sed -n '166,173p' skills/matching-a-page/SKILL.md` must end with `leaks a headless chromium, and enough of those starve test runners:`, a blank line, an opening ` ```js ` fence and the new import — no orphaned `elsewhere).` fragment, and the `try/finally` sentence still present.

- [ ] **Step 5: Add `## Launch disposition` after line 469 (end of `## Whole sites`)**

```markdown
## Launch disposition

Matching does not end by deleting anything. At launch the harness stays — the
next round needs it — and three things change instead.

1. **Prove the twin is inert in production.** The `/dev/match/[uid]` route the
   recipe installs is guarded by `if (!dev) error(404, …)`, and the launch
   recipe checks it on the DEPLOYED build: `/dev/match/home` must answer 404
   **with the site's own error page** while `/health` answers 200.
   `launch` stops on anything else, and its `matching-disposition` pre-flight
   fails a checkout that carries `src/routes/dev/match` without the guard.
2. **Flip the candidate paths from twins to real routes.** In `harness.json`,
   each page's `cand` moves from `/dev/match/<uid>` to the route that ships
   (`/`, `/our-team`, …), and any Playwright spec pinned to a twin path follows.
   Before flipping, run the real-vs-twin diff once with the dev server up and
   paste the result into `LEDGER.md` as the hand-over entry: the twin renders
   the assembly directly from `site-pages.js`, the real route renders what
   Prismic returned, and any delta between them is a publishing defect that the
   twin was hiding.
3. **Retire the hand-push scripts.** Model changes ride PRs through the
   `prismic-models` workflow. A `push-custom-types.mjs` left in `scripts/` is a
   second writer, and the nightly drift verdict cannot see it.

Nothing is deleted at launch. `LEDGER.md`, `SPEC.md` and `spec-sections/` are
the site's record of what was matched and what was accepted as a floor; the
`matching/` workspace is the only place either exists.
```

- [ ] **Step 6: Verify through the symlink**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills
grep -n '/Users/' skills/matching-a-page/SKILL.md ; echo "users-grep-exit=$?"
grep -c "match-harness\|Launch disposition\|@playwright/test" ~/.claude/skills/matching-a-page/SKILL.md
node --test test/
```

Expected: no `/Users/` hit (`users-grep-exit=1`); the count is at least 4 and it is read through the symlink; plan A's `test/skills.test.mjs` passes (it is the machine-path guard and the symlink-install check).

- [ ] **Step 7: Commit**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills && git add skills/matching-a-page/SKILL.md
git commit -m "matching-a-page: the recipe installs the workspace; add the launch disposition

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Skills repo — journal, PR, merge

**Files:** Modify: `$SKILLS/docs/workJournal.md`

- [ ] **Step 1: Append the skills-repo entry from Task 13, then push and open the PR**

```bash
cd /Users/tuckerlemos/Documents/GitHub/claude-skills
git add docs/workJournal.md && git commit -m "docs: journal — the two skills now point at the recipes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/skill-edits-for-recipe
gh pr create -R reddoorla/claude-skills --base main \
  --title "new-site installs model delivery; matching-a-page defers the workspace to match-harness" \
  --body-file - <<'EOF'
Spec C5 of reddoor-maintenance `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`.

- `new-site`: steps 6b (mint `PRISMIC_WRITE_TOKEN` + the central `PRISMIC_TOKEN_<NAME>`, RED tier), 6c (`prismic-ci` positionally), 6d (what each of the four outcomes means — three of them are not "done"), and three positive-evidence verification items. A workflow with zero runs proves nothing.
- `matching-a-page`: the Workspace and Phase 0 now invoke `reddoor-maint match-harness`; scripts and records are tracked, captures ignored; a fail-closed reference preflight (Beachfront's reference died mid-project and three tools were comparing the candidate with itself); probes import `@playwright/test` from the site instead of an absolute home path; a new "Launch disposition" section.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 2: Merge when green (GREEN tier), then re-verify the live skill**

```bash
gh pr merge <n> -R reddoorla/claude-skills --squash --delete-branch
cd /Users/tuckerlemos/Documents/GitHub/claude-skills && git checkout main && git pull
grep -c "match-harness" ~/.claude/skills/matching-a-page/SKILL.md
```

Expected: a non-zero count read through the symlink — the merged text is what the next session loads.

---

### Task 10: Starter records — the journal correction and one orientation row

**Files:** Modify: `$STARTER/docs/workJournal.md` · Modify: `$STARTER/CLAUDE.md:180`

- [ ] **Step 1: Worktree and branch**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter && git fetch origin
git worktree add .worktrees/webflow-records -b docs/webflow-pipeline-records origin/main
cd .worktrees/webflow-records && pnpm install --frozen-lockfile
```

- [ ] **Step 2: The orientation row**

Insert after `CLAUDE.md:180` (`| What this session did, and why    | \`docs/workJournal.md\` |`), keeping the table's column padding:

```markdown
| Rebuilding from a live site | reddoor-maintenance `webflow` + `match-harness`, matching-a-page skill |
```

- [ ] **Step 3: The forward pointer under the 2026-09-05 backfill**

The backfill does not repeat the 08-31 spec's importer claim, but line 34 does repeat **forward-merge-only**, which today's entry corrects. Per CLAUDE.md's rule, add one line directly under the heading on line 14:

```markdown
> Superseded in part by 2026-09-08 — The Webflow pipeline has a home, and it is not this repo.
```

- [ ] **Step 4: Append the starter entry from Task 13, then verify and commit**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter/.worktrees/webflow-records
pnpm exec prettier --check CLAUDE.md docs/workJournal.md
grep -n "Rebuilding from a live site" CLAUDE.md && grep -c "Superseded in part by 2026-09-08" docs/workJournal.md
```

Expected: prettier clean; the orientation row prints at the end of the table; the pointer count is 1.

```bash
git add -A && git commit -m "docs: the Webflow rebuild pipeline lives next door, and the journal says why

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin docs/webflow-pipeline-records
gh pr create -R reddoorla/reddoor-starter --base main \
  --title "docs: record where the Webflow rebuild pipeline lives, and correct the 08-31 importer claim" \
  --body-file - <<'EOF'
Spec C6 of reddoor-maintenance `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`.

Docs only — no code, no dependency, nothing Webflow-specific enters this template (decision D2).

- `docs/workJournal.md`: a 2026-09-08 entry recording the pipeline decision and correcting the 2026-08-31 track-split spec's claim that the Webflow importer targets the native `page` type — it emits `person`, `news_article` and `collection_item`, none of which exist here.
- A forward pointer under the 2026-09-05 backfill, whose "forward-merge-only" line the new entry corrects.
- One orientation-table row: "Rebuilding from a live site".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Merge when CI is green (GREEN tier)**

```bash
gh pr merge <n> -R reddoorla/reddoor-starter --squash --delete-branch
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter && git worktree remove .worktrees/webflow-records
```

---

### Task 11: The C5 gate — one real run of the prismic-models workflow (Beachfront)

**Files:** Modify: `$BF/customtypes/settings/index.json:20` · Modify: `$BF/docs/workJournal.md`

This is the spec's acceptance gate for C5, and its merge is RED tier. Model delivery has never run in production anywhere; everything above assumes it works.

- [ ] **Step 1: Re-establish the preconditions rather than trusting them**

```bash
cd /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry && git checkout main && git pull && git status --short
gh secret list -R reddoorla/beachfront-dentistry | grep PRISMIC_WRITE_TOKEN
gh workflow list -R reddoorla/beachfront-dentistry | grep prismic-models
gh run list -R reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 5
gh api repos/reddoorla/beachfront-dentistry --jq .default_branch
```

Expected: clean tree on `main`; the secret listed; `prismic-models active`; **an empty run list** (that emptiness is the reason this task exists); `main`.

- [ ] **Step 2: Branch and make ONE semantic model change**

A pure key reorder does not diff — `sendModel` sends the file's JSON verbatim, so the change must be semantic. A label is enough.

```bash
git checkout -b chore/prismic-models-first-run
```

`customtypes/settings/index.json:20` — `"label": "Contact page hero",` → `"label": "Contact page hero (photo)",`

```bash
git diff --stat && git add customtypes/settings/index.json
git commit -m "chore(models): label the contact hero photo as a photo

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin chore/prismic-models-first-run
gh pr create -R reddoorla/beachfront-dentistry --base main \
  --title "chore(models): first real run of the prismic-models delivery workflow" \
  --body "One label change on \`customtypes/settings/index.json\`, chosen because it is semantic (a key reorder would not diff) and harmless. Its purpose is evidence: the delivery workflow has been installed since 2026-08-16 with the secret present and **zero runs ever**. This PR's dry job should comment a \`### Prismic model delta\` naming 1 model to update and 37 in sync; merging should produce a second run whose apply job pushes it. Spec C5 gate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Read the dry run — the comment is the artefact, not the merge button**

```bash
gh run list -R reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 3
gh pr view <n> -R reddoorla/beachfront-dentistry --comments | head -40
```

Expected: a `pull_request` run with conclusion `success`, and a comment beginning `### Prismic model delta` listing **1 model to update (settings)** and 37 in sync. Note the check is not ruleset-required (only `ci / ci` is), so a red dry job would not block the merge — read the run, never the merge button. Record the run URL.

- [ ] **Step 4: OPERATOR (RED tier) — merge the model PR**

Paste to the operator: _"reddoorla/beachfront-dentistry PR #`<n>` is the first real exercise of Prismic model delivery. Its dry job passed and commented the delta (1 model to update: `settings`; 37 in sync). Merging it writes that label to the live Prismic repository `48bb12d1` through the workflow's apply job. Squash-merge when you are ready."_

Then verify, without inferring from silence:

```bash
gh run list -R reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 3 --json event,conclusion,url
```

Expected: a second run, `event: push`, `conclusion: success`. Record both URLs.

- [ ] **Step 5: Confirm the write landed at the source, not in the log**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/wiring
node dist/cli/bin.js prismic-models /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry
```

Expected: `38 model(s) match Prismic — nothing to push` **after** pulling the merged label locally (`git checkout main && git pull` in `$BF` first). If it reports a delta, the apply job did not write and the gate has NOT passed — say so and stop.

- [ ] **Step 6: Journal it in Beachfront, with the URLs**

Append the Beachfront entry from Task 13 (it must carry both run URLs verbatim), then:

```bash
cd /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry && git checkout -b docs/prismic-models-first-run
git add docs/workJournal.md && git commit -m "docs: journal — model delivery ran for the first time, and it worked

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin docs/prismic-models-first-run && gh pr create -R reddoorla/beachfront-dentistry --base main --fill
```

Merge when CI is green (GREEN tier).

---

### Task 12: The five issues

**Files:** none in-repo — five `gh issue create` calls. Anything found and not fixed in the same PR gets an issue; a note in a PR body is not a tracker.

- [ ] **Step 1: reddoor-starter — the D10 product-fix port**

```bash
cat > "$TMPDIR/issue-product-fixes.md" <<'EOF'
Beachfront (`reddoorla/beachfront-dentistry`) landed a cluster of **generic** product-quality fixes between 2026-08-07 and 2026-09-02 that this template never received. The gaps are already propagating: `vida-legacy-foundation`, bootstrapped 2026-09-01, inherited the LandscapeModal lockout, the invisible Field border, the un-zeroed reduced-motion delays and five unconditional `fetchpriority="high"`, and independently re-fixed the CSP replay-hash defect on 2026-09-02.

Deferred here by decision D10 of reddoor-maintenance `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`: this is the largest per-site saving found (~18% of a Beachfront-sized build, vs ~10% for all the conversion layers together), but it is not a blocker for starting a site. **One PR per item.** Every one must also be cherry-picked onto `reddoorla/reddoor-starter-blux`, which has the identical gaps — cherry-pick, never forward-merge.

- [ ] **PR-1 — remove the LandscapeModal lockout (WCAG 1.3.4).** Beachfront `e8b5fe6`. An opaque, undismissable `aria-modal` overlay on any coarse-pointer device in landscape ≤1023px. Native: delete lines 9 and 62 of `src/routes/+layout.svelte`, decide the component's fate, drop it from `docs/STARTER.md:28`. Size S. Test: in `tests/smoke/pages.spec.ts`, `browser.newContext({ ...devices["iPhone 13 landscape"] })` on `/dev/a11y-fixtures` asserting `[role="dialog"][aria-modal="true"]` count 0 — confirm it goes red with the mount still in place.
- [ ] **PR-2 — one noindex list, enforced, plus sitemap STATIC_ROUTES.** Beachfront `29eb97d` + `d9fb0c0`. Native: copy `NOINDEX_PREFIXES` / `isNoindexPath` / `NOINDEX_ENFORCED` into `src/lib/seo.ts`; drive `robots.txt` from that list; pass `noindex=` to the layout `<Seo>`; add `STATIC_ROUTES = ["/contact"]` to `sitemap.xml` (contact is `prerender = false`, so page-doc enumeration cannot see it); add `src/routes/dev/a11y-fixtures/+page.ts`. Size S. Test: port the "noindex routes" describe; make `robots.txt/server.test.ts` assert against the imported list so the two cannot drift; verify on `pnpm build && pnpm preview`.
- [ ] **PR-3 — CSP allows Svelte's image event-replay stub.** Beachfront `cb22d52`. Every `PrismicImage` ships an inline `onload="this.__e=event"` the policy refuses — one `/api/csp-report` POST per pre-hydration image. Native: add `'unsafe-hashes'` + `SVELTE_EVENT_REPLAY_HASH` (exported by `@reddoorla/maintenance/configs/svelte`) to `script-src`; never `'unsafe-inline'`. Size S. Test: a smoke spec on `/dev/a11y-fixtures`, exercised on `pnpm build && pnpm preview` (the nonce header path differs from the prerendered `<meta>` path). Standardise against VLF's `script-src-attr` variant.
- [ ] **PR-4 — keyboard-focus floor, Field border/forced-colors, trapFocus container autofocus.** Beachfront `6347d4c`, `d68ef7d`, `cb22d52`. The starter has zero `:focus-visible` rules; `Field`'s resting border is ~1.2:1 on white (under the 3:1 non-text floor) and its `focus:outline-none` drops the forced-colors fallback. Size S. Test: the three `Field.test.ts` cases (incl. "gives the input and the textarea the SAME classes") plus a `trapFocus` container-`data-autofocus` case. Update `docs/accessibility.md:40`, which currently claims visible focus rings exist.
- [ ] **PR-5 — reduced motion zeroes delays too, and is read live.** Beachfront `df53dee`. The reset zeroes durations but not delays (staggered content waits, then pops), and `animateIn` samples `matchMedia` once at mount. Native: add the delay lines to `app.css`; return an `INSTANT` config instead of `{ ...params, duration: 0 }` (which still commits the t=0 `css` frame); subscribe to a `reducedMotion` store. Size M. Test: port the 8 store cases and the mid-session-switch cases; new motion specs must `page.emulateMedia({ reducedMotion: "no-preference" })` — the shared harness forces `reduce` on every test.
- [ ] **PR-6 — scroll-reveal hidden state ships in the markup.** Beachfront `5d76b70`, `721d11f`, `f3d302d`, `cb22d52`. Today content paints then vanishes at hydration, with no `noscript` escape, no fail-safe, an unguarded `IntersectionObserver`, and an inline `transition` that is never released (silently killing hover transitions on revealed elements). Size L — split (a) CSS + (b) `noscript` + (c) action from (d) call sites. Test: the marker suite, a release test, and a `javaScriptEnabled: false` spec asserting every `[data-reveal]` computes opacity 1.
- [ ] **PR-7 — Modal centred, scroll-locked, opens on `[autofocus]`, 44px close.** Beachfront `7d3f382`. Tailwind preflight zeroes `dialog` margin, so the starter's modal is pinned top-left; it does not scroll-lock, opens focus on a 20px ✕, and has no `ariaLabel`. Size M. Depends on PR-4 for Field `autofocus`. Test: extend `Modal.test.ts` with the ariaLabel/Escape, `[autofocus]`-wins, and lock/release cases plus the `afterEach` body-style reset.
- [ ] **PR-8 — TransitionOverlay is a 0.5s pointer-transparent wash, not 2s of click-eating black.** Beachfront `4256682`. Mounted by default in `+layout`, covering every client navigation, timer never cleared, not `aria-hidden`, ignores reduced motion. Native: adopt 140/140/320ms with `MAX_COVER_MS = 3000`, gated by the existing `shouldIntercept`. Size M. Test: a component test modelled on `PreNavTransition.test.ts` (popstate/willUnload/reduced-motion skips, `pointer-events-none`, second-navigation timer clear, 3000ms failsafe under fake timers).
- [ ] **PR-9 — Nav announces state and acknowledges a press on touch.** Beachfront `8247251` minus the coloured pill. No `aria-expanded`/`aria-controls` on trigger/close/logo, no press feedback on any input path (CSS `:active` does not fire for touch — measured), no focus ring. Size M. Depends on PR-4's trapFocus change for `data-autofocus` on the dialog. Test: the aria pair across the trigger/close swap in both chromes, and `data-pressed` set on pointerdown / cleared on pointerup, pointercancel, pointerleave and blur.
- [ ] **PR-10 — HeroBackgroundImage de-prioritises non-LCP instances.** Beachfront `fdc6ec7`. `fetchpriority="high"` is unconditional under `preload={false}`, and the component's own test asserts the bug. Native: `fetchpriority={preload ? "high" : "auto"}` + `loading={preload ? "eager" : "lazy"}`. Size S. Test: replace the bug-pinning assertion with both directions. Also file a VLF issue (five unconditional highs).
- [ ] **PR-11 — TurnstileWidget reserves its 65px box.** Beachfront `d7e4823`. `min-h-[65px]` on the mount point so the form does not jump when `api.js` resolves. Size S. Test: assert the class before the iframe arrives.
- [ ] **PR-12 — the contact submit stays readable while sending.** Beachfront `4c4d0a1` + `01fe02f`. Drop `disabled:opacity-60`, add `aria-busy`, a `disabled:cursor-wait` sending state, and move focus to the confirmation heading on success. Size S. Test: a new `src/routes/contact/page.test.ts` (no contact-page test exists today).
- [ ] **PR-13 (decision) — ship `prismic-models.yml` with the template, or keep it a `/new-site` step?** Beachfront `9005ac7`. As of 2026-09-08 it is a `/new-site` step (this plan) because it needs a per-site secret. Revisit only if the template can carry it inertly.
- [ ] **PR-14 (decision) — an Analytics component** (gtag in `onMount`, production hostnames only). Beachfront `54f8618`. Needs a `PUBLIC_GA_MEASUREMENT_ID` decision and CSP hosts. Size M.

**Not port targets**, so nobody re-derives them: `floatAlong` (deleted in `cb22d52`, replaced by CSS sticky); the Playwright `reducedMotion` config (fixed upstream in `@reddoorla/maintenance` `src/configs/playwright-a11y.ts`, which this repo already consumes); srcset caps/`sizes` (#109); the real-page axe audit (#115); copyright year; aria-level headings; Beachfront's brand colourway commits.

**One caution for whoever starts.** The placeholder starter's `/` 404s, so only `/dev/a11y-fixtures` and `/dev/animate-in` render — every no-JS, CSP, reveal and reduced-motion spec must target those, and the fixtures page may need a `data-reveal` element and a `PrismicImage`-bearing slice first.
EOF
gh issue create -R reddoorla/reddoor-starter \
  --title "Port Beachfront's generic product-quality fixes to the native starter" \
  --body-file "$TMPDIR/issue-product-fixes.md"
```

- [ ] **Step 2: reddoor-maintenance — captured-reference mode**

Every issue below uses a quoted heredoc (`<<'EOF'`), so backticks and `${{ }}` in the body stay literal — a `--body "..."` string would need three levels of escaping and silently mangles one of them.

```bash
cat > "$TMPDIR/issue-captured-ref.md" <<'EOF'
Found 2026-09-08 while auditing Beachfront's harness. `beachfront-dentistry.webflow.io` now 404s on every path and `www.beachfrontdentistry.com` 301s to our own Netlify build, so a paused matching campaign **cannot be resumed against its own reference**, and three of that project's tools had been comparing the candidate with itself while reporting numbers for it.

v1 of `match-harness` closes the silent half: `node matching/harness.mjs --check-ref` fails closed (200, no redirect, `refMark` present, `candMark` absent, host not in `selfHosts` and not the candidate's), and Phase 0 of the matching-a-page skill captures the reference **with its assets** into `matching/spec/`. Beachfront's proof today is that the preflight REFUSES both of its hosts.

What is missing is a mode that gates against that capture. Sketch: a `--captured` flag (or `harness.json.refMode: "captured"`) that serves `matching/spec/` from a local static server, rewrites the reference origin to it, and stamps `refMode` into every `report.json` `meta` so a pasted run says which reference it measured.

Open questions worth settling in the issue rather than in the code: asset-URL rewriting for CSS `url()` and `srcset`; whether a webfont served by a third-party kit can be captured at all; and whether a captured run may ever satisfy the same threshold as a live one, or is a lower tier by construction.

Spec D11, `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`.
EOF
gh issue create -R reddoorla/reddoor-maintenance \
  --title "match-harness: captured-reference mode (serve matching/spec/ locally) — live references die at cutover" \
  --body-file "$TMPDIR/issue-captured-ref.md"
```

- [ ] **Step 3: reddoor-maintenance — seed patch mode**

```bash
cat > "$TMPDIR/issue-seed-patch.md" <<'EOF'
`prismic-seed` writes whole documents. Two shapes it cannot express, both of which Beachfront's retired scripts did:

**Patch (`carryOver`)** — read the master document, merge a subset of fields, write it back (`seed-entity-content.mjs`'s read-master-then-merge). The Migration API's `PUT` **replaces** and never merges, so the merge has to happen on our side, against master.

**Singletons (`--doc-id`)** — a staged document cannot be read back: `GET https://migration.prismic.io/documents` is refused at the gateway with write-token credentials, and the migration release is not a ref (measured immediately after a successful POST and on two retries, `/api/v2` listed exactly one ref, `master`). For a type with a `uid` that is survivable — a re-POST collides on the uid and the runner falls back to `PUT` by master id. A singleton has no uid to collide on, so a blind re-run creates a SECOND document and `getSingle` starts returning a coin flip. Singleton seeding is therefore not built.

Both are named in the seed plan's own docs as deliberately out of scope. Until they exist, Beachfront's `seed-entity-content.mjs` and `seed-settings.mjs` are NOT superseded — its `seed-pages.mjs`, `push-slice-models.mjs` and `push-custom-types.mjs` are. Spec C4, `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`.
EOF
gh issue create -R reddoorla/reddoor-maintenance \
  --title "prismic-seed: entity patch mode (carryOver) and singleton --doc-id" \
  --body-file "$TMPDIR/issue-seed-patch.md"
```

- [ ] **Step 4: reddoor-maintenance — three drift tokens resolve empty**

```bash
cat > "$TMPDIR/issue-drift-tokens.md" <<'EOF'
In the nightly run 34209264417 (2026-09-08T09:18Z) three of the fifteen hand-maintained env lines in `.github/workflows/fleet-prismic-drift.yml:107-121` resolve to empty strings: `PRISMIC_TOKEN_THE_POINTE`, `PRISMIC_TOKEN_THE_TOWER_BURBANK` and `PRISMIC_TOKEN_REDDOOR_WIREFRAMER`. The matching Actions secrets do not exist in `reddoorla/reddoor-maintenance`.

Nothing alarms today because none of those three sites is in the current 13-site sweep — which is the actual problem. **An env line that resolves empty is indistinguishable from one that is correct** until the site enters the sweep, and then it presents as a per-site token failure rather than as a missing secret: the same absent-vs-unreadable collapse the runbook already documents twice elsewhere.

Two halves:

1. Decide per name — mint the secret (RED tier, operator) or delete the env line. `reddoor-wireframer` is a placeholder repository name (it is in `PLACEHOLDER_REPOSITORY_NAMES`), so that line is probably just wrong.
2. Make the class impossible: have the sweep FAIL, not warn, when an env line it was handed resolves empty — or derive the list from `prismic-models --tokens` instead of maintaining fifteen lines by hand.
EOF
gh issue create -R reddoorla/reddoor-maintenance \
  --title "fleet-prismic-drift: PRISMIC_TOKEN_THE_POINTE/THE_TOWER_BURBANK/REDDOOR_WIREFRAMER resolve empty" \
  --body-file "$TMPDIR/issue-drift-tokens.md"
```

- [ ] **Step 5: vida-legacy-foundation — model delivery**

```bash
cat > "$TMPDIR/issue-vlf-delivery.md" <<'EOF'
This site has **no model delivery at all**, and nothing currently checks its models.

Measured 2026-09-08: `gh secret list` is empty; `.github/workflows/` holds only `ci.yml` and `renovate.yml`; fourteen merged model PRs (#10 … #38) shipped with zero CI delivery; and models and the custom type were pushed **by hand** with the site's own `.env` token (journal, day 2). It is also outside the nightly fleet drift sweep, because that inventory filters `building`/`launching` rows — so until launch flips the status, the per-repo workflow would be its ONLY guard, and it does not have one.

Everything else already passes the recipe's gates: `repositoryName` is real (`vida-legacy`), the lockfile resolves `@reddoorla/maintenance` 0.90.1 (≥ 0.83.0), and the default branch is `main`.

- [ ] **OPERATOR (RED tier)** — mint a Custom Types API **write** token for the Prismic repository `vida-legacy`, then, pasting at the prompt: `gh secret set PRISMIC_WRITE_TOKEN --repo reddoorla/vida-legacy-foundation` and `gh secret set PRISMIC_TOKEN_VIDA_LEGACY --repo reddoorla/reddoor-maintenance`.
- [ ] Open a reddoor-maintenance PR adding a `PRISMIC_TOKEN_VIDA_LEGACY` line to the env block of `.github/workflows/fleet-prismic-drift.yml` (alphabetical, lines 107-121), in the same `secrets.` expression form as its neighbours.
- [ ] Run `reddoor-maint prismic-ci <this checkout>` from the maintenance checkout and merge the PR it opens.
- [ ] Reconcile the hand pushes: with the token exported, run `reddoor-maint prismic-models <this checkout>` (dry). If the `PersonGrid` model from PR #38 (merged 2026-09-03) appears in the delta, land it by **re-touching the model in a PR** so the new workflow pushes it — never by script.
- [ ] Evidence, not silence: `gh run list --workflow prismic-models.yml` must show a run with conclusion success before this is closed.

Separately, four generic starter defects this site inherited at bootstrap are tracked upstream in reddoorla/reddoor-starter ("Port Beachfront's generic product-quality fixes to the native starter"): the LandscapeModal lockout (`src/routes/+layout.svelte:9,212`), the ~1.2:1 Field border, un-zeroed reduced-motion delays, and five unconditional `fetchpriority="high"` in `HeroBackgroundImage.svelte`.
EOF
gh issue create -R reddoorla/vida-legacy-foundation \
  --title "Prismic model delivery: mint PRISMIC_WRITE_TOKEN, install prismic-models.yml, reconcile hand-pushed PersonGrid model" \
  --body-file "$TMPDIR/issue-vlf-delivery.md"
```

- [ ] **Step 6: Verify all five exist**

```bash
for r in reddoorla/reddoor-starter reddoorla/reddoor-maintenance reddoorla/vida-legacy-foundation; do
  gh issue list -R "$r" --limit 8 --json number,title --jq '.[] | "\(.number)\t\(.title)"'
done
```

Expected: the five titles above appear with numbers. Record them — the journal entries reference them.

---

### Task 13: Journal entries — the last act in each repo

Each entry is appended to that repo's `docs/workJournal.md` at the point named in its task (Task 6 Step 4, Task 9 Step 1, Task 10 Step 4, Task 11 Step 6). Prose, why over what, newest at the bottom.

- [ ] **Step 1: reddoor-maintenance**

```markdown
## 2026-09-08 — A recipe that could not run on a new site, and a launch that could not see the twin (`feat/prismic-ci-positional-and-launch-guard`)

`prismic-ci` has existed since August and has never once been run by `/new-site`.
One line explains it: the recipe read `site.gitRepo` directly, and the positional
inventory provider (`src/inventory/local.ts:11`) builds `{ path, name }` and
nothing else, so `reddoor-maint prismic-ci <path>` always answered `no Git repo
on this site`. Airtable is not an alternative for a site being bootstrapped —
`--fleet airtable` filters `building` and `launching` rows out of the inventory
entirely — so the positional path was the only one available, and it did not
work. `self-updating` had solved the same problem months earlier by deriving the
identity from `origin`; the fix was to stop having two answers. `resolveOwnerRepo`
now lives in `src/util/git.ts`, both recipes call it, and it still throws rather
than letting a malformed identity reach `gh`.

The cost is visible on Vida Legacy Foundation: fourteen merged model PRs, zero CI
delivery, models pushed by hand with the site's own `.env` token, and no nightly
verdict either, because pre-launch statuses are filtered from the drift sweep
too. That is now an issue on that repo rather than a paragraph here.

`launch` gained two disposition steps, and the shape of the second is the part
worth keeping. The matching harness installs a `/dev/match/[uid]` twin route and
nothing is deleted at launch, so the dev guard is the whole mechanism keeping it
off production. The obvious check — "does `/dev/match/home` 404?" — passes on a
dead host, a parked domain and a typo'd Airtable url. So the step requires two
artefacts only a working system produces: a 404 **carrying this site's own error
page** (`+error.svelte` renders `<h1>{page.status}</h1>`; a CDN 404 does not),
and a 200 from `/health` as a liveness control — not from a dev route, which
the dev-layout guard that fixes the underlying defect would delete, turning
every correctly-guarded site into a launch failure. The marker half was proved
load-bearing by deleting it and watching the "not this site's own error page"
test go red. A `matching-disposition` pre-flight runs first, on the
filesystem, so a checkout whose twin has no `if (!dev)` guard stops before
acquiring branch protection and an audit.

**A claim corrected five times in four files — and then corrected again.** The
prismic-ci template, the runbook, the sync-configs comment and `self-updating`
all said Renovate bumps an installed `uses:` pin, and `self-updating`'s version
even said "(proven)", which was an inference from ordinary action pins rather
than an observation of this ref. The first correction replaced that with
"Renovate has never opened a PR for one", which is ALSO false: espada#40 carried
v1.2.0 → v1.3.0 on 2026-07-26 and 17 repos moved on that tag. That second wrong
claim came from an author-filtered search — Renovate runs self-hosted here with
a PAT and authors as `tucksravin`, so the query returned a confident empty set
and the empty set was read as history. The true statement is narrower, and is
the only one worth pasting anywhere: Renovate bumps this ref sometimes, proposed
neither of the last two tags, and so propagation must be VERIFIED after every
release rather than assumed. Propagation is re-resolve → release → re-run
`prismic-ci` fleet-wide **plus one positional run per pre-launch site**, and the
runbook now says so under a heading someone looking for it will find.

The enumeration is the part worth keeping, because the first grep written for it
was wrong twice in opposite directions. The decisions named three homes; a
single-phrase `grep -rn` found a fourth (`self-updating`) — and MISSED a fifth,
because `prismic-ci/template.ts` says the same false thing a second time in
`isPinResolved`'s docblock, and missed the `sync-configs` instance too, because
that sentence wraps across a line break and a line-oriented grep cannot see a
phrase split over two lines. A sixth hit, `template.ts:38`, is true and was
deliberately left alone. So: enumerate with a pattern short enough to survive
wrapping, and check each hit's verdict rather than fixing everything that
matches.

Two smaller things, recorded because each cost a re-verification. The
`dev-guard`'s sibling, `matchingDisposition`, is a **contract with a recipe that
does not exist yet** — nothing on disk satisfies its `if (!dev)` +
`$app/environment` predicate, so the green branch is proved by this PR's own
fixture until `match-harness` lands and its test imports the predicate rather
than restating it. And `launch` on Beachfront now stops at step 0, correctly:
that site's `/dev/match/[uid]` route fetches Prismic with no dev guard at all and
would ship the twin.

`CLAUDE.md`'s blux line went the same way: forward-merge was documented here as
the rule, and it is a landmine — `git merge starter/main` applies native-ize's
178 deletions as clean, conflict-free removals with only `README.md` conflicting,
so nothing warns you. That repo's own CLAUDE.md was fixed on 2026-09-01; this one
had kept the old answer.
```

- [ ] **Step 2: claude-skills**

```markdown
## 2026-09-08 — The two skills stop describing a workspace they no longer own (`feat/skill-edits-for-recipe`)

`matching-a-page` used to tell each session to hand-create `matching/` and
git-ignore all of it. Both halves were wrong by the time Beachfront finished with
them. The ignore rule was overturned there because `CLAUDE.md` told every future
session to run `matching/gate.sh` and on a fresh clone that file did not exist,
while `LEDGER.md` — the only audit trail of every accepted floor — lived in
exactly one unbacked place. Hand-creation meant the harness existed once, with
defects a copy would replicate. Phase 0 now invokes `reddoor-maint
match-harness`; the Workspace section says which files are tracked and which are
captures, and says not to edit the `.gitignore` block or the CLAUDE.md rules by
hand.

Two smaller changes carry more weight than their size. Probes now import
`@playwright/test` from the SITE instead of an absolute `file:///Users/...` path
into this skill's `node_modules` — a path that could not survive this repo
existing. And Phase 0 gained a fail-closed reference preflight, because
Beachfront's reference **died**: its webflow.io subdomain 404s on every path and
the apex now 301s to our own Netlify build, so three of its tools had been
comparing the candidate with itself and reporting numbers for it.

A new "Launch disposition" section closes the other end. Matching does not end by
deleting anything: the twin stays and is made inert by a dev guard the launch
recipe verifies against the deployed build; candidate paths flip from twins to
real routes with the real-vs-twin diff pasted into the ledger first (that delta
is a publishing defect the twin was hiding); and the hand-push model scripts are
retired, because a second writer makes the drift verdict a lie.

`new-site` gained the step it never had: it has never minted a Prismic write
token or run `prismic-ci`, so every site bootstrapped from it shipped with no
model delivery. Steps 6b–6d now do both and, more usefully, say what each of the
recipe's four outcomes means — three are not "done", and the quietest,
`noop: not a Prismic site`, is exactly what a run before the sentinel is replaced
looks like in a rollout summary. The verification list asks for a RUN, not a
workflow: Beachfront's sat installed with its secret present and zero runs for
three weeks.
```

- [ ] **Step 3: reddoor-starter**

```markdown
## 2026-09-08 — The Webflow rebuild pipeline has a home, and it is not this repo (`docs/webflow-pipeline-records`)

Docs only. Nothing Webflow-specific enters this template, and that is the
decision worth recording.

The 2026-08-31 track-split spec said the Webflow importer targets the native
`page` type. **That was a third true.** The importer also emits `person`,
`news_article` and `collection_item` documents, and Beachfront renders them
through a `CollectionList` slice and a collections loader wired into the page
route — all of which exist in the Blux track and in Beachfront, none of them
here. Believing the old sentence would have made "point the importer at a native
clone" sound like a small job.

So the pipeline lives next door: importer and seed runner in reddoor-maintenance,
round scripts and the `/dev/match` twin installed by a new `match-harness`
recipe, the phase protocol in the `matching-a-page` skill, the round rules
written into each site's own `CLAUDE.md`. This repo gets one orientation row. The
rule behind that placement is what the Blux split taught: the template ships no
hook whose default does work, and no field an editor cannot fill. A "three-line
seam" in `page-load` was considered and rejected — same species as the two
document types probed per page load that native-ize deleted in #106 (242 files
changed, 178 deleted).

Lists on a rebuilt site are content relationships by default (a repeatable group
restricted to a type; order = the group's order; no route change), and automatic
indexes are dedicated routes with their own server load, like `/contact`. Both
are site-side patterns, not template mechanisms.

One thing deliberately NOT done today, so it is not rediscovered as new: ~14
generic product-quality fixes Beachfront made between 2026-08-07 and 2026-09-02 —
noindex prefixes, reveal state in the markup, a focus-ring floor, live
reduced-motion, modal scroll-lock, nav tap response — are absent here and are
already propagating into sites bootstrapped from this template. It is the largest
per-site saving measured anywhere in this work (~18% of a Beachfront-sized
build), and it is now an issue on this repo with commits, files, native
counterpart and a test for each, one PR per item.
```

- [ ] **Step 4: beachfront-dentistry** (fill both run URLs before committing; do not merge this entry with them missing)

```markdown
## 2026-09-08 — Model delivery ran for the first time, and it worked (`chore/prismic-models-first-run`)

The `prismic-models` workflow was installed here on 2026-08-16 with its
`PRISMIC_WRITE_TOKEN` present, and had **zero runs** for three weeks. An
installed workflow with no runs is an assumption, not a mechanism, and every new
site was about to be wired to depend on it — so this PR existed only to turn one
into the other.

The change is one label on `customtypes/settings/index.json`: "Contact page hero"
→ "Contact page hero (photo)". A label deliberately, because `sendModel` sends
the model file's JSON verbatim and a pure key reorder does not diff — the
pipeline would report nothing to do and the run would prove nothing.

Evidence, in order: the `pull_request` run <URL> commented a `### Prismic model
delta` naming 1 model to update (`settings`) and 37 in sync; the operator merged
(RED tier — merging writes to the live Prismic repository `48bb12d1`); the `push`
run <URL> applied it; and a local dry `prismic-models` against the merged `main`
then reported `38 model(s) match Prismic — nothing to push`. That last check is
the one that matters — the first two are the workflow reporting on itself.

Worth knowing for the next site: the model check is **not ruleset-required** (only
`ci / ci` is), so a red dry job does not block a merge. Read the run, not the
merge button.
```

---

## Verification

The subsystem's acceptance gate is spec C5's, plus C6's records. Every item is an artefact, never an absent error.

- [ ] **C5 gate — the workflow has one real run.** `gh run list -R reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 3 --json event,conclusion,url` returns **two** runs, `pull_request` and `push`, both `success`; the PR carries a comment beginning `### Prismic model delta`; and from the maintenance build, `node dist/cli/bin.js prismic-models /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry` on the merged `main` prints `38 model(s) match Prismic — nothing to push`. Both URLs appear verbatim in Beachfront's `docs/workJournal.md`.
- [ ] **`prismic-ci` runs positionally.** In a scratch clone with an `origin` and a real `repositoryName`: `node dist/cli/bin.js prismic-ci <path>` reaches the secret gate rather than answering `no Git repo`. Held in CI by `tests/recipes/prismic-ci.test.ts` — "resolves the repo from origin when the site has no gitRepo (the positional path)" asserts `secretExists` was called with `reddoorla/espada`.
- [ ] **`launch` refuses a live twin.** `pnpm exec vitest run tests/recipes/launch.test.ts tests/cli/launch-command.test.ts` → 14 + 2 passed, including the three `dev-guard` refusals, the two `matching-disposition` cases and the two `formatStep` assertions; and, with the marker half of the condition removed, "not this site's own error page" goes red.
- [ ] **The false Renovate claim is gone.** `grep -rn "github-actions manager" src docs --exclude-dir=plans` prints **exactly one line**, `src/recipes/prismic-ci/template.ts:38` — the mention that is true and was deliberately left. (`--exclude-dir=plans` is required: this plan lives in `docs/superpowers/plans/` and quotes every corrected sentence verbatim, so an unscoped grep can never come back clean. The short pattern is required too: the `sync-configs` instance wraps across two lines and the longer phrase misses it.) The runbook contains a `### After every reddoorla/.github tag` heading, and `grep -rln "never opened a" src docs --exclude-dir=plans` lists the four corrected files — plus `docs/workJournal.md` once Task 6 Step 4 has appended its entry.
- [ ] **`pnpm verify` in `$MAINT`** is green with strictly more tests than Task 0's baseline, and the changeset file exists.
- [ ] **The skills are edited where sessions read them.** `readlink ~/.claude/skills/new-site` and `~/.claude/skills/matching-a-page` both resolve into `claude-skills`; `grep -c "PRISMIC_WRITE_TOKEN" ~/.claude/skills/new-site/SKILL.md` ≥ 3 (three LINES carry it: 6b's `gh secret set`, 6d's failure outcome, the verification item); `grep -c "match-harness" ~/.claude/skills/matching-a-page/SKILL.md` ≥ 1; `node --test test/` in that repo is green (its machine-path guard is what proves no `/Users/...` path was reintroduced).
- [ ] **Neither skill's numbered list was broken by the inserts.** `grep -c '^[0-9]\+\. ' skills/new-site/SKILL.md` is `8`, and `awk '/^### Phase 0/,/^### Phase 1/' skills/matching-a-page/SKILL.md | grep -c '^[0-9]\+\. '` is `8` — both were 8 before (measured 2026-09-08). The new material is indented sub-bullets, because `6b.` / `1b.` are not CommonMark ordered-list markers and would restart the list under prose that references its numbers.
- [ ] **The probe block kept its `try/finally` rule.** `sed -n '166,173p' skills/matching-a-page/SKILL.md` still contains "leaks a headless chromium" and contains no orphaned `elsewhere).` fragment.
- [ ] **C6 records.** `grep -n "Rebuilding from a live site" CLAUDE.md` in the starter prints one row; the starter journal carries the 2026-09-08 entry and a `> Superseded in part by 2026-09-08` pointer under the 2026-09-05 heading; maintenance `CLAUDE.md` says cherry-pick, never `git merge starter/main`, at the line `grep -n "Forward-merge only"` reported before the edit (194 on `origin/main`; the spec's `:116` is stale).
- [ ] **Five issues exist**, with the exact titles in Task 12, and their numbers are recorded in the journal entries that reference them.
- [ ] **Every repo touched has a journal entry** as the last act: `$MAINT`, `$SKILLS`, `$STARTER`, `$BF`.
