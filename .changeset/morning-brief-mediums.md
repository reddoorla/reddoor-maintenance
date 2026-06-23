---
"@reddoorla/maintenance": patch
---

Harden four issues from the 2026-06-23 morning review:

- **fix(forms):** the timing-gate spam screen could be bypassed by a forged FUTURE timestamp. `elapsedMs` went negative, which the `>= 0` guard let skip the too-fast branch. `screenSubmission` now treats any numeric elapsed below `MIN_FILL_MS` (negatives included) as too-fast, and `elapsedMs` clamps at 0 (defense-in-depth).
- **fix(audits):** the domain audit now writes `Cert days remaining` unconditionally, so a DNS/cert failure CLEARS a stale value. Previously a stale non-null number survived next to a freshly-stamped "Domain checked at", false-passing the Domain/DNS/SSL auto-tick for a site that was actually down.
- **perf(db):** `openDb` migrations now run once per process per persistent database URL (a module-level cache), instead of two Turso round-trips on every warm Netlify invocation. `:memory:` is excluded (each is a fresh database), and a failed first run evicts the cache so the next call retries.
- **fix(github):** `secretExists` and `findOpenSelfUpdatingPR` now request `per_page=100` instead of the REST default of 30 — preventing a false secret-miss (needless overwrite) and a duplicate self-updating PR on repos with many secrets/open PRs.
