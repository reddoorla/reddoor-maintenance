# 2026-11-19: the ticker's browser tests wait for its script, and close their pages

Landed in the PR that fixes [reddoorla/reddoor-maintenance#2147](https://github.com/reddoorla/reddoor-maintenance/issues/2147) (P1-87 continuation 16). Tests only; the cockpit is unchanged.

**Why.** After PR 7b merged, `main` went red on 5b's ticker browser tests, three times on CI and never locally. The operator chose to fix the tests before PR 8 (workspace `decisions/2026-11-19-1101-p1-87-main-red-ticker-flake.md`).

**The cause, measured, two parts.**

- **The tests acted before the ticker's script ran.** The server render already holds the row, so every test's "two items in the row" wait passed at first paint, and the test then pressed, dragged or counted listeners on a page that could not answer yet. With Chromium's CPU slowed through CDP (`Emulation.setCPUThrottlingRate`, the new `COCKPIT_CPU_THROTTLE` knob in `signedIn`), the listeners test fails with CI's exact message (`expected { keydown: +0, … }`) at 6x and 20x on `bdc00a26`, and 3 of 3 at 6x on the 5b merge `1bb3d374`; at 1x it passes on both. So the race was in 5b from the start, and 7b's heavier page only made a slow runner hit it.
- **Every finished test kept its page running.** Contexts closed only in `afterAll`, so each test left a page animating the ticker and ticking the nightly clock. Through the ticker block the renderers climbed from 25 to 45 in four minutes, with a load average of 51 on 4 CPUs; the later tests ran on a starved machine.

**The fix.** `tickerReady(page)` waits for the row and then for `.ov-ticker-window[data-js="true"]`. The page sets `js = true` in the same effect that adds every listener, and the attribute reaches the DOM only after that effect has run, so the marker means "listeners attached". 39 tests, at 40 call sites, use it; the no-script test and the `waitUntil: "commit"` test keep their own waits (the marker never appears in the first). An `afterEach` closes each test's contexts. No assertion changed.

**Measured** (the ticker block, 41 tests, one browser). "Before" is `bdc00a26`; "round 0" is the PR as first opened (`5bf48902`); "after" is the head after round 1's fixes (`debcfe6`):

| Throttle | Before           | Round 0         | After    |
| -------- | ---------------- | --------------- | -------- |
| 1x       | (CI flake only)  | 41 of 41        | 41 of 41 |
| 2x       | 29 pass, 12 fail | 41 of 41        | 41 of 41 |
| 4x       | 27 pass, 14 fail | 38 pass, 3 fail | 41 of 41 |

The after-runs took 167 s, 202 s and 286 s, with at most one renderer at each 20 s sample and a load average of at most 2.35.

**The bottom-edge drag, traced (round 1's major).** Round 0 called the 4x drop failures likely drag autoscroll, unproven, and "not seen on CI". Both halves were wrong in the way that mattered: CI's `release` failed on this very test (`a drag started on the window at 768px`), and the round-1 tests lens reproduced it at 2x (2 of 6 runs alone). A geometry and event log at 6x on `5bf48902` then settled the cause. The page scrolls under a press held near the viewport's bottom edge: in a drag that started, `scrollY` went from 1030 to 1068 between `mouse.up` and `dragend`, and the window moved up to y 828.8 to 861.3, so the drop at y 898 missed it; in two runs that failed with CI's message, `dragstart` never fired and the page scrolled 119 px and 176 px under the press. That is the browser autoscrolling, not the ticker's code. Both bottom-edge tests now hide the root's overflow once the window sits at the viewport's bottom, and both passed 4 of 4 at 6x and 4 of 4 at 2x, where `5bf48902` failed 3 of 4 traced runs at 6x. No precondition or outcome assertion changed.

**One page per run.** Round 0 left the pages a looping test opened until the test ended (up to 26 renderers at 4x). `nextRun` closes the previous run's pages first, in the 20 tests that open a page inside a loop. Mutant M4, a `nextRun` that does not close, took the renderers from 0 to 27 inside one looping test at 4x and ran it past its 120 s budget; with the fix it stayed at 1 and passed.

**Not explained on CI.** CI runs this file with 4 workers beside four browser-launching files (`tests/audits/browser.test.ts`, `form-e2e-live-runner`, `a11y-live-spec` and `tests/prospect/interaction-harness.test.ts`), so its contention comes mostly from them; cause 2's share on CI is not measured. The `page.goto` timeout on CI job 135492654689 (one load over 30 s before `tickerReady`) is unexplained and not shown fixed.

**Mutants** (the listeners test at 6x, 3 runs each): the wait without the marker, red 3 of 3; the page setting the marker in its server render (`let js = $state(true)`), red 2 of 3. The fix at 6x: 3 of 3 green.

**Belief corrected.** The first guess for the 390px drop failure was a drop point outside a narrow window; the logged geometry put it well inside. The window had moved.

**Two more, from round 1.** "The drag that never starts" read like a second, unexplained race in round 0. The trace showed it is the same scroll: the press near the edge scrolled the page before Chromium began the drag. And "not seen on CI" was a claim about CI's timings that nobody had read; the CI evidence lens read them (the failing drag tests ran 2 to 4 times slower than in other jobs) and the 4x residuals sat inside that range.

**Review.** Round 1 (three Opus lenses, Thu 11-19, about 10:28 to 11:20am PT): correctness clean, CI evidence and tests dirty, the bottom-edge drag the one major. Fixed in `b173028..debcfe6`. The words a lens corrected are fixed above: 39 tests at 40 call sites use `tickerReady`, not 40, and the renderer and load figures are from one local run of the block at 4x.
