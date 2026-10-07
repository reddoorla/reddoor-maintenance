## 2026-10-07 — CI's browser install retries a stalled apt mirror, inside timeouts sized from 200 green runs

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

**The first version's own CI run hung the same way, and the timeout caught
it.** The PR's first push (`39e78fc`, run 37671088157) entered the install at
19:00:09Z. Its log shows `--with-deps` running `apt-get update`. The Microsoft
repo came back in under a second. `http://azure.archive.ubuntu.com` returned
`Ign` for every InRelease, `https://archive.ubuntu.com` answered, and then
`Ign:10 http://azure.archive.ubuntu.com/ubuntu noble-updates/main amd64
Packages` at 19:00:28 was the last line. The next line, at 19:15:22, is
`has timed out after 15 minutes`. So the instrument passed its first live
test. It also showed that a timeout alone turns a mirror stall into a red PR,
and two stalls in an hour (18:07Z and 19:00Z) is not rare enough to leave to
a manual re-run. 37664193452's log cannot be read while it runs, so it is not
yet known whether it stalled on the same mirror.

So the step now makes up to three attempts, each under `timeout 300`. GNU
`timeout` signals its whole process group, and a local check left no orphaned
children, so a killed attempt should not hold the dpkg lock against the next.
On GitHub that is untested. Of the 200 green runs, two would have reached a
second attempt (335 s and 571 s), and none would have failed. Three
5-minute attempts need a 20-minute step limit, and the job limit rises to 35
minutes to keep about 15 minutes above the slowest green job minus its
install.

**What a hang costs now.** A stall in one install attempt costs 5 minutes and a retry. Three stalls
fail the step at 15 to 20 minutes, where it used to run for six hours. A
hang in any later step fails at 35. Either way the
outcome is `failure`, not a stuck `in_progress`, so `land-prs.mjs` sees a red
check rather than waiting out its own 20-minute limit.

**What this does not show.** The retry path has not run on GitHub. A green run on
this PR shows only that the first attempt usually finishes in time. Whether a
second attempt recovers from a real stall will show the next time the Azure
mirror stalls; a `::warning::` annotation marks every retry.
