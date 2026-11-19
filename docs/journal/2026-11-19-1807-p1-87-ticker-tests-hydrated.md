# 2026-11-19: the ticker's browser tests wait for its script, and close their pages

Landed in the PR that fixes [reddoorla/reddoor-maintenance#2147](https://github.com/reddoorla/reddoor-maintenance/issues/2147) (P1-87 continuation 16). Tests only; the cockpit is unchanged.

**Why.** After PR 7b merged, `main` went red on 5b's ticker browser tests, three times on CI and never locally. The operator chose to fix the tests before PR 8 (workspace `decisions/2026-11-19-1101-p1-87-main-red-ticker-flake.md`).

**The cause, measured, two parts.**

- **The tests acted before the ticker's script ran.** The server render already holds the row, so every test's "two items in the row" wait passed at first paint, and the test then pressed, dragged or counted listeners on a page that could not answer yet. With Chromium's CPU slowed through CDP (`Emulation.setCPUThrottlingRate`, the new `COCKPIT_CPU_THROTTLE` knob in `signedIn`), the listeners test fails with CI's exact message (`expected { keydown: +0, … }`) at 6x and 20x on `bdc00a26`, and 3 of 3 at 6x on the 5b merge `1bb3d374`; at 1x it passes on both. So the race was in 5b from the start, and 7b's heavier page only made a slow runner hit it.
- **Every finished test kept its page running.** Contexts closed only in `afterAll`, so each test left a page animating the ticker and ticking the nightly clock. Through the ticker block the renderers climbed from 25 to 45 in four minutes, with a load average of 51 on 4 CPUs; the later tests ran on a starved machine.

**The fix.** `tickerReady(page)` waits for the row and then for `.ov-ticker-window[data-js="true"]`. The page sets `js = true` in the same effect that adds every listener, and the attribute reaches the DOM only after that effect has run, so the marker means "listeners attached". 39 tests, at 40 call sites, use it; the no-script test and the `waitUntil: "commit"` test keep their own waits (the marker never appears in the first). An `afterEach` closes each test's contexts. No assertion changed.

**Measured** (the ticker block, 41 tests, one browser). "Before" is `bdc00a26`; "round 0" is the PR as first opened (`5bf48902`); "after" is the head after round 2's fixes (`c11e0ff`), at 1x the round-1 head `debcfe6`, whose tests differ only by the scroll lock round 2 removed:

| Throttle | Before           | Round 0         | After    |
| -------- | ---------------- | --------------- | -------- |
| 1x       | (CI flake only)  | 41 of 41        | 41 of 41 |
| 2x       | 29 pass, 12 fail | 41 of 41        | 41 of 41 |
| 4x       | 27 pass, 14 fail | 38 pass, 3 fail | 41 of 41 |

At `c11e0ff` the block took 206 s at 2x and 285 s at 4x; at `debcfe6` it took 167 s, 202 s and 286 s at 1x, 2x and 4x, with at most one renderer at each 20 s sample and a load average of at most 2.35.

**The bottom-edge drag (round 1's major).** Round 0 called its 4x drop failures likely drag autoscroll, unproven, and "not seen on CI". The second half was wrong: CI's `release` failed on this very test (`a drag started on the window at 768px`), and the round-1 tests lens reproduced it at 2x (2 of 6 runs alone). A geometry and event log at 6x on `5bf48902` showed the page scrolling under a press held near the viewport's bottom edge: in a drag that started, `scrollY` went from 1030 to 1068 between `mouse.up` and `dragend` and the drop at y 898 missed the window (moved to y 828.8 to 861.3); in two runs that failed with CI's message, `dragstart` never fired and the page scrolled 119 px and 176 px under the press. Whether the scroll caused the missed drop and the drag that never started, or only came with them, is not shown.

**What fixed it was one page per run, not the scroll lock.** Round 0 left the pages a looping test opened until the test ended (up to 26 renderers at 4x). `nextRun` closes the previous run's pages first, in the 20 tests that open a page inside a loop. Round 1 also hid the root's overflow in the two bottom-edge tests, and credited that lock with their passes (4 of 4 at 6x and 2x). That comparison was confounded: its control, `5bf48902`, lacked `nextRun` too. Round 2's tests lens separated them. The head without the lock stayed green (3 of 3 at 6x, 1 of 1 at 10x, 2 of 2 at 2x); the lock with `signedIn` back in those two tests went red at 6x in 2 of 2 runs, with CI's message. So the scroll traced at 6x came under the pile-up of pages, and the lock is gone again. Mutant M4, a `nextRun` that does not close, took the renderers from 0 to 27 inside one looping test at 4x and ran it past its 120 s budget; with the fix it stayed at 1 and passed.

**Not explained on CI.** CI runs this file with 4 workers beside four browser-launching files (`tests/audits/browser.test.ts`, `form-e2e-live-runner`, `a11y-live-spec` and `tests/prospect/interaction-harness.test.ts`), so its contention comes mostly from them; cause 2's share on CI is not measured. The `page.goto` timeout on CI job 135492654689 (one load over 30 s before `tickerReady`) is unexplained and not shown fixed.

**Mutants** (the listeners test at 6x, 3 runs each): the wait without the marker, red 3 of 3; the page setting the marker in its server render (`let js = $state(true)`), red 2 of 3. The fix at 6x: 3 of 3 green.

**Belief corrected.** The first guess for the 390px drop failure was a drop point outside a narrow window; the logged geometry put it well inside. The window had moved.

**One more, from round 1.** "Not seen on CI" was a claim about CI's timings that nobody had read. The CI evidence lens read them: the failing drag tests ran 2 to 4 times slower per run than in other jobs (1.4 to 2.3 times over the whole test, since they stopped early), and the 4x residuals sat inside that range.

**And two from round 2.** CI's other drag that never started (job 135514861395, the drag-out test at 1280px, run 8) is in a test the trace did not cover; it stays observed, not explained. And I credited a fix with a result measured against a control that lacked two fixes. A before-and-after says which tree passes, not which change made it pass; only the mutant that removes one change at a time says that.

**Review.** Round 1 (three Opus lenses, Thu 11-19, about 10:28 to 11:20am PT): correctness clean, CI evidence and tests dirty, with two majors: the bottom-edge drag still failing, and the 4x residuals as a live CI risk. Fixed in `b173028..4fd395c`. Round 2 (about 12:03 to 12:51pm PT): correctness and CI evidence clean, tests dirty on one major, the lock's credit above. Fixed in `c11e0ff` and this entry. The words the lenses corrected are fixed above: 39 tests at 40 call sites use `tickerReady`, not 40, and the renderer and load figures are from one local run of the block at 4x.

**Review, round 3** (about 12:58 to 2:20pm PT): correctness, tests and CI evidence clean, minors and nits only, folded into this entry and the PR body. CI on `cb2af338` failed once on the pen flake [reddoorla/reddoor-maintenance#2139](https://github.com/reddoorla/reddoor-maintenance/issues/2139) and passed on its one re-run (the ticker file 82 of 82 in 231.6 s).

Usage: $17.69, 7602/142698 tokens, 36284136/1551980 cache, rate limit allowed
