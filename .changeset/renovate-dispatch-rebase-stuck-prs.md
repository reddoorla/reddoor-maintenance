---
"@reddoorla/maintenance": minor
---

`renovate-dispatch` now re-triggers a repo whose open Renovate PR is stuck (conflicting), instead of skipping it.

The dedup guard previously skipped any repo with an open Renovate PR — which also skipped a PR that had gone **conflicting** (its branch fell behind the base after another PR merged the same lockfile), so a stalled security PR would wait for the weekly Renovate run to self-heal. Now the guard skips only a **healthy** (non-conflicting) open Renovate PR; a conflicting/stuck one is re-dispatched, which triggers Renovate to rebase it. `UNKNOWN` mergeability (GitHub still computing) is treated as healthy so we don't churn on uncertainty.

Adds `mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"` to `PullRequestSummary` (populated from the `openPullRequests` GraphQL query) and a `hasHealthyRenovatePr(prs)` helper that reuses the existing `isRenovatePR` classifier.
