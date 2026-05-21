# @reddoorla/maintenance

## 0.1.1

### Patch Changes

- 15d81b2: Fix lighthouse and a11y audits to parse real tool output. Previously they discarded everything the tools wrote and synthesized results from spawn exit code alone, which made `details.summary` always empty for lighthouse and silently dropped per-impact axe violation data.
  - Lighthouse now reads `<site>/.lighthouseci/manifest.json` for per-category scores and `<site>/.lighthouseci/assertion-results.json` for which assertions failed at what level.
  - A11y now writes a Playwright spec that aggregates axe violations across all configured routes into `<site>/.reddoor-a11y/results.json` (via the `REDDOOR_A11Y_OUTPUT` env var); the audit reads that artifact regardless of test outcome.
  - Security audit now surfaces per-advisory details (module, severity, title, CVEs) in `details.advisories` alongside the existing counts.
  - Stale `.lighthouseci/` and `.reddoor-a11y/` directories are removed before each run so a failed spawn can't masquerade as success by leaving last run's data in place.

## 0.1.0

### Minor Changes

- daf5ec4: Initial public release: configs, audits, recipes, inventory, CLI.
