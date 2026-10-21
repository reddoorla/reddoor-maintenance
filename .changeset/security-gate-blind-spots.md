---
"@reddoorla/maintenance": patch
---

The security gate's three blind spots (#1612). The security audit no longer believes a Dependabot answer with no live alert on a root lockfile (`pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`) without checking it: it runs `pnpm audit` on every scope, and when that finds a live advisory the two are merged as for a lockfile the dependency graph cannot read; when it finds none, Dependabot's answer stands; when it cannot run, the audit skips and writes nothing; a repo with no lockfile the audit can read keeps Dependabot's answer. `protection-audit` prints `PROTECTION_AUDIT_UNMEASURED` and exits 1 when it judged no repo (an org listing of `200 []`), instead of `PROTECTION_AUDIT gaps=0 … total=0`. fleet-security's renovate-dispatch step goes red on a missing summary or `failed>0`, and an unmeasured protection sweep reds the run without filing a posture issue.
