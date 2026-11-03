# 2026-11-03 — The a11y scan waits for hydration (#948's residual race), and a string predicate that never waited

#948 moved the a11y scan onto a production preview but left nothing between `page.goto` and axe. `goto` resolves at `load`, and SvelteKit hydrates after it from a dynamic import, so on a site that writes `html[data-hydrated]` the scan could still read the server-rendered page. The roalson-interests numbers in `buildPlaywrightConfig`'s comment (191, 201, 191, 208, 191 against 208 hydrated) are that race. This was the workspace backlog's "#948's residual race", item (1).

**What changed.** After each scanned route's `goto`, the generated spec waits up to `HYDRATION_TIMEOUT_MS` (5 s) for the marker, before `freezeMotion`, the reveal pass and axe. If a route hits the cap and no route has shown the marker, later routes are not waited for, so a site without the marker pays 5 s once per run, as the constant's own comment says it should. Each route's wait (`marker`, `settled` or `not-waited`) goes into the artifact as `hydration`, and from there into `details`. This does not touch #1902's coverage counts: the same routes are scanned and skipped as before.

**The defect the fixture found first.** The backlog's suggested code, `page.waitForFunction(HYDRATED_EXPR, …)`, passes the check as a string. Playwright `eval`s a string predicate inside the page. The fixture site's CSP has no `'unsafe-eval'`, and neither does the starter's (`csp.mode: "auto"`), so the wait was refused in 32 to 40 ms and the scan went ahead unhydrated. A hand probe on the same page measured 35 ms and rejected for the string, against 2003 ms and the marker for a function. The control, the string with no CSP, gave the marker at 2037 ms. The spec now emits `const isHydrated = () => ${HYDRATED_EXPR}` and waits on that. The first full run had looked like a broken fixture ("settled", still 3 faint nodes); the probe that recorded the rejection message is what named it. form-e2e's and turnstile-coverage's shared `waitForHydration` passes the same string, so on starter sites it most likely has not waited since #1148. That is filed as #1923 and not changed here.

**Proof, #948's shape.** The fixture page has three faint (#aaa on white) paragraphs. Two seconds after `load` it makes two of them legible and then writes the marker, so it has 3 contrast nodes as served and 1 hydrated. There are two such routes, so that a first-route-only wait cannot pass. Before the change, all three cold runs (each its own build, preview server and browser) read 3 and 3. After it, all three read 1 and 1, with all four routes recorded as `marker`. A markerless site is still scanned on all 3 routes, as `settled`, `not-waited`, `not-waited`.

Mutations, each run against the four new tests:

| Mutation | Red |
| --- | --- |
| M1 no wait (today's code) | 3 of 4 |
| M2 the check passed as a string | 2 of 4 |
| M3 wait on the first scanned route only | 2 of 4 |
| M4 cap of 1000 ms instead of 5000 | 2 of 4 |
| M5 rejection unhandled | 2 of 4 (the markerless site) |
| M6 never stop waiting on a markerless site | 1 of 4 |
| M7 wrong attribute (`data-hydrate`) | 2 of 4 |

**Cost.** The live suite went from 163 s to 289 s: about 47 s is the new block, and the other ~79 s is the existing markerless fixture sites each paying the cap once. A fleet site without the marker now takes 5 s longer per weekly run; a site with it takes however long its bundle takes to hydrate.

**Not covered.** If a marker site's first scanned route never hydrates, its later routes go unwaited, as every route was before. The hydration smoke loop still uses its fixed `waitForTimeout(2000)`.
