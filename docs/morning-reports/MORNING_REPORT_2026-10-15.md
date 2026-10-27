# Morning brief — 2026-10-15 (PM pass, Thursday, 11:49Z)

## One-line verdict

**All eight nightlies finished green by 07:15Z, and P1-50's fix is proven (protection gaps back to 13). Both Williamson sites now read READY 8/8 on `launch-check`, so the one thing left there is yours: run `launch` on each and approve the two go-live emails. New today: ERP Industrials has three high `devalue` advisories whose fix Renovate already built but never opened as a PR. One tick on its Dependency Dashboard clears them before the 10-25 report.**

This pass started at **11:49Z (04:49 PDT, Thursday)** [M, `date -u`]. It covers the time from #1367 (merged 10-14 12:06:49Z) to now. It is a weekday pass, so there was no re-rank.

Open asks: 19 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 82, 87, 97, 120, 121, 123, 126); oldest: item 97, ≥ 778 h (97(a), asked 2026-09-13T01:21:28Z) [M]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, item 3 is absent, and all 17 items on the 10-14 line are still present. Two items are new:

- **123:** answered 10-14. Your last step, `launch` and the approvals, is still open.
- **126:** new today (ask 2).

Two more opened and closed between the passes, so neither is on the line:

- **124:** MSOT `/privacy`, landed 10-14 (`6df3025`).
- **125:** alamo#81, which you merged ~23:15Z. This PR adds its `Closed` line.

## Top of stack (yours; ordered by date)

1. **Today, Thu 10-15: launch both Williamson sites (item 123(f)).**
   - **Run:** `reddoor-maint launch williamson-construction-co` and `reddoor-maint launch williamson-homes`, then approve both go-live emails.
   - **Why now:** `launch-check` reads **READY, 8/8 `ok`** on both [M, 11:57Z]. #29 and #39 are merged and live: `ga-tag` loads `G-70PDG1RJBG` and `G-21KD0G311C`, and `/privacy` answers 200 on both `www` hosts. Both rows are still `building` [M, SELECT].
   - **If not yet done:** the live `/join-the-team` test. Construction has a second stored submission (10-14 14:12:11Z, `inquiry`, notify `sent`) [M], but nothing records whether that was the live test [I].
2. **NEW, by Thu 10-22: on `/s/erp-industrials`, clear three high `devalue` advisories (item 126).**
   - **Do:** tick "chore(deps): lock file maintenance" under "Awaiting Schedule" on erp-industrial#41.
   - **Why:** Renovate's `renovate/lock-file-maintenance` branch (10-12 03:25Z) already moves `devalue` from 5.9.2 to 5.9.4, and all six advisories are patched at `>=5.9.3` [M, `pnpm audit`]. No PR was ever opened from it [M].
   - **Effect:** once you tick it, Renovate opens the PR, and the preset automerges it on green to `main` (production).
   - **Not the fix:** #60 (all non-major, green, `clean`) is held by the `@reddoorla/maintenance` `automerge: false` rule. Its lockfile still carries `devalue@5.9.2`, so merging it alone would not clear the advisories [M].
3. **Fri 10-16: the Williamson verifier run** (`node scripts/williamson-cutover-verify.mjs`).
4. **Mon 10-19: the Williamson verifier again, then D0** (Webflow billing). Remove the domains from Webflow only after that run.
5. **Before Fri 10-23 (item 121):**
   - Add `RESEND_API_KEY` and `OPERATOR_EMAIL` to reddoor-workspace's Actions.
   - Read the staged `CLAUDE.md` (workspace `cutover/claude-md`).
6. **Item 120, the Roalson packages: now with Erik and the client.**
   - **New, 10-14 14:18Z** [M, `#roalson-interests`]: Erik made global edits to the PDFs himself. He is "awaiting their approval to upload the current PDFs to the Roalson site".
   - **What it means:** the next step is his word that the client approved. The files to publish are his edited set [I]. Nothing is yours until then.
   - **Chore:** close the Dropbox file request "Roalson packages - Oct 2026 sign-off". It was not re-read today.

Reports: none needs approval. The next one due is ERP Industrials Maintenance on **10-25**. It has no draft yet, and `approveBlockers` finds nothing [M]. Ask 2 is what keeps its security section clean.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None. 12 channels were active in the last 14 days. They held 58 candidate mentions, and 3 are open [M, 11:56Z]. All 3 are older than two days and none is a real ask: Erik's Zoom check-in (10-08), Tim's post on scheduling social posts (10-06), and Erik's "Happy writing" (10-06).

**Positive control:** 54 mentions were closed by a later post from you and 1 by your reaction. No channel answered 403. Your last post was 10-14 23:16Z in #revogen.

## Projects

