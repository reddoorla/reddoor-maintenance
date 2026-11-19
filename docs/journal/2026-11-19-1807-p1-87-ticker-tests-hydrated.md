# 2026-11-19: the ticker's browser tests wait for its script, and close their pages

Landed in the PR that fixes [reddoorla/reddoor-maintenance#2147](https://github.com/reddoorla/reddoor-maintenance/issues/2147) (P1-87 continuation 16). Tests only; the cockpit is unchanged.

**Why.** After PR 7b merged, `main` went red on 5b's ticker browser tests, three times on CI and never locally. The operator chose to fix the tests before PR 8 (workspace `decisions/2026-11-19-1101-p1-87-main-red-ticker-flake.md`).

**The cause, measured, two parts.**

- **The tests acted before the ticker's script ran.** The server render already holds the row, so every test's "two items in the row" wait passed at first paint, and the test then pressed, dragged or counted listeners on a page that could not answer yet. With Chromium's CPU slowed through CDP (`Emulation.setCPUThrottlingRate`, the new `COCKPIT_CPU_THROTTLE` knob in `signedIn`), the listeners test fails with CI's exact message (`expected { keydown: +0, … }`) at 6x and 20x on `bdc00a26`, and 3 of 3 at 6x on the 5b merge `1bb3d374`; at 1x it passes on both. So the race was in 5b from the start, and 7b's heavier page only made a slow runner hit it.
- **Every finished test kept its page running.** Contexts closed only in `afterAll`, so each test left a page animating the ticker and ticking the nightly clock. Through the ticker block the renderers climbed from 25 to 45 in four minutes, with a load average of 51 on 4 CPUs; the later tests ran on a starved machine. Every CI failure was in the file's last third.

**The fix.** `tickerReady(page)` waits for the row and then for `.ov-ticker-window[data-js="true"]`. The page sets `js = true` in the same effect that adds every listener, and the attribute reaches the DOM only after that effect has run, so the marker means "listeners attached". All 40 ticker tests use it; the no-script test keeps its plain wait (the marker never appears there). An `afterEach` closes each test's contexts. No assertion changed.

**Measured** (the ticker block, 41 tests, one browser):

| Throttle | Before           | After           |
| -------- | ---------------- | --------------- |
| 1x       | (CI flake only)  | 41 of 41        |
| 2x       | 29 pass, 12 fail | 41 of 41        |
| 4x       | 27 pass, 14 fail | 38 pass, 3 fail |

At 4x the before-run failed on 0 listeners, "a drag started … false" (CI's two assertion failures), focus timing and drop preconditions; with the fix those are gone. Three remain at 4x only: one test passing its 120 s budget, and two "the drop is inside the window at 390px". Logged, the window had moved up 19 px during the drag: dragging 1 px from the viewport's bottom lets Chromium's drag autoscroll scroll the page if the drag is held long enough, which a 4x-slowed run does. The precondition caught an invalid run, as it should; it has not been seen on CI.

**Mutants** (the listeners test at 6x, 3 runs each): the wait without the marker, red 3 of 3; the page setting the marker in its server render (`let js = $state(true)`), red 2 of 3. The fix at 6x: 3 of 3 green.

**Belief corrected.** The first guess for the 390px drop failure was a drop point outside a narrow window; the logged geometry put it well inside. The window had moved.

**Not done.** Within one test, a loop that opens a page per run still keeps them all until the test ends (up to 26 renderers at 4x). Closing each run's page would take an edit in every looping test, so that is filed separately rather than folded in.
