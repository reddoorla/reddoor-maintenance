---
"@reddoorla/maintenance": minor
---

The Webflow import pipeline is removed (operator decision 97(c)).

Breaking for the CLI: the `reddoor-maint webflow capture|docs|migrate` subcommand and the `src/webflow` code behind it are removed. Nothing in the package's `exports` reached it, and the 2026-10-19 conversions did not use it. `reddoor-maint webflow` now prints the CLI's unknown-command error and exits 1. The standalone capture script, `scripts/webflow-capture`, is unchanged, and so is `src/blux`.
