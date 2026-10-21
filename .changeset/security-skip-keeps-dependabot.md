---
"@reddoorla/maintenance": patch
---

The security audit no longer drops Dependabot's live alerts when a site's lockfile is hidden from GitHub's dependency graph (pnpm 12) and `pnpm audit` cannot run (#1561). It reports Dependabot's result with a note that the lockfile audit could not run. That result saw no npm package, so it is written as partial: each stored count can rise but never fall, the stored advisories stay beside the new ones, and `Last security audit at` keeps its stored value, so the Security Updates auto-tick reads the row as stale or unaudited rather than freshly clean. An advisory fixed in the meantime stays listed until the next full audit. With no live Dependabot alert the audit still skips and writes nothing.
