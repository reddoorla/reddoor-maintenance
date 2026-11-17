# 2026-11-17 — P1-87 PR 3: the overview's first screen, through five review rounds

Landed in [reddoorla/reddoor-maintenance#2060](https://github.com/reddoorla/reddoor-maintenance/pull/2060). Four sessions carried this PR (continuations 3, 4 and 5 of P1-87 Phase 2); this entry covers all of it.

The overview's first screen now has the shape of sketch 3: the status strip, Fleet health over maintained sites only (the tier bar, then sites passing each of seven checks in a fixed order, then the four Lighthouse medians), and six "How much is happening" tiles from data the cockpit already had. "Is every site live?" moved to `/fleet` in PR 2 and the explanations to `/how` in PR 1, so the first screen holds no per-site element except the broken sites the strip names on a bad day. A short Upkeep section (Open now, major-version upgrades waiting) stays below on the operator's word (workspace `decisions/2026-11-16-2301-p1-87-pr3-upkeep-open-now.md`).

**Five review rounds; rounds 1 to 4 dirty, round 5 clean.** Each round's real findings were folded in by a Haiku fixer from a written brief; every round's lenses were Opus.

- Round 1 (`2617a35a`): 12 majors. The checks tile took the newest counted night instead of last night and counted rows instead of calendar nights; a partial accessibility scan passed; the bars vanished under forced colours; the layout departed from the sketch. CI failed 4 tests.
- Round 2 (`b54f6321`): a failed form test read "not checked" (now three unknown kinds, test failed, no verdict and not checked); the checks tile summed tonight's row before 6am PT; on a phone a long count took every bar to 0px. CI then failed the style guide's token rule on a gradient hatch.
- Round 3 (`c2200488`): Deps and Shipped were not bounded to last night before 6am; a pass fill under forced colours was hollow like a failure.
- Round 4 (`6ec346c2`): round 3's bound sat in the shared `windowFigure`, so `/how` contradicted itself before 6am; the 31-row read gave Deps and Shipped 29 nights against Checks' 30 (`OVERVIEW_NIGHTS` is 32 now); a browser test measured nothing and passed.
- Round 5 (`c083148d`): minors only. Three folded in at `54c77bdd` (How we count said "paler" for a part that is darker in dark mode; it never said why the first screen's tiles can differ from `/how` before 6am; a comment). Nine filed: reddoorla/reddoor-maintenance#2061 to #2069.

**Mutations.** 98 in `cockpit/tests/overview/first-screen.mutations.json`; the full run at `c083148d` is in the PR body. Round 5's tests lens wrote 23 more outside the sidecar: 20 red, 3 survived (one minor, the grey part's offset on a row with failures, #2067).

**Beliefs corrected on contact.**

- A fix inside a shared helper reaches pages the finding never named: round 3 bounded `windowFigure` for the first screen's tiles and changed `/how` too. The round-4 brief listed every caller and which must not change, and round 5 found the split right.
- A browser test that loops can pass by measuring nothing. The "fill inside track" test iterated rows with no fill; the seed had no passing site.
- "The dark part" and "the paler part" are both wrong in one theme. Describing a bar by position and line style, not tone, is what survives light, dark and forced colours.
- Playwright's `fullPage` screenshot drops Chromium's forced-colour painting; growing the viewport keeps it.
- The style guide refuses gradients (one `var(--token)` per colour declaration); patterns are drawn with borders and inset shadows.

**Honest accounting.** Five rounds on one PR is the limit the operator set; round 5 came in clean, so no sixth round ran and nothing went to him. Most real findings after round 1 were about the before-6am window and forced colours, which the first plan did not consider.

Usage (continuation 5 to this entry): $8.02, 2796/69286 tokens, 16475745/546644 cache, rate limit allowed
