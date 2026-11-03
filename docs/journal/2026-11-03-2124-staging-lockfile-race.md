# 2026-11-03 — The staging flow's lockfile race: bring `main` in with pnpm merging the lockfile (reddoorla/reddoor-maintenance#1912)

**Why.** On 11-03, caltex-landing and medical-solutions-of-texas could not promote, for the same reason. In both, `main` had taken Renovate's non-major group and `staging` had taken lock-file maintenance. `git merge-tree --write-tree --name-only` of `main` against `staging` conflicted in `pnpm-lock.yaml` and nowhere else:

- CalTex (`main` 334f9a9 against `staging` 99b7438): 51 hunks.
- MSOT (`main` edd91b0 against `staging` a43e15a): 31 hunks.

That left the bring-main PRs (caltex #109, MSOT #122) and the promotions (caltex #110, MSOT #123) dirty. Revogen will repeat it: its open non-major #121 already conflicts the same way against `staging` 4933b5e, which carries lock-file maintenance #123. Two other cards are hand-fixing CalTex and MSOT, and this work did not touch their PRs.

**The change.** `scripts/staging-bring-main.mjs` scripts what the runbook already said to do on a conflict:

1. Cut a branch from `staging` and merge `main` into it.
2. Have the site's pinned pnpm (`packageManager`, through corepack) run `pnpm install --lockfile-only`. When pnpm finds conflict markers in its own lockfile, it merges both sides itself ("Merge conflict detected in pnpm-lock.yaml and successfully merged", pnpm 12.5.1 on the MSOT state).
3. Commit a two-parent merge.

A conflict in any other file stops the script with exit 2. The runbook's "Promotion, each time" now uses the script, and never a bring-main PR whose head is `main`.

**Replay of the 11-03 states.**

- **Before:** each state conflicted on the lockfile alone.
- **After:** `git merge-tree` of `main` against the result is clean for all three sites, and each result passes `corepack pnpm@12.5.1 install --frozen-lockfile --lockfile-only`.
- **CalTex:** the script's tree is byte-identical to the hand-fix's (caltex `e06b826`, which used `pnpm install` by hand). That was the first evidence the script does what a careful worker does.

**The candidates, weighed against what the flow protects** (majors are proved in `staging` before `main`):

- **Lock-file maintenance where the non-majors land (`main`).** Rejected, for two reasons.
  - It changes the flow's guarantee: a whole-tree refresh would reach production without passing `staging`, which the operator ruled out on 10-12 ("a whole-tree refresh is neither").
  - It does not remove the race: majors on `staging` also rewrite the lockfile.
- **A merge driver on `pnpm-lock.yaml`.** Rejected. GitHub runs no custom merge driver, so the PR still reads dirty.
- **The bring-main step merges the lockfile through pnpm.** Chosen. It is the only option of the three that works whichever side changed the lockfile, and it changes no guarantee: the result reaches `main` only through `staging`'s CI and the operator's promotion.

No decision file was needed, and no `.github` preset patch.

**Beliefs corrected on contact.**

- **The runbook already held the fix.** Since 10-19 it has described "cut a branch from `staging`, merge `main` into it, regenerate". What failed on 11-03 was a bring-main PR opened with head `main` by default.
- **The PR's `base.sha` is not the base's tip.** The round-1 fix gated the merge on it. Round 2 showed it is a snapshot from the last push: on this repo's open PRs at 1:07pm PT, `base.sha` was 1 to 5 commits behind `main`. The gate now reads `GET branches/staging`.
- **`main` is strict but `staging` is not.** So a fast-track merge leaves the promotion behind, not dirty. A bring-main PR merged after `staging` moved would merge the lockfile as text again, untested as one tree. Both are now runbook steps: re-run whenever `main` is no longer an ancestor of `staging`, and merge only while `staging`'s live tip is the sha the script printed. A window of seconds remains, because the merge call cannot pin the base.

**Mutations, named before the code.** M1 to M5 were named first; M6 to M10 came with the review rounds. At 570a6dd, `node scripts/mutate.mjs tests/scripts/staging-bring-main.mutations.json` turned all 10 red:

- **M1:** no regeneration (the lockfile merged as text again).
- **M2:** no `main` parent (a squash).
- **M3:** no scope guard.
- **M4:** no conflict-marker check.
- **M5:** no up-to-date short-circuit.
- **M6:** no cleanup.
- **M7:** no shallow refusal.
- **M8:** no stray-file check.
- **M9:** guess the pnpm on PATH.
- **M10:** `worktree add` outside the try.

M6 first survived in round 2, when it removed `worktree remove` alone, because `rmSync` plus `worktree prune` cover it. Widening it to the whole cleanup made it red.

The fixture needs no registry: `link:` dependencies, with `main` bumping `a` and `staging` adding `aa`. `aa` sits apart from `a` in package.json, but pnpm sorts it straight under `a` in the lockfile, so git conflicts on the lockfile alone. A test proves that before the script runs.

**Review rounds** (Opus, three lenses in round 1, then one reviewer per round):

- **Round 1:** dirty.
  - Critical: the re-run rule missed "promotion behind".
  - Majors: the bring-main PR could be merged after `staging` moved; a shallow clone was reported as a "real fork"; "never blocks a promotion" overclaimed.
  - Minors, folded in: an unpinned pnpm, a spawn error printed as "undefined", the fetch ignoring `--main`/`--staging`, a temp-dir leak, stray files dropped silently, and the frozen check run in the wrong directory.
- **Round 2:** dirty.
  - Major: the `base.sha` gate, above.
  - Major: a part-way `worktree add` leaked a registered worktree. Reproduced with a `post-checkout` hook; on a `blob:none` clone, a lazy fetch cut off by the proxy does the same.
- **Round 3:** minors only, all folded in because each sits in a file this PR touches:
  - prune only this run's own worktree entry;
  - show the corepack hint only on ENOENT;
  - print the right remote for `refs/remotes/...`;
  - the runbook says the worker lands the bring-main PR, and to delete the old local branch before a re-run.

CI's `build` failed twice on TS2532 (`noUncheckedIndexedAccess` in the test); fixed in d862f77.

**Still open, honestly.**

- A conflict in `package.json` itself, such as a major of X on `staging` and a minor of X on `main`, still stops for a human. The brief was the lockfile race, so that is by design.
- Nothing runs the script automatically. A worker runs it at promotion time.
- A GitHub Actions job could, but a PR its `GITHUB_TOKEN` opens triggers no `ci / ci`, so it would need an App token: a secret, which is red tier.

Usage: $10.59, 3369/126433 tokens, 21153993/640289 cache, rate limit allowed (read at 1:20pm PT, before the landing).
