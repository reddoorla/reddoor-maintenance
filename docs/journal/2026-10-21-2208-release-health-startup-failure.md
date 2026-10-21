# 2026-10-21 — release-health: a startup_failure and a window of no verdicts are red

**Where it landed:** branch `claude/1614-release-health-startup`, closing #1614. Brief: the workspace's `briefs/2026-10-21-last-three-blind-gates.md`, from the P1-33 next-5 sweep (#1595).

**Why.** Guard 2 kept only `success`, `failure` and `timed_out` as verdicts. GitHub reports a release workflow it cannot start (an invalid file, a blocked action) as `startup_failure`, so `[startup_failure, success]` skipped past the newest run to an older success, wrote `RELEASE_STATE healthy=yes`, and closed "Release workflow is failing on main" while nothing could publish. A window of thirty cancelled runs read as "no decisive run, skipping guard 2".

**What changed.** `startup_failure` is a verdict, and red. A window holding completed runs with no verdict in it is red too (`concl=no_verdict_in_<N>`), with its own error line; only an empty run list stays silent. One run cancelled by the concurrency group is still skipped past. The issue it files now says which of the three findings it is, since a `startup_failure` run has no publish step to read and a window of cancellations has no failing run.

**Known-good.** The real `release.yml` run list on main, read at about 3:07pm PT on 2026-10-21 (first 30 of 100; across the 100: 91 success, 5 cancelled, 3 failure, 1 in progress) through the changed step prints `success (a447663c…)`, `red=no`.

**Tests.** The `gh` stub now runs the step's own `--jq` over fixture JSON, so the filter itself is under test; before, the tests fed it the filter's output and never exercised it. Mutations: dropping `startup_failure`, dropping the no-verdict branch, keeping gh's error JSON as the output (main's behaviour), and an issue body that ignores `startup_failure` each turn a test red. Review round 2 showed two tests passing vacuously down the API-error path (a broken filter reads `red=no` too); they now assert no warning.

**Belief corrected on contact: an API error was never green.** The step's comment, its tests and my first push all said a failed `gh api` left guard 2 silent. Review round 1 showed otherwise against the live API (gh 2.89, a 404): on an HTTP error `gh api` skips `--jq`, prints the error JSON to stdout and exits 1. `|| true` kept that JSON as the conclusion, so on main a 403 or 5xx would have filed "Release workflow is failing on main" with `{"message":…` as the failing run. The old stub printed nothing, which is why no test saw it. The step now tests the exit status, blanks the output and leaves a `::warning::` that guard 2 was not judged. The stub now does what gh does.

**Not changed, by recommendation in the PR.** npm ahead of main (input 4) stays `behind=no`.
