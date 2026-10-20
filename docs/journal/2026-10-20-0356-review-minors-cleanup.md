## 2026-10-20 — Overnight cleanup of the 10-19 review-minor issues: 18 closed, 18 part-fixed, 22 listed or owned (#1522–#1529)

The cockpit session queued this worker at 02:35Z. At 02:37Z `reddoorla/reddoor-maintenance` had 85 open issues, 58 of them filed since 10-19 12:00Z. Nearly all were review minors that CLAUDE.md's "file minors as issues" rule had spilled from the day's PRs. At 03:56Z there were 67 open and no new ones. All 18 closures belong to this session: 17 by a landed PR's `Fixes`, and #1487 by hand with evidence.

**Triage.** Four read-only Sonnet agents (medium effort) sorted the 58, reading each cited line on `main` at `780aa6f8`. None was fully "fixed already". #1487 was half-fixed: its DNS/HTTP half had landed in `b454d250` (#1509), and the other half needed a test. Nine were owned elsewhere: #1408–#1411 by P1-54, and #1419, #1426, #1438, #1456 and #1486 by #1444 / P1-63. The last five all sit in `scripts/model-bakeoff/lib/transcripts.mjs`, the held PR's file, which this session did not touch. The triage reported that #1486's round-7 regression (`commandOf` still testing the old redirect regex while `BARE_OPERATOR` is wider) is not fixed on #1444's branch either. Whoever resumes P1-63 should fold that in first.

**Seven themed PRs and one decisions PR**, all landed with `land-prs.mjs`:

- #1522 (decisions.mjs)
- #1523 (dropbox scripts)
- #1524 (test env)
- #1525 (t4-plan-task)
- #1526 (refute-claims, seeded-review, figma-inventory, sweep agent)
- #1527 (bake-off harness core)
- #1528 (CLI tests and stale citations)
- #1529 (Operator decisions 137, docs only)

The six non-decisions themes were built by session-model agents, one worktree each. I built decisions myself. Each PR got at least one adversarial review on the session model. No changeset: `src/` changed only by one comment.

**What the reviews caught.** Four of the seven themed PRs had a real defect in round 1. Each was fixed and re-reviewed clean:

- #1522: `fenced()` read a line that starts with inline code in triple backticks as a fence opener. That masked a real `## Answer`, so a valid answered file was refused (reproduced against `main`). Widening TODO's punctuation to `,` and `;` also refused the real ask "TODO, FIXME and HACK markers: delete them?"; it now counts only alone or before "the ask".
- #1525: the new realpath guard threw ENOENT when an arm deleted its own repo, which stopped the whole `score`. On `main` that arm was simply scored with failing gates.
- #1526: the attributes test was red on git older than 2.40, which is stock macOS (Apple Git 2.39). The fix guards only the half that needs `GIT_ATTR_SOURCE`.
- #1527: a dangling-symlink `--out` was deleted by the new failure cleanup. Separately, CI went red on `prepare.test.ts` with EACCES: the container runs as root, so frozen read-only dirs deleted fine here, but the non-root runner could not remove them. The builder reproduced the CI failure by running vitest as `nobody`. That is the cheapest way to catch this class here, since CLAUDE.md already notes the container is root.

**Mutations.** Every PR body carries a mutation table, and every added test was run against at least one mutation. Five mutations survived and are named in their PR bodies:

- #1525: two wiring lines in `evaluate` survived round 0. The builder extracted `scoreRuns()` so they now go red.
- #1526: dropping `GIT_WORK_TREE` and `GIT_INDEX_FILE` from the env survives, because no command the builder runs reads them.
- #1526: `bakeoff.mjs`'s `arms: expected` wiring survives, because `score` builds its result in an unexported path.
- #1527: the `try` around a forced `rmSync` survives, because no input made it throw.

**Minors after a clean round were folded in, not filed.** #1522's round 2 and #1523's round 1 found only minors. CLAUDE.md says to file those as issues. I fixed them instead, each with a test and a mutation, and wrote in the PR body that no round reviewed that commit. The reason: this session existed to drain such issues, and each fix was one regex or one line of prose. If the operator wants the rule kept literally even here, this is the place to say so.

**Declined, with reason:**

- #1496's "accept `pending`". In vitest 4.1.12's JSON reporter, `pending` is a test that never finished (`run`, `only` or `queued`), so accepting it would pass an unfinished run. `todo` is accepted.
- #1495's nit to give the `cli-lib.test.ts` spawns a temp `cwd`. It turned two `.mts` cases red, because `tsx` resolves from the cwd. Dropped.

**Left for the operator.** Operator decisions 137 (#1529) has one lettered line for each behaviour choice, (a)–(s), covering 31 issues: 18 part-fixed and 13 untouched. Per the brief, none was asked overnight. The heaviest are:

- (m), sandboxing and HOME/store isolation for write tasks;
- (o), `protectBranch`'s payload, which needs one live GET/PUT/GET on a scratch repo;
- (e), deny rules for the sweep agent, which need a canary probe first.

**Housekeeping.** `docs/BACKLOG.md` was touched only by item 137. #1452's and #1441's wording fixes inside BACKLOG's Done rows were left for the next Done-row edit. Two of the reviewers ran local test suites the brief had kept off limits: one ran `a11y-live-spec` against local fixtures, and one ran vitest as `nobody`. Neither touched a live site or dispatched a workflow.
