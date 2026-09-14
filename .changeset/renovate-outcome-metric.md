---
"@reddoorla/maintenance": minor
---

protection-audit: measure whether Renovate updates are LANDING

The sweep's three Renovate surfaces ask whether the workflow ran, whether the
dashboard names a branch Renovate stopped managing, and whether that dashboard
still uses vocabulary we can parse. All three are green, all three are
literally correct, and none of them asks the only question that matters: did an
update arrive.

`renovateOutcome` measures days since the repo last MERGED a feature-update
Renovate PR, fed by one new read (`renovateMergeWindow` — a single
`pulls?state=closed&per_page=100` request per repo, so the metric costs one
call). `renovate/lock-file-maintenance` and `renovate/npm-*-vulnerability`
heads are excluded by name, because those two channels bypass the preset's
Monday window and kept flowing straight through the drought: 78 Renovate PRs
landed fleet-wide between 2026-08-31 and 2026-09-14, every one of them on those
two shapes. On the same frozen fixture, a naive "days since any renovate/\* PR"
finds 1 of 21 droughts; this finds 21 of 21.

It WARNS, it never gaps. The row carries the measurement, the CLI prints a
`WARN` line per affected repo plus a `RENOVATE_OUTCOME` summary, and neither
touches `gaps=`, `^GAP` or `^COVERED` — so a fleet that lands nothing for a
month can never open, hold open, or block the close of the posture tracking
issue. A test asserts a 62-day drought still leaves the row `covered`.

Both controls are frozen from real org data captured 2026-09-14 (all 242 merged
`renovate/*` heads on all 26 non-archived public repos), the historical one
being the same data filtered by merge date:

- FAIL, 2026-09-14: `RENOVATE_OUTCOME drought=21 delivering=0 unmeasured=5 threshold=21d`
- PASS, 2026-08-10: `RENOVATE_OUTCOME drought=0 delivering=20 unmeasured=6 threshold=21d`

21 days is justified from the gap between those populations, not chosen for
roundness: the worst repo while the channel was delivering sat 14 days, the
best repo today sits 32, and the band between them is empty. A 14-day threshold
would have warned on 2 of 20 repos during known-healthy operation, which is the
state in which a verdict is worth nothing. The control is re-asserted at
midnight and at end-of-day on 2026-08-10 so the result cannot ride on the hour
picked.

A repo with no feature merge in the window is `unmeasured`, never a drought,
and prints its reason every run: on a busy repo 100 closed PRs reach back under
a fortnight (`truncated`), and a repo that has never merged one has no elapsed
time to measure. "I could not measure this" must not render as "this is fine".
