# 2026-10-21 — fleet-config-drift: a shrinking roster, a disabled Renovate job, a lost filing

**Where it landed:** branch `claude/1607-config-drift-blind`, closing #1607. Brief: the workspace's `briefs/2026-10-21-last-three-blind-gates.md`, from the P1-33 next-5 sweep (#1595).

**Why.** The sweep found three ways the weekly drift run read a bad week as green.

1. **The roster.** `selectFleetSites` visits only rows whose Status is in the vocabulary. With 3 of 4 rows on the retired `maintenance` (the restored-backup case `site-status.ts` names), the drifted repo among them, the run printed `drifted=0 clean=1 skipped=0 total=1` and passed.
2. **The Renovate job.** `renovateActionGaps` checks strings, so `if: false` on the job, with pins, auth and cron intact, read `CLEAN`.
3. **The filing.** `gh issue create` returning 502 under `continue-on-error` left the job green, and the drift appeared nowhere for a week.

**What changed.**

1. **The roster.** The selection rule itself is untouched: every fleet sweep shares it, and it is right not to visit a row whose Status it can't read. Instead `fromTursoDb` hands the dropped rows (`rowsWithUnrecognizedStatus`) to a callback, and `sync-configs` reports each as `SKIPPED <repo> status "maintenance" is not in the vocabulary…`. They now count toward `total`, keep a drift issue open, and past half the roster red the run through the gate that already existed.
2. **The Renovate job.** A constant-false `if:` on any job or step is a gap. That covers `false`, `0`, `''` and `null`, bare, quoted or in `${{ }}`. A real condition is still the site's business; the template carries none.
3. **The filing.** A last step reds the run, naming the drift, when the open step failed. It sits after the outage pair, so it files no false "sweep failing" issue. The open step now fails only when no issue could be created, since a missed comment on an open issue loses nothing.

**Known-good.** The 2026-10-18 run printed `drifted=15 clean=0 skipped=0 total=15`. I fetched those 15 repos' `renovate.yml` read-only (a sparse, shallow git clone of the one file). All 15 have 0 gaps under the new rule and carry no `if:` at all. Whether any production row sits on an unrecognized Status today needs a production read, which this session's permissions refused; the cockpit already shows such a row as a watch item.

**Tests.** The roster case runs the real `--fleet turso` path on a migrated `file:` database with pre-made checkouts. Mutations: `if: false` reading `CLEAN` again, the callback discarding the rows, the predicate never matching, dropping the last step, and a missed comment redding the step each turn a test red.
