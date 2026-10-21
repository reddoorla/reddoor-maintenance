---
"@reddoorla/maintenance": patch
---

The security audit no longer drops Dependabot's live alerts when a site's lockfile is hidden from GitHub's dependency graph (pnpm 12) and `pnpm audit` cannot run (#1561). It reports Dependabot's result with a note that the lockfile audit could not run, and writes it as a partial run: Dependabot's side of the stored advisories is replaced by tonight's alerts, while each advisory the lockfile audit found earlier stays, with its count, so one failed `pnpm audit` cannot clear a known npm vulnerability and an alert fixed since is not kept. The merged audit now records on each advisory whether the lockfile audit reported it (`lockfile`). A partial run leaves `Last security audit at` as stored, so the Security Updates auto-tick reads the row as stale or unaudited rather than freshly clean. With no live Dependabot alert the audit still skips and writes nothing.
