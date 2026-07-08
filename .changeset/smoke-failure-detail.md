---
"@reddoorla/maintenance": patch
---

`smoke` audit now surfaces the actual Playwright failure. On a non-zero run it distilled `stderr.slice(0, 200)`, but Playwright writes its failing-test list (which test, expected vs received) to **stdout** — so the fleet-smoke summary/Airtable captured only a `[WebServer] npm warn …` line and hid what broke. `summarizeSmokeFailure` now extracts the failing test title + Error/Expected/Received head + the "N failed" tally from stdout (ANSI-stripped, capped), falling back to stderr only when stdout carried no reporter output.
