## 2026-10-08 — The nightlies get a clock: a conductor fired at 06:07Z, client sends at a fixed 16:07Z (#1259, `ecb945e`; P1-38, #1258)

The operator asked for the daily runs to be finished before he gets in, even on
east-coast time (12:00Z). They were finishing as late as 19:30Z.

**The cause is GitHub's `schedule` queue, and nothing else.** Read with
`gh api .../actions/workflows/<f>/runs?event=schedule` at 15:20Z, every nightly
was created 5–9 h after its cron minute. On 10-07 the lags were: backup 6h45,
drift 6h28, security 6h21, lighthouse 7h17, daily-reports 7h18, smoke 7h09.
The lag barely depends on the hour between 04:30Z and 14:30Z. It is shorter
only in the evening: forms-deadletter's 18:47Z slot lands 3–4 h late.

GitHub also drops scheduled runs. forms-deadletter went from four runs a day to
three. The control was a dispatch. pm-pass-watch with `dry_run=true`,
dispatched through the cloud proxy at 15:25:50Z, was created at 15:25:52Z, and
`return_run_details: true` returned its run id. So the queue delays only
`schedule` events. Moving the crons earlier (the brief's option c) would have
meant crons around 22:00Z the day before, still drifting.

**A finding the brief did not have:** on 10-07 `daily-reports` (16:41Z) ran
before `fleet-smoke` (17:09Z). The drafts were already reading day-old evidence
on the old schedule. The 3-day freshness gate tolerates that, so nothing flagged it.

**What was built.**

- `fleet-nightly` dispatches backup, prismic-drift, security, lighthouse,
  smoke and form-e2e in that order. Each one waits for the previous one to
  complete, within a budget. The pass ends with `daily-reports mode=draft`, so
  the drafts and the digest always follow fresh evidence.
- A Netlify scheduled function, `nightly-clock`, fires the conductor at
  06:07Z. It uses the dashboard's existing `GH_TOKEN`, which already
  dispatched report-rerender and refresh-fleet, so no secret was minted.
- `nightly-send-clock` fires `daily-reports mode=send` at 16:07Z (Operator
  decisions 98, answered (a)). Approving only sets a flag; the send step is
  what emails clients. So the run's time is the client send time, and it is
  now a fixed hour instead of whenever GitHub got round to it.
- The GitHub crons stay as fallbacks:
  - `fleet-nightly` at 02:17Z.
  - `daily-reports` at 13:23Z, send-only.

  Each fallback is gated so it cannot double up. If it has to do a clock's
  work, it fails its run on purpose with `clock-missed` /
  `send-clock-missed`, so a dead Netlify clock files an issue instead of
  hiding behind a late pass.

**Belief corrected on contact.** I assumed the external clock needed a new
token, which would make it 🔴. The dashboard's `refresh-fleet.mts` and
`report-rerender.mts` already dispatch Actions with `GH_TOKEN`, and the
recent report-rerender runs show tucksravin as the triggering actor. One file
read settled it.

**The review took three rounds, and each one earned its cost.**

- **Round 1** found the main defect: the conductor's "already ran today"
  guard counted any green conductor run. A partial `--only` run, a branch run
  or a skip run would have suppressed a whole night with nothing filed. The
  guard became per-nightly: a nightly is skipped only if github-actions[bot]
  already dispatched it on main within 12 h.
- **Round 2** found two behaviour defects in the `daily-reports` split.
  1. A green send run closed a failed draft run's issue.
  2. The send-only fallback emailed clients at whatever hour GitHub started
     it, which defeated the fixed hour.

  That made two dirty rounds, so the PR went to the operator as Operator
  decisions 99. He chose (b): fix, then a third round, and keep the fallback
  sending late (never early).

- **Round 3** found no blocker. Its minors were folded in:
  - a no-op fallback could still close a real send issue;
  - a fallback started after midnight needs yesterday's date;
  - "the clock missed" and "the send ran and failed" need different words;
  - a partial re-dispatch is not a missed clock.

Across the rounds, 55 mutations were run and 54 went red. The survivor
removed an in-code check that only repeated the query's `branch=main`, so the
check was deleted. The tests that mattered most execute the real step
scripts with fake `gh`, `node` and `date`. Regexes over YAML had passed a
guard that would never have run.

**Proved live after the merge (16:50:47Z).**

- **The Netlify deploy of `ecb945e` lists both schedules.** `function_schedules`
  shows `nightly-clock` `7 6 * * *` and `nightly-send-clock` `7 16 * * *`.
  This morning's deploy listed none.
- **The guard's actor is what the code expects.** The guard rests on
  `triggering_actor.login == "github-actions[bot]"`, which was untested. No
  run in this repo had ever been dispatched by GITHUB_TOKEN. A conductor
  dispatch at 16:51:23Z (`only=fleet-smoke`, `force`) started fleet-smoke
  run 37812065426 at 16:51:39Z with `triggering_actor` `github-actions[bot]`
  on `main`.

- **The whole proof run went green.** fleet-smoke succeeded in 24.3 min
  (17:15:37Z), and the conductor succeeded at 17:16:05Z with
  `NIGHTLY_CONDUCTOR_SUMMARY dispatched=1 completed=1 wait_exceeded=0
skipped=0 dispatch_failed=0 total=1`.
- **The guard's own query sees the right runs live.** Asked for runs on
  `main` by `github-actions[bot]` in the last 12 h, it returns 1 for
  fleet-smoke. The negative control, fleet-form-e2e, returns 0. Tomorrow's
  06:07Z pass is 13.3 h after 16:51Z, so smoke is not skipped.

**Still open.**

- **The clocks' first real fires** are 06:07Z and 16:07Z on 10-09.
- **Whether `fleet-prismic-sync` (`workflow_run`) still follows a drift run
  that GITHUB_TOKEN dispatched** is first readable on 10-09.
- **P1-38's done-when** is three consecutive days with every fleet nightly
  `completed_at` before 12:00Z: 10-09 to 10-11, read by the PM passes.

**10-08 is a transition day.** Its form-e2e and drafts do not run, because
their crons are gone and the conductor's first pass is 10-09 06:07Z. Nothing
was due: the pending drafts are already drafted. Today's 16:07Z send passed
before the deploy, so if GitHub starts the 13:23Z fallback after 16:37Z, it
will send any approved reports late and fail with `send-clock-missed`. That
opens "Daily reports run failing (send)" once, as designed. It closes on the
first green 16:07Z send.