1. **Williamson Construction**: READY 8/8 and still `building` [M]. Next: ask 1 (`launch` today), then the 10-16 and 10-19 verifier runs and D0 (yours). DNS is unchanged: `www` is a CNAME to `williamson-construction-co.netlify.app`, with no Webflow marker [M].
2. **Williamson Homes**: the same as Construction: READY 8/8, still `building`, and `www` a CNAME to `williamson-homes.netlify.app` [M].
3. **Mantis Landscaping**: the P1-47 fix reached production through mantis#55 (10-14). mantislandscaping.com still serves Blux [M], because DNS (61.2) and the matching gate (78) are unchanged.
4. **Roalson Interests**: Erik edited the packages himself and is waiting on the client's approval to upload them (item 120) [M].
5. **CalTex**: no change [M].
6. **Gift of Life Alliance (GOLA)**: no change [M].
7. **Alamo Anatomy and Hedloc**: alamo#81 is merged, so the preview exit stays put in production (P1-47 closed) [M, per its Done entry]. Hedloc: no change [M].

## What landed since the 10-14 report [M, `git log origin/main`, 12 commits]

- **Code:**
  - #1368: P1-50, `branchTip` reads a 422 "No commit found" as no branch. It is proven by tonight's audit.
  - #1370: the kit peer widened to `^2 || ^3` (P1-47).
  - #1377: `launch-check` and the site-launch runbook (P1-51).
  - Releases #1352 and #1371.
