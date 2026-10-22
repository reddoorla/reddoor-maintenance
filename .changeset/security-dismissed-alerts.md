---
"@reddoorla/maintenance": patch
---

An alert dismissed in Dependabot stays dismissed on the security audit's cross-check (#1659). When the cross-check (#1612) finds a live advisory in `pnpm audit`'s output, the audit reads the repo's dismissed and auto-dismissed Dependabot alerts and leaves out a pnpm advisory that a dismissal on a root lockfile, the root `package.json` or no manifest names: same package, and a GHSA on both sides or a CVE on both, never a title. Its count comes off as pnpm's own number of findings (one per installed version), and nothing comes off for an `info` advisory. The summary, or the run log when nothing live is left, says how many were left out. A dismissed list that cannot be read leaves nothing out, and `npm audit`'s answer is never thinned.
