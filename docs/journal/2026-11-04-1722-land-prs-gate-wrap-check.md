# 2026-11-04 — The land-prs test-change gate flags a block comment opened around existing lines, and a renamed skip stays an added skip (#1617)

Where it landed: this PR, https://github.com/reddoorla/reddoor-maintenance/pull/1935 (branch `claude/p1-82-land-prs-gate`, workspace backlog row P1-82). It closes https://github.com/reddoorla/reddoor-maintenance/issues/1617. The renamed-skip item and the moved-closer gap moved to https://github.com/reddoorla/reddoor-maintenance/issues/1946, beside https://github.com/reddoorla/reddoor-maintenance/issues/1941. Three sessions did the work: the first wrote it and ran rounds 1 to 3, the second ran rounds 4 to 6 and handed off at 300k tokens of context, and the third cut it down, ran round 7 and landed it.

**Why.** #1812 left three #1617 items open as "patch-limited": a renamed skip flagged as added, `/* … */` wrapped around existing assertions, and an assertion moved into an already-skipped test. The first two turned out to be readable from the patch alone. The third really is patch-limited, and the operator closed it as allowed by the spec (Q3 (a) of workspace `decisions/2026-11-03-2230-p1-82-write-gate-design-calls.md`).

**What landed.**

- **(W)** The first non-blank context line in each hunk that the new side puts inside a block comment, and the old side does not, is flagged `existing line now inside a block comment: <line>`. The closer can be anywhere, even outside the patch.
- **(C)** An added line wholly inside a block comment no longer counts as re-adding a removed assertion, so commenting an assertion out is flagged.
- The line scanner both rely on: strings and templates (with `\` escapes), regex literals and classes (`regexStartAt`, `regexClassAt`), a hunk that starts on a JSDoc continuation (`jsdocFirstLine`), CRLF, and no blank line as the reported one.

Both only add flags to `main`'s gate. A renamed skip is flagged as an added skip, exactly as on `main`.

**What was built and cut.** Two parts were built, reviewed for six rounds, and removed at the operator's round-6 hold (option 1, workspace `decisions/2026-11-04-1700-1935-land-prs-gate-round-6-hold.md`):

- **(R), the renamed-skip exemption.** It is the only part of this gate that can be looser than `main`, and it regressed against `main` in rounds 3, 4, 5 and 6. Each round found a new way to pass a newly live skip off as a rename:
  - round 3: a skip of a running test's new name in a reshaped block;
  - round 4: a running test's name in another quote style;
  - round 5: an escaped name;
  - round 6: uncommenting a `.only` while renaming it, and a running test whose line held a conditional `test.skip(…)`.

  Each fix closed one door, and the next round found another. Its value was one line of PR body per renamed skip.

- **The stray-`*/` re-scan** (round 4, changed in round 5). It re-read a hunk side from inside a comment when it met a `*/` in code, to catch a closer moved down from a comment opened above the hunk. It had holes in rounds 5 and 6 (a path or regex-start `/` before the closer). Round 5's fix to it made an added `// collects tests/**/*.test.ts` or `// schedule: */15 * * * *` flag the line above as wrapped. Globs and crons in comments are common in this repo.

About 190 lines of code, 27 tests and 18 mutants left. New tests pin round 6's two regression patches and a plain rename as flagged, exactly as `main` flags them, and round 6's false flag as `[]`.

**Beliefs corrected on contact.**

- **"Patch-limited" was wrong for two of the three items.** A wrap shows in the context lines after the new `/*`, and a rename sits in its own change block.
- **An exemption is a different kind of code from a check.** A check that misses something leaves the gate where `main` was. An exemption that misses lets through what `main` caught. Six rounds of review were spent mostly on the exemption. The lesson: keep a gate's exemptions out of the PR that adds its checks, and expect any exemption to cost several rounds.
- **The 10-27 note that a rename "needs a per-hunk count" was not enough.** The count was the easy part; deciding which removed line was the running test of the new name was not.

**Test changes.** None to `main`'s assertions. Every removed test was one this PR added.

**Mutations.** At `3689768a`, `node scripts/mutate.mjs tests/scripts/land-prs.mutations.json` gives 31 mutants, 31 red: `main`'s 15, and the 16 P1-82 mutants that pin (W), (C) and the scanner.

**Review.** Rounds 1 to 6 were dirty. Round 5 went to the operator (workspace `decisions/2026-11-04-0439-…`), who asked for all four findings fixed and a sixth round. Round 6 went to him again, and he chose the cut. Round 7, one short Opus round on the cut, asked two questions: is it ever looser than `main`, and does it give an everyday false flag?

- **Looser: clean.** It fuzzed 200,000 random patches built from comment, quote, regex and skip tokens. On every one, `main`'s flags were a subset of HEAD's, and HEAD never threw.
- **False flag: one major.** A hunk that starts partway through a comment that opened above it, on a JSDoc line ending in `,` or a comment line with no `*`, read a glob added to that comment (`fixtures/*.json`) as an opener. It then flagged the comment's own `*/` as wrapped. `main` gives `[]`.
- **The fix**, at `3689768a`: a context line that starts with `*/` is never the wrapped line. It hides nothing, because the code after its closer runs. The fix has a test and mutant M-P182-34, and all 31 mutants are red there.
- **The operator chose to land with the fix and no eighth round** (workspace `decisions/2026-11-04-1726-1935-land-prs-gate-round-7-hold.md`).

Usage: $5.08, 1,665/54,065 tokens, 11,376,561/251,521 cache, rate limit allowed (the third session, at 9:30am PT 11-04, for both P1-82 PRs; the earlier sessions' usage is in their own entries).