- **Docs:** #1378, #1380 to #1385 (no #1379, an issue). These cover Operator decisions 123 to 125, the Williamson GA4 and Search Console wiring, MSOT `/privacy`, Revogen's PDF links opening in a new window, and P1-47 live on all four Prismic sites (LHY has no Prismic).
- **In client repos:** P1-47 in four repos (vida#109/#111, mantis#52/#55, alamo#79/#81/#83, gallerysonder#125/#128), williamson-homes#39, williamson-construction-co#29, and medical-solutions-of-texas#81.

**Open PRs here** [M, 11:52Z]: only #1347 and #1342, the P1-33 cutover drafts ("do not land before 10-23"). No release PR is open.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-14T12:06:49Z`) [M]

`PM_COCKPIT_SUMMARY broken=0 watch=1 approval=0 sites=17 new=1`, `just_wait_left_out=1`. The script refused an UPDATE first.

- **Needs you:** none. Vida's "1 Renovate PR failing CI" alarm from 10-14 has cleared.
- **Watch:** NEW ERP Industrials, "3 critical/high vulns — transitive-only, still present after the 2026-10-12 lockfile window (escalated 2026-10-14)" (ask 2).

**Reports due in the next 14 days** [M, a SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports]:

- ERP Industrials Maintenance on 10-25, with no draft yet.
- The one unsent row is Vida's withdrawn 2026-09 draft (item 41).
- **Control:** `approveBlockers` on Espada, with its To, Cc and point of contact blanked, returns `recipients-missing`. As it is, it returns nothing.

## Nightlies (created ≥ 10-14 12:00Z) [M, Actions API and job logs]

Every scheduled and dispatched run in the window concluded `success`. None is pending.

| Night | Conductor (06:07Z clock) | Summary | Last completion | Fallback cron |
| --- | --- | --- | --- | --- |
| 10-15 | 38690535273 | `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8` | ~07:15Z (daily-reports, 1 min) | 07:28Z, `skipped=8` |

- **fleet-db-backup:** `DUMP_VERIFY loaded=true tables=11 rows=1190 … mismatches=0`. Rows went from 1181 to 1190.
- **fleet-prismic-drift:** `wrote=15 failed=0`.
- **fleet-prismic-sync:** `in_sync=11 skipped=4 failed=0`.
- **fleet-security:** `wrote=15 failed=0`.
  - **`PROTECTION_AUDIT gaps=13`, down from 15.** The log has no `probe failed` and no `422` line, so **P1-50 is proven** [M].
  - `PACKAGE_MANAGER_PIN gaps=5` is unchanged.
- **fleet-lighthouse:** `wrote=15` and `wrote=23`, both with `failed=0`.
- **fleet-smoke:** `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`.
- **fleet-form-e2e:** `wrote=15 failed=0`.
- **daily-reports draft:** "No reports due". `DIGEST_STATE_WRITE turso=1 rollup=1` and `DIGEST_SEND_LOG write=1 decision=added`. "added" is the ERP Watch item.
- **Sends:** the 10-14 16:07:06Z send found "No reports ready to send". Its 18:03Z fallback logged "a send run succeeded since 2026-10-14 (1), so the fallback sends nothing". There was no `clock-missed`, `send-clock-missed` or `send-run-failed`.
- **Also green:** release-health (10-14 18:48Z), renovate ×2, pm-pass-watch ×3 and forms-deadletter-replay ×3.

**Tracking issues:** #754 was updated by the bot (06:16Z, gaps=13). No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Closed:**
  - #1369 (P1-47);
  - #1376 (MSOT privacy).
- **Opened:**
  - #1372 (P1-51);
  - #1373 to #1375 (launch-check minors);
  - #1379 (`analytics-tag` refuses a site whose doc comment mentions `initAnalytics`).
  - All of them have 0 comments.
- **Updated:** #754 (bot).

## What went wrong, or nearly did

- **Renovate built ERP's security fix and never opened it.** The lock-file branch from the 10-12 Monday window resolves `devalue@5.9.4`, but no PR exists, and the Dashboard shows it "Awaiting Schedule".
  - **Likely cause [I]:** the preset combines `prCreation: not-pending` with a `before 6pm on monday` window, so a branch whose checks are still pending when the window closes waits a week. This was not read in Renovate's log.
  - **Next:** P1-52 checks whether other repos show the same thing.
  - **Why it surfaced:** the cockpit's lockfile-window escalation did its job.
- **The unprotected branch `claude/p1-45-kit3-sync`** (WIP, 10-12) is still there, now 70 h old, in the `older` group. Say it can go.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=1 stale=1 stale_fresh=0 scanned=3 older_skipped=38` [M, 11:55Z]. No ask sits only on a branch. The one decision line is #1347's staged cutover stub.

## Next for agents

**Ready today:** P1-52, the cause of ERP's missing lock-file PR and whether it is fleet-wide. It is read-only until it proposes a preset change. Brief below.

**Held:**

- P1-51's last step, on ask 1;
- P1-46, on Erik and the client;
- the P1-33 cutover, until 10-23;
- williamson-construction-co's kit 3 migration, until after 10-19 [I].

### Briefs

```markdown
## Worker brief — P1-52: Renovate's lock-file maintenance made a branch but no PR (erp-industrial)

**Item.** P1-52 · reddoorla/reddoor-maintenance (finding), reddoorla/.github (any preset change) · 🟡 YELLOW · effort S
The cockpit's Watch lists ERP Industrials NEW: three high `devalue`
advisories (dependabot #67, #69, #71; six in all), every one `<=5.9.2`,
patched `>=5.9.3` [M, `pnpm audit` on `main`'s lockfile, 2026-10-15].
`main` resolves `devalue@5.9.2` through `@sveltejs/kit@2.70.3` (range
`^5.8.1`). `renovate/lock-file-maintenance` (`adcdce11`, 2026-10-12
03:25Z) resolves only `devalue@5.9.4`, but no PR was opened from it (the
last is #57, merged 09-14), and erp-industrial#41 lists it under "Awaiting
Schedule". The preset `reddoorla/.github:renovate-config` sets
`prCreation: not-pending`, `internalChecksFilter: strict`,
`minimumReleaseAge: 1 day` and `lockFileMaintenance.schedule:
before 6pm on monday` (UTC), with `automerge: true`. Operator decisions
126 asks the operator to tick the Dashboard box; this brief is the cause.

**Verify first.**
`gh api repos/reddoorla/erp-industrial/issues/41 --jq .body | grep -n lock-file-maintenance`
Expect: the line sits under "Awaiting Schedule" [M]. If a lock-file PR
now exists (the operator ticked it), keep going: the cause is still open.

**Start here.**

- The preset: `renovate-config.json` in reddoorla/.github (`prCreation`,
  `lockFileMaintenance`, `schedule`).
- The Renovate run that touched erp-industrial on 2026-10-12 (the renovate
  workflow in reddoorla/.github or this repo's `renovate` runs). Find the
  branch's "pending" or "not creating PR" lines.
- Every fleet repo's Dependency Dashboard: list each repo whose
  `renovate/lock-file-maintenance` branch exists with no open PR.

**Done when.**

1. The cause is named with a log line or a reproduced config, not
   inferred. If the guess (checks pending past the window under
   `not-pending`) is wrong, say what it is.
2. A table of fleet repos with the same branch-but-no-PR state.
3. If it is fleet-wide or recurs: a proposed preset change (for example
   `prCreation: immediate` for `lockFileMaintenance` only), as a PR in
   reddoorla/.github with a dry-run or config-validator proof. Do not
   merge a preset change: a fleet-wide preset is the operator's (🔴).
4. A journal entry and the P1-52 row moved or updated, landed here via
   `node scripts/land-prs.mjs`.

**Mutations I will run** (a config claim needs a negative control):

1. If you reproduce with `renovate --dry-run` or the config validator,
   flip `prCreation` back and show the PR is not created.

**Stop conditions** (beyond AUTONOMY.md's six):

- Never tick Dashboard boxes or merge Renovate PRs in client repos: that
  is item 126, the operator's.
- No push to any client repo.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean (file the minors as issues).
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** Check fresh `claude/*` and `fix/*` branches first. Use a
worktree. Attach erp-industrial and .github with `add_repo` before any
`gh api` call.
```
