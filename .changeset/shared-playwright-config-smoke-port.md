---
"@reddoorla/maintenance": minor
---

The shared `configs/playwright-a11y` base now honors `REDDOOR_SMOKE_PORT`
(R1.1 port binding): when the central smoke audit allocates a port, the base
binds vite to it with `--strictPort` and aims the baseURL + readiness probe at
it. Previously only sites on the smoke-suite recipe's R1.1 config template got
this protection — sites whose `playwright.config.ts` merely re-exports the
shared base (the sync-configs canonical shape; pre-R1.1 adopters the recipe
flags but never rewrites) hard-coded 5173, so any vite already squatting that
port was silently tested instead of the site. Observed live during tonight's
fleet-smoke triage: caltex's suite ran against erp-industrial's dev server and
reported the wrong site's results. Re-exporting sites inherit the fix on their
next `@reddoorla/maintenance` bump; behavior with the variable unset is
unchanged (fixed 5173, no `--strictPort`).
