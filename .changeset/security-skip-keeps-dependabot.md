---
"@reddoorla/maintenance": patch
---

When a site's lockfile is hidden from GitHub's dependency graph (pnpm 12) and `pnpm audit` cannot run, the security audit still skips and writes nothing, but its summary now names Dependabot's live alerts ("not written: Dependabot: 1 alert(s) (1C/0H/0M/0L), …"), so the run log no longer hides them (#1561). The merged audit also records on each advisory whether the lockfile audit reported it (`lockfile`), and the row now persists each advisory's GHSA, for the follow-up that writes such nights once pnpm's own counts are stored.
