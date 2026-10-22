---
"@reddoorla/maintenance": minor
---

A night the security audit's lockfile audit cannot run now writes exactly what a full night would on the same alerts (#1654). A full merged night stores pnpm's own result in a new `site_health` column, `security_lockfile_audit` ("Security lockfile audit", migration 0046): its per-severity counts and its advisories at pnpm's own severity, before the merge with Dependabot lifted any. When `pnpm audit` cannot run (a lockfile GitHub's dependency graph cannot read, or #1612's cross-check), the audit returns Dependabot's result marked partial, and the write rebuilds pnpm's result from the stored one and merges them with the same `mergeAudits` a full night uses. A partial night leaves `Last security audit at` and the stored result as they were. With no stored result it writes nothing, as before, unless the row was never audited and Dependabot has a live alert.
