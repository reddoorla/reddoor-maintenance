# 2026-10-24 — #1622 before Monday, then the 10-22 review minors

Landed: #1705 (#1622), #1707 (#1692, #1701, #1702), #1708 (#1690), #1706 (#1698), #1709 (#1700). #1703 closed as accepted. Brief: the home base's `briefs/2026-10-24-review-minor-batch.md`. Two operator decisions, both answered at 8:15am PT: `decisions/2026-10-24-1452-form-e2e-unreadable-health-in-the-write-gate.md` (b) and `decisions/2026-10-24-1508-cockpit-own-posts-freshness-notice.md` (a).

**#1622 landed first, with about 44 hours to spare.** The hold on it was a 10-20 branch, `claude/od137-seeded-one-defect` (5b04ef1e). It had no PR in an 800-PR listing that did find #1699 and #1627, and the 10-20 17:51 journal entry calls it superseded. I reproduced the failure locally at `REDDOOR_TIME_TRAVEL_DAYS=90`: 1 failed, 50 passed, `expected null to be 'log:failed'`. Stamping from `vi.getRealSystemTime()` gave 51/51 on the real clock and at +90. `REDDOOR_TIME_TRAVEL_DAYS=0` prints "no tests", which is the shim's guard refusing a zero shift, not a pass. The Actions time-travel run at +90 on the fix branch, 40101889612, went green: its log shows `REDDOOR_TIME_TRAVEL_DAYS: 90`, `pnpm-update.test.ts` at 51 tests, and 667 files passed. #1705 merged at 7:35am PT Saturday, ahead of the 4:00am PT Monday run.

**#1698 took five review rounds and an operator decision. The bug was never the hard part.** The verdict fix was one line: the unreadable-/health skip stops writing `turnstileWidget: null`. But a site that writes nothing had no true place in the shared #1605 write gate:

- Round 1 put it under "not applicable".
- Round 2 tried "failed". That crossed `fleet-form-e2e.yml`'s "refused probes are a warning, deliberately never a threshold": four /health timeouts in 13 would red the nightly. It also made the workflow's `unreadable` grep count one site twice ("2 of 8").
- Round 3 showed that "not applicable" reds an all-unreadable night as "every one of 8 site(s) was not applicable". On `main` that night reds as "probed no site … 8 unreadable", which names the cause.

The operator chose a fourth bucket, `kept`. Round 4 then found a 7-unreadable + 1-throw night reding as "wrote 0 of 8", which the workflow reads as a Turso outage. Round 5 was clean: it ran eight mixed nights through the real audit, writer and workflow script, and found no false line.

The belief corrected here: I took round 1's "not applicable" minor to be a defect of mine, and fixed it by moving the site into "failed". That fix crossed a threshold policy written down in the workflow, in a file I had not read. Before reclassifying anything that a shared gate counts, read every consumer's comment about what it may red on.

**#1700's first design was unsafe, and the review proved it, not a test.** Reading the counter on the client before each POST meant every save waited on a round trip. A click that unloaded the page in that window stranded the save silently. The operator chose (a): the counter rides in the POST's answer. It went into `endpoint()` in `route.ts`, around every `/api` handler, rather than the auth hook the decision named, because that is narrower. Three more rounds found interleavings that exact-match chaining missed:

- (41,42) and (41,43): both posts read before either wrote.
- (41,43), (42,44), (42,44): a before-value that exists only inside another post's run.
- a check in flight when a post starts.

The working rule: each pair covers the values its handler's run spanned, and a pair links when its before-value falls inside the range already covered.

**Measured on contact:**

- `AbortSignal.timeout` does not fire under Vitest's fake timers: the #1701 test stayed red with it. A plain `setTimeout` plus `AbortController` replaced it.
- A libsql local-file connection that saw `DROP TABLE cockpit_version` keeps failing after the table is recreated, even on new SQL text, while a fresh connection works (@libsql/client 0.8.1). The runbook says to redeploy; a remote connection is not measured.
- There are 33 `ADD COLUMN` migrations, not the 37 I first wrote: I had counted grep lines.
- The first #1690 splitter stripped strings before comments, so `-- it's here` opened a fake string literal that hid a two-statement migration.

**Defects of my own that CI caught:** two runbook citation shifts (`continuity.md` by +4, `turnstile-widgets.md` by +13). I had run each PR's changed tests but not `tests/docs`. I ran it on every PR after the first one went red.

Filed, not fixed: #1710 (a legacy null-stamp "fail" could page forever), #1716 (the single-site CLI says "Wrote" when it wrote nothing), #1717 (kept sites in the 25% denominator, and the order of red reasons), #1718 (one discard clause is untested).
