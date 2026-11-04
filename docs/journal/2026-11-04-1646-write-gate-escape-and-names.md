# 2026-11-04 — The fleet write gate escapes its annotations, names its not-written sites once, and names a nameless site at load (#1651, #1650, #1882)

Where it landed: this PR, https://github.com/reddoorla/reddoor-maintenance/pull/1938 (branch `claude/p1-82-write-gate`, workspace backlog row P1-82). It closes https://github.com/reddoorla/reddoor-maintenance/issues/1651 (items 1, 2 and 4; 3 and 5 landed in #1813), https://github.com/reddoorla/reddoor-maintenance/issues/1650 (item 2; item 1 landed in #1811) and https://github.com/reddoorla/reddoor-maintenance/issues/1882. The operator picked (a) on both design calls (workspace `decisions/2026-11-03-2230-p1-82-write-gate-design-calls.md`). The minors are filed as https://github.com/reddoorla/reddoor-maintenance/issues/1942. Two sessions did the work: the first wrote it and handed off at 320k tokens of context after review round 1, and the second fixed round 2 and landed it.

**Why.** The gate's REASON and WARNING lines went to `::error::` and `::warning::` raw. GitHub decodes `%25`, `%0D` and `%0A` in a workflow command, so a site label holding `%0A` printed as a line break, and the gate's own `(>25%)` was one stray digit away from being eaten. Each of six workflows also printed its own bash "not written" warning, beside the gate's, for the same miss. And a JSON-inventory site with no `name` reached the gate under two labels: as missing (its path) and as a permanent failure (the name `cloneIfNeeded` gave it at prep).

**What.**

- `annotationText` escapes `%`, then `\r`, then `\n`, which is the exact inverse of the runner's decoding.
- `audit.out` goes under `RUNNER_TEMP` in lighthouse, security and a11y. The workflow tests raced on the shared `/tmp/audit.out` across worktrees.
- One not-written warning per night, the gate's, naming each site and its error. The bash duplicates are gone.
- A nameless site takes its repo's name at load, unless another site already has that name or derives the same one.
- #1882's runbook line points at `prismic-models --fleet turso --tokens` rather than a count that drifts.

**Beliefs corrected on contact.**

- **The first brief said GitHub decodes `%41` too.** It decodes only `%25`, `%0D` and `%0A`. The round-1 fixer caught it, and the test E2 now pins the opposite: `%41` reaches the reader as `%41`.
- **Deleting a duplicate warning is not free when an exit sits between the two copies.** Rounds 1 and 2 each found the same defect in a new place. The bash duplicate ran before some early exits, and the gate's line ran after them.
  - Round 1: a red night (the `>25%` reason) named no failed site at all, because the warning had moved inside an `else`. Prismic-drift's two early exits also skipped it.
  - Round 2: smoke's "never measured" exit comes before the gate block. On a night with one unmeasured site and one Turso 503, the 503 reached no annotation.
  - Round 3 listed every `exit` after the summary in all six steps and ran 6 workflows × 6 scenarios through the real bash, on `main` and on the branch. The branch names every failed site that `main` names. Form-e2e names more: `main`'s `✗ [^:]+:` grep matched nothing the formatter prints, so it never named a failed site there.
- **Load-time naming can merge two sites.** Two nameless `*/foo` sites, or a derived `bar` beside an explicit `bar`, would have shared one label and merged in `expectedSites`' Set. The guard leaves such a site nameless. `cloneIfNeeded` can still rename it at prep, which the JSDoc now says.

**Test changes.** One existing assertion changed. `fleet-write-gate.test.ts`'s verdict-line test went from "after the summary line" to "before the summary line, which is the last line". Printing the summary last means a decoy `FLEET_WRITE_SUMMARY` inside an error string can never be the last match that every workflow's `tail -n1` reads. Three existing expectations of `N of M site(s) not written` gained the `: <slug> (<error>)` suffix the operator chose.

**Mutations.** W1 to W5 were named in the first brief, W6 to W10 in the second, W11 to W14 and W7b at round 1, and W15 at round 2, each before its code. At `749dc6b2` all 16 are red.

**Review.** Round 1 found two majors, and round 2 found one major, the smoke exit above. Round 3 was clean (minors only); its minors are in #1942.

Usage: $10.32, 3,239/193,349 tokens, 26,625,840/930,752 cache, rate limit allowed (the second session, cumulative across both PRs at 4:46pm PT 11-04; the first session's usage is not included and was not recorded in any entry).
