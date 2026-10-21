---
"@reddoorla/maintenance": patch
---

An alert dismissed in Dependabot stays dismissed on the security audit's cross-check (#1659). When the cross-check (#1612) finds an advisory in a lockfile the dependency graph can read, the audit reads the repo's dismissed and auto-dismissed Dependabot alerts and leaves out a `pnpm audit` advisory one of them names (same package, same GHSA or CVE), with its count; the summary says how many were left out. A dismissed list that cannot be read leaves nothing out.
