# 2026-10-21 — `main-gate` waits for the activity feed to reach the head before reading who pushed

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/main-gate-activity-retry`): the template, its runbook line, and a new test. The six staging-flow repos get the same file as one PR each into `staging`.

**The failure.** reddoorla/la-homelessness-initiative#65 is Renovate's vite 8.3.3 security patch into `main`, labelled `fast-track`. Both of its `main-gate` runs (39612092858, 39612092664) failed with `main-gate: could not read who pushed to renovate/main-npm-vite-vulnerability.` Renovate created the branch at 13:54:05Z, and the gate read `GET repos/…/activity?ref=refs/heads/<branch>` 22–24 seconds later. Read again at about 14:05Z, the same call returned `branch_creation reddoor-renovate[bot]`, and re-running both runs passed. reddoorla/data-dynamiq#79 runs the identical file and passed first time; its branch was created 3 seconds earlier. So this is a race, not a config difference. The activity feed is eventually consistent, and the gate failed closed on its first empty read. Renovate will not automerge a PR with a red check, so a security patch would have sat until someone re-ran the gate by hand.

**The first fix was unsafe, and review caught it.** The first version retried while the read was empty and trusted the first non-empty one. The adversarial review traced the hole. Renovate creates the branch, then a writer pushes a commit with the bot as author through `PUT contents`, so GitHub signs it. Then Renovate opens the PR. A feed that lags enough to come back empty can also come back with the creation and not yet the push. On that read the bot is the only pusher, and the gate passes. The original single read had the same hole if it happened to land in that window, and it also passed a feed with no `branch_creation` at all. The retry made it worse, because it waits for exactly the moment the feed starts filling. The test now carries that case, and the first fix fails it.

**The fix.** The step takes the PR's head SHA. It trusts the feed only once the newest entry's `after` is that SHA and the feed lists a `branch_creation`. Until then it reads again after 2, 4, 8, 16 and 30 seconds: six reads and 60 seconds of sleep at most. If the feed never gets there, the gate fails with the old message and the reason. A first read that is already there does not wait. The walk back to the latest `branch_creation` and the stranger-pusher check are unchanged. They read the activity through a here-string now, not `printf | awk`: with `pipefail`, an `awk` that exits early kills `printf` with SIGPIPE and aborts the step with no `::error::` line. Review guessed this starts at the 64 KB pipe buffer. Measured here, it never failed at 3,000 lines (about 180 KB) and always failed from 10,000 (about 600 KB). A branch with that much history is unlikely, but the here-string costs nothing. The first measurement was itself broken: it built the feed with `yes | head` inside the `pipefail` shell, so both arms died of SIGPIPE before the line under test ran.

**Measured against live data.** The fields the fix relies on are real. On both PRs, the newest entry's `after` is the head (`0379230` on reddoorla/la-homelessness-initiative#65, `3cac5c6` on reddoorla/data-dynamiq#79). The la-homelessness-initiative feed lists its `branch_creation` twice, which is one more sign the feed is not a clean log. The real step, run with the real `gh` against both PRs, printed the pass line on the first read. With a head SHA of forty zeros as the negative control, it read six times and failed closed.

**60 seconds is a guess, not a measurement.** The only data point is that the feed was empty at +24 s and full by about +11 min. If a lag longer than the 60 seconds turns up, the gate still fails closed, and the bound is one list in the template. A feed that is missing a middle entry while its newest is current would still get through. Nothing on record shows the feed does that, and no read of this API can tell.

**A run whose payload is stale now goes red.** Suppose Renovate rebases between the `opened` or `labeled` event and the read. The newest entry is then the new head, not the event's head, and that run fails after 60 s; the old gate passed it. The red lands on the superseded commit, and the `synchronize` run for the new head decides the check that matters. Re-running an old run after a rebase fails the same way, so re-run the newest one. Not yet seen live.

**Left for later:** reddoorla/reddoor-maintenance#1624. A failed `gh api` call still aborts with no `::error::` line, and the label check's `grep -q` can SIGPIPE. Both are older than this change and fail closed.

**The instrument passed known-good inputs before its failures counted.** `tests/scripts/main-gate.test.ts` runs the step's `run:` block byte for byte, with `gh` and `sleep` faked and each feed read scripted. On the unfixed template, the three known-good cases pass: a first read at the head, a branch someone else created, and a reused branch name. The other six fail: the four race cases, a 1.2 MB feed, and the check that `HEAD_SHA` comes from `pull_request.head.sha`. Review round 2 found those last two untested; they were added after it. Each mutation below turned at least one test red:

| Mutation                                          | Tests red |
| ------------------------------------------------- | --------- |
| The unfixed template (one read)                   | 6 of 9    |
| The first fix (retry only while empty)            | 4 of 9    |
| No head-SHA condition                             | 1 of 9    |
| No `branch_creation` condition                    | 1 of 9    |
| The final fail-closed removed                     | 2 of 9    |
| No `-` sentinel (five reads, a wasted last sleep) | 2 of 9    |
| One more 60 s wait                                | 2 of 9    |
| Never stop early on a good read                   | 3 of 9    |
| The stranger check removed                        | 2 of 9    |
| The walk goes past the latest `branch_creation`   | 2 of 9    |
| `printf \| awk` back in place of the here-string  | 1 of 9    |
| `HEAD_SHA` taken from `head.ref`                  | 1 of 9    |
