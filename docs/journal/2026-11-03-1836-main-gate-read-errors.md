# 2026-11-03 — `main-gate` names a failed read and retries a transient one (#1624)

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/main-gate-read-errors`): the template, a runbook paragraph, and 16 new tests. The workspace journal holds the outcome of each fleet repo's PR into `staging`.

**Why.** `docs/runbooks/staging-flow/main-gate.yml` runs under `set -euo pipefail`. A 5xx or rate-limit error on any of its five `gh api` reads ended the step through `set -e`. `gh`'s own line was left in the log, but there was no `::error::` annotation and no retry, so a GitHub hiccup turned a Renovate patch's required check red with nothing on the PR saying why. The labels read was worse: it sat inside `if ! gh api … | grep -qxF`, so a failed read was reported as "has no 'fast-track' label … Majors and everything else target staging". That is a wrong reason, not a missing one. The same `grep -q` pipe could also SIGPIPE its writer under `pipefail`. Every one of these faults failed closed.

**The fix.** Each read goes through one `api <what> <gh api args>` function that sets `$out`. A 5xx, a 429, a 403 whose text says "rate limit", or a failure with no HTTP status at all is read again after 2, 8 and 30 s. Any other failure, or a fourth, prints `::error::main-gate: could not read <what>: HTTP 502 after 4 tries. gh said: …` and exits. The function is called bare, never inside `$(…)`, so its `exit 1` ends the step and its `::error::` reaches stdout. The activity feed's own lag loop (2–30 s, #1625) was not reused for errors: it answers a different question, a read that worked but is not yet complete, so the error retry sits inside each read. `local wait` keeps the helper from clobbering that loop's variable. A mutation that drops it turns two tests red. The labels and events reads now use here-strings.

**The instrument lied once.** The SIGPIPE test, with 1.2 MB of labels after `fast-track`, passed on the unfixed template. The `gh` stub ran `cat` and then `exit 0`. `cat` did die of SIGPIPE, but the stub script carried on and exited 0, so `pipefail` saw success. Real `gh` is the process that dies on EPIPE. With the labels branch changed to `exec cat`, the test went red on the unfixed template and green on the fix. Review then pointed out that the labels read is unpaginated, so no real answer is that long: the test guards the pattern, not a failure seen live.

**Measured.** 25 tests: 9 old, 16 new. On the unfixed template, 14 of the new tests failed (after the stub fix, 15); the "no label" case passed. On the fix, 25 of 25 passed five runs out of five. Every one of the twelve named mutations turned at least one test red:

| Mutation                                          | Tests red |
| ------------------------------------------------- | --------- |
| Drop the read-failure `::error::` line            | 9 of 25   |
| No retry (one try)                                | 12 of 25  |
| Retry runs once (two tries)                       | 11 of 25  |
| `grep -q` pipe restored on the labels read        | 3 of 25   |
| Every failure retried (404 too)                   | 1 of 25   |
| A rate-limit 403 not retried                      | 1 of 25   |
| A 5xx not retried                                 | 10 of 25  |
| No-status failure not retried                     | 1 of 25   |
| HTTP status left out of the message               | 8 of 25   |
| `local wait` dropped (clobbers the activity loop) | 2 of 25   |
| Events read back to a bare `gh api \| tail` pipe  | 1 of 25   |
| gh's own message left out                         | 1 of 25   |

**Against live data.** I ran the fixed step's `run:` block with the real `gh`, through the cloud proxy, against reddoorla/la-homelessness-initiative#71, an open Renovate patch on `main`. It printed the pass line on the first read and exited 0. As a negative control, the same run with `PR=999999` printed `::error::main-gate: could not read the commits of #999999: HTTP 404 after 1 try. gh said: gh: Not Found (HTTP 404)` and exited 1 without retrying. So real `gh` output has the `HTTP nnn` shape the helper parses.

**Review.** Round 1 (Opus) found minors only, so the round counted as clean. Folded into this PR:

- the runbook now says what the old failure actually looked like;
- `\r` is stripped from gh's text, and it is cut by character with `cut -c`, not by byte with `head -c`;
- "could not read the commits/files" became "came back empty", since a failed read now has its own line;
- the worst case is now stated: about five minutes if every activity read fails.

Filed as reddoorla/reddoor-maintenance#1897:

- a jq or auth error has no HTTP status, so it is retried for 40 s and reported as "no HTTP status";
- missing tests, chief among them one pinning that a failed read's stdout (real gh writes the error body there) is never used.

**Belief corrected: the fleet was not on one template.** I expected every staging-flow repo to carry the #1625 file. Read from `raw.githubusercontent.com` on `main` and `staging`, 15 non-archived repos carry `main-gate.yml`, the same on both branches (the API blob SHAs on `staging` agree). 9 match the pre-change template byte for byte. Six carry the copy from before #1625, with no activity-feed retry: mantis-landscaping, beachfront-dentistry, 29-navy, gallerysonder, la-homelessness-youth and alamo-anatomy. Nothing in maintenance installs the file; workers copy it by hand. Copying the new template verbatim into those six brings #1625's retry with it. Code search found only 3 of the 15, because it reads default branches in the repos this session's grant indexes, so it was not an inventory.

Usage: $3.18, 597/34562 tokens, 5673377/203145 cache, rate limit allowed
