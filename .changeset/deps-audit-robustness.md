---
"@reddoorla/maintenance": patch
---

fix(deps): the audit guards `JSON.parse` (a corrupt package.json now fails cleanly with a clear message) and skips non-semver specs (`*`, `latest`, `workspace:*`, `npm:`-aliases, git/URL) that previously parsed to NaN and produced bogus drift.
