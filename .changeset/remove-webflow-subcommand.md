---
"@reddoorla/maintenance": minor
---

The `reddoor-maint webflow capture|docs|migrate` subcommand and the `src/webflow` import pipeline behind it are removed (Operator decisions 97(c)). Nothing in the package's `exports` reached it, and the 2026-10-19 conversions did not use it. `reddoor-maint webflow` now prints the CLI's unknown-command error and exits 1. The standalone capture script, `scripts/webflow-capture`, is unchanged, and so is `src/blux`.
