---
"@reddoorla/maintenance": patch
---

The security audit reads a pnpm 12 lockfile with `pnpm audit`. GitHub's dependency graph cannot read a multi-document `pnpm-lock.yaml`, so Dependabot reported no alerts for those repos. The cockpit's Needs-you row for a broken site now also names its escalated vulns.
