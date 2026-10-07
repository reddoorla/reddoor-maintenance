## 2026-10-07 — CI's build job and its browser install get timeouts, sized from 200 green runs

Run 37664193452 (#1232, head `3bc310a`) entered "Install the browser the Tier 4
abort harness drives" at 18:07:21Z and never left it. It was still
`in_progress` at 18:55Z by `date -u` beside the API read, about 48 minutes in
a step whose median is 26 seconds. `land-prs.mjs` gave up at 20 minutes. #1232
landed only because it had fallen behind `main`, and the update-branch gave
it a fresh head with its own run. Neither the step nor the `build` job had a
`timeout-minutes`, so a hang like this holds a runner until GitHub's 6-hour
default.

The numbers come from the 200 most recent successful CI runs, which cover
2026-10-06 01:19Z through 2026-10-07 18:36Z. Each was read through
`actions/runs/<id>/jobs`, taking the step's and the job's `started_at` and
`completed_at`.

- Browser install: min 19 s, median 26 s, p95 61 s, top five 139, 279, 282,
  335 and **571 s**. The 571 s run was green. A tight timeout of 2 or 5 minutes
  would have failed it and four others, so the step gets **15 minutes**,
  about 1.6× the slowest green run.
- `build` job: min 320 s, median 453 s, p95 743 s, slowest **958 s** (the same
  run as the 571 s install). The job gets **30 minutes**, about 1.9× that.

**What a hang costs now.** A hang in the install fails at 15 minutes, where it
used to run for six hours. A hang in any later step fails at 30. Either way the
outcome is `failure`, not a stuck `in_progress`, so `land-prs.mjs` sees a red
check rather than waiting out its own 20-minute limit.

**What this does not show.** Nothing here proves why the install hung.
`--with-deps` runs `apt-get`, and a mirror stall is the likeliest cause, but
the step's log was never read and that cause is a guess. A timeout firing on a
real hang has also not been seen yet. The PR's own green run proves only that
the limits do not cut short a normal run, which is the known-good half of the
check.
