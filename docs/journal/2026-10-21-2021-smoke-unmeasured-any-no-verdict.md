# 2026-10-21 — Any smoke result without a verdict is unmeasured

**Where it landed:** branch `claude/1611-smoke-unmeasured`, closing #1611. Brief: the workspace's `briefs/2026-10-21-write-gate-blind-spots.md`. It sits beside #1605's write gate (#1653).

**Why.** `isUnmeasuredSmoke` matched only the timeout's `smoke: NOT MEASURED` prefix. A `pnpm test:smoke` spawn that threw `EACCES` came back from `runOneAudit` as `smoke: unexpected error`, a fail with no details, so the site's prior verdict was kept. The nightly still printed `FLEET_SMOKE_UNMEASURED count=0`, `all 1 site(s) measured`, and exited 0.

**What changed.** The predicate is now the negation of `hasSmokeResult`, the write-back's own verdict test, so the CI line and the write gate cannot disagree. A site with no `test:smoke` script or no `package.json` is marked not applicable and does not count. An install that failed, `pnpm` missing, an unreadable `package.json`, a thrown spawn and a timeout all count.

**Known-good.** A reviewer read the last 40 fleet-smoke runs, 09-13 to 10-21. Every recorded row is `suite green` or `suite failed`, both carrying a verdict, so the new count would have been 0 on every night.

**The behaviour shift, stated.** One site whose deps will not install used to be a write-gate warning under #1605's 25% tolerance. Now it reds the smoke nightly at the never-measured check, every night it recurs. That is the zero-tolerance contract the timeout already had, and it is true: the row keeps serving its last, possibly green, verdict.

**Review.** Round 1's correctness lens was minors-only; the comments outside the diff are filed as #1658. Its test lens and round 2 both found the CLI call site unpinned, first for any result, then for skips. The `EACCES` case now runs through `runAuditCommand` with three sites: an `EACCES` fail, an install-failed skip and a passing suite. That output feeds fleet-smoke.yml's step.
