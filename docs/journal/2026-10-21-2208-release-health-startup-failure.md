# 2026-10-21 — release-health: a startup_failure and a window of no verdicts are red

**Where it landed:** branch `claude/1614-release-health-startup`, closing #1614. Brief: the workspace's `briefs/2026-10-21-last-three-blind-gates.md`, from the P1-33 next-5 sweep (#1595).

**Why.** Guard 2 kept only `success`, `failure` and `timed_out` as verdicts. GitHub reports a release workflow it cannot start (an invalid file, a blocked action) as `startup_failure`, so `[startup_failure, success]` skipped past the newest run to an older success, wrote `RELEASE_STATE healthy=yes`, and closed "Release workflow is failing on main" while nothing could publish. A window of thirty cancelled runs read as "no decisive run, skipping guard 2", the same silence as an API error.

**What changed.** `startup_failure` is a verdict, and red. A window holding completed runs with no verdict in it is red too (`concl=no_verdict_in_<N>`), with its own error line; only an empty run list stays silent. One run cancelled by the concurrency group is still skipped past. An API error stays green, as `:125-132` decided, but now leaves a `::warning::` saying guard 2 was not judged, where before `|| true` left nothing.

**Known-good.** The real `release.yml` run list on main, read at about 3:07pm PT on 2026-10-21 (first 30 of 100; across the 100: 91 success, 5 cancelled, 3 failure, 1 in progress) through the changed step prints `success (a447663c…)`, `red=no`.

**Tests.** The `gh` stub now runs the step's own `--jq` over fixture JSON, so the filter itself is under test; before, the tests fed it the filter's output and never exercised it. Mutations: dropping `startup_failure`, dropping the no-verdict branch, and silencing the API warning each turn a test red.

**Not changed, by recommendation in the PR.** npm ahead of main (input 4) stays `behind=no`.
