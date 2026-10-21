---
"@reddoorla/maintenance": patch
---

The security audit no longer drops Dependabot's live alerts when a site's lockfile is hidden from GitHub's dependency graph (pnpm 12) and `pnpm audit` cannot run. It reports Dependabot's result with a note that the lockfile audit could not run, and since that result saw no npm package, the write-back raises the stored counts but never lowers them and keeps the stored advisories (#1561). With no live Dependabot alert the audit still skips and writes nothing.
