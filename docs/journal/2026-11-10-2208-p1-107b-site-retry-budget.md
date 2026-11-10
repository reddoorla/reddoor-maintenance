# 2026-11-10 — P1-107b: one retry budget of 3 per site, shared by desktop and mobile

Landed in [reddoorla/reddoor-maintenance#2032](https://github.com/reddoorla/reddoor-maintenance/pull/2032), for [reddoorla/reddoor-maintenance#2030](https://github.com/reddoorla/reddoor-maintenance/issues/2030). It continues the session that landed [reddoorla/reddoor-maintenance#2014](https://github.com/reddoorla/reddoor-maintenance/pull/2014). The operator chose this fix in the workspace's `decisions/2026-11-10-2048-p1-107-desktop-retry-budget.md` (option 1).

**Why.** #2014 gave desktop navigations that throw the one retry mobile already had. Each retry costs up to 10 s, multiplied by 15 routes × 5 probes. On a site whose every sampled route hangs, the nightly's audit step then ran past its 75 minutes, and a breach loses every site's write-back. A budget of 3 per site keeps the protection both false Brokens on record needed (each was one throw on one route) and caps the cost at 30 s.

**How.** The per-site loop moved out of `defaultBrowserRunner`'s `probe` into `probeRoutes`, which creates `{ left: 3 }` once per call. That makes the per-call budget testable, which was the point of moving it: a test at the `probeDesktop` level could not catch a module-level budget. `probeDesktop` and `probeMobile` take the budget as an optional argument. The check sits on its own line above their existing return, so both older mutation sidecars still find their lines unedited, and a direct call with no budget retries as before.

**Measured.** Same fixture as the decision file: a local server with a 15-route sitemap that holds every page request open. The nightly's own `audit --only lighthouse,domain,browser,function-health --concurrency 1` ran on this branch and on `main` (e697405c) as a control, side by side, 1:09pm to 2:08pm PT.

|            | Control, `main`   | This branch       |
| ---------- | ----------------- | ----------------- |
| Wall clock | 3543 s (59.1 min) | 2813 s (46.9 min) |
| Requests   | 199               | 127               |

- The control reproduced the decision file's 199 requests and 3575 s, so the fixture is the same instrument.
- The difference is 730 s for 72 fewer requests: the 75 retries one-per-probe allowed, minus the 3 the budget spends.
- The request log shows the mechanism directly. On `/`, Chromium, Firefox and WebKit each took 30 s, then a 10 s retry. Pixel 7 and iPhone 14 got one try each. Every later route got five 30 s tries and no retry.
- On the 10 nightlies' 21.7 to 24.9 min, less about 2 min for the site that would otherwise run normally, a night with one such site now comes to about 67 to 70 min against 75.

**Beliefs corrected on contact.**

- **The brief's expectation was wrong.** It predicted "about 52 min, and 154 + 3 = 157 requests". It took the pre-#2014 run (154 requests) as the uncapped base, but that run already included mobile's 30 retries, which the shared budget now also caps. The right base is 154 − 30 = 124, plus 3 retries: 127, as measured.
- **The P1-107 entry's "~73 min" was wrong** (`2026-11-10-1755-p1-107-desktop-nav-retry.md`, "about 73 min, before any time Lighthouse spends on that site"). Measured, the step came to 79 to 82 min with #2014. The workspace journal `2026-11-10-2059-p1-107-hanging-site-budget.md` gives the cause: the browser audit alone measured 51.9 min, against a 42.5 min model, before the retry.

**Found in passing.** Mobile's sidecar mutants m7 and m8 stopped applying when #2014 landed: their `find`, the `gotoTimeoutMs` default line, now matches in both `probe*Once`. The sidecar exits 2 before running anything. Filed as [reddoorla/reddoor-maintenance#2031](https://github.com/reddoorla/reddoor-maintenance/issues/2031); m1 to m6 still go red here.

**Review.** Round 1 (Opus) found minors only, so the round was clean. I folded two minors and two nits into this PR. The remaining nit, that `probe()` itself is untested, is [reddoorla/reddoor-maintenance#2017](https://github.com/reddoorla/reddoor-maintenance/issues/2017).

One known edge from that review: once the budget is spent, a browser that crashes during a first navigation surfaces at its next probe, not on that route. On a site's last route, the crash reads as a page fail.

Usage: $5.59, 2185/49047 tokens, 13951259/265523 cache, rate limit allowed
