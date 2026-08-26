---
"@reddoorla/maintenance": patch
---

Fix the shared Playwright config handing every worker a different port.

Since the free-port allocation landed, `playwright-a11y` resolved its port at
module scope with `smokePort || allocateFreePortSync() || "5173"`. Playwright
re-evaluates the config file in **every worker process**, not only the main one,
so each evaluation allocated a _different_ free port. The main process started
the dev server on one; every worker aimed `baseURL` at another. The run then
died with `ERR_CONNECTION_REFUSED` against a handful of ports nothing was ever
serving, and the site's route warmup reported `fetch failed` for every route
before a single test ran.

The allocation is now pinned back into `REDDOOR_SMOKE_PORT`. Workers are forked
and inherit the environment, so every later evaluation agrees on the port the
server is actually bound to. An externally supplied port still wins, unchanged.

This reached every fleet site consuming the base without `REDDOOR_SMOKE_PORT`
already set — which is why `reddoor-website` could not take 0.84 or later. It
did **not** reach `audit --only a11y`, which writes its own config and never
loads this file, so the package's own suite passed throughout and nothing here
caught it. There are tests now, and they fail without the fix.
