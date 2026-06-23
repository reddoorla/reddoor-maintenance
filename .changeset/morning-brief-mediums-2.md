---
"@reddoorla/maintenance": patch
---

More 2026-06-23 morning-review hardening:

- **fix(db):** `listNewSubmissions` now caps at 200 (matching `listSubmissionsForSite`). The cockpit loads this whole array on every render — unbounded, it deserialized every unread submission fleet-wide.
- **fix(db):** the `/submissions` text search now escapes LIKE metacharacters (`%`, `_`, `\`) with an `ESCAPE` clause, so a user's literal `john_doe` no longer also matches `johnXdoe` and a bare `%` no longer matches everything. (Already parameterized — this is a correctness fix, not an injection fix.)
- **fix(audits):** the `browser` audit's plain `fetch()`es (route-discovery GET + link HEAD/GET) now use `AbortSignal.timeout(10s)`, so a host that hangs without erroring can't stall the sequential fleet audit indefinitely. An abort degrades to the existing null/network-error path.
- **chore:** `release-health.yml` gains `timeout-minutes: 5` (a hung `npm view` would otherwise sit at GitHub's 6-hour default and, with `cancel-in-progress: false`, pin every later daily run). Added a `pretest` build step so local `pnpm test` runs the CLI tests against fresh `dist` rather than a stale build.
