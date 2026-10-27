# Morning brief — 2026-10-08 (scheduled PM pass, Thursday, 11:50Z)

## One-line verdict

**Nothing moved on the October Maintenance reports overnight. Four drafts are now three days late, and three of them still store best practices 78. P1-34 has been live since 16:24Z yesterday, and no refresh has been run. Press "refresh preview" on Data Dynamiq, Espada and Revogen, check for 100, then approve all four. Every scheduled run is green, no ask sits only on a branch, and no Discord ask is older than two days.**

This pass started at **11:50Z (04:50 PDT)** [M, `date -u`]. It covers #1228 (merged 10-07 12:04:39Z), through the 10-07 evening pass, to 10-08 ~12:00Z.

Clean [TEST] sends in a row: **0**. The bottom row, Vineyard (10-05), names the 78. No row is `awaiting`, so no [TEST] verdict is asked today [M, BACKLOG table].

Open asks: 21 (items 7, 13, 14, 15, 18, 31, 33, 45, 57, 61, 67, 72, 74, 78, 79, 81, 82, 87, 90, 91, 97); oldest: item 97, 610 h [I]. This is the first open-asks line. Item 97's age comes from the `asked 2026-09-13T01:21:28Z` written on its chores, not from the backlog's creation. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. The 10-07 report carried no line, so this one is checked against the two-week baseline (18 items at `6ea7c10`). Every baseline item is still present except **88**, which closed when its re-draft question was answered as item 91 (a) (#1229, P1-34 #1243). New since the baseline: 90, 91, 97 (#1249) and **7**. Item 7 (D0/D6/D7, via Tim) is counted because P0-5 still lists all three as open; the baseline left it out. It is the same ask as top of stack 2.

## Top of stack (yours; ordered by date)

1. **Due 10-05, three days late: four Maintenance drafts** (P0-4, item 91). All four are still pending approval, and none has an approve blocker [M, 11:53Z, SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports; `approveBlockers` control: Espada with recipients and contact blanked → `recipients-missing`]. No `report-rerender` run has been created since #1243 merged at 16:24Z [M, Actions API], and the workflow builds from `main`, so no release is needed.
   - **Data Dynamiq** (`report_01M46NNZ…`), **Espada** (`report_01M46NPA…`), **Revogen** (`report_01M46NQ1…`): each stores `bestPractices` 78, while `site_health.bp_score` reads 100 (fleet-lighthouse 10-07 15:37Z) [M]. Press "refresh preview" on `/s/data-dynamiq`, `/s/espada` and `/s/revogen`. After about two minutes, "draft preview ▸" should show 100, and the run log reads `scores_change=…bp:78→100`. Then approve. Each sends with the next `daily-reports` run.
   - The refresh takes all four live scores, so these move too [M, `site_health`]: Data Dynamiq stays 100/98/100/100; Espada's performance goes 93 → 100; Revogen's scores are unchanged apart from best practices (90/99/100/92).
   - **LA Homelessness Initiative** (`report_01M46NPK…`) stores 100. Approve on `/s/la-homelessness-initiative`.
   - Nothing else is due before 10-22. The next is ERP Industrials Maintenance on 10-25, then 1836dig on 10-31 and Sonder on 11-01 [M, `nextDueDate` over all 47 rows].
2. **Before cutover Wed 10-14: Williamson Construction (P0-5).** Tim's three facts are still open on `main`: **D0** (Webflow billing on 10-19), **D6** (who receives `/join-the-team`), and **D7** (who holds GoDaddy) [M, BACKLOG]. Six days to cutover.
3. **#1222, `sharp` 0.35.4 → 0.35.5 [security]** (GHSA-wq5f-xc86-pv6w). `build` is green on `3bd120cd` (20:22Z) [M]. GitHub had not computed `mergeable` at 11:54Z (`unknown`) [M]. The PR body says "Automerge: Disabled by config" [M], so the fleet preset is holding it. _Ask (open since 10-07):_ merge it.
4. **Release PR #1214, `chore(release): version packages`:** `build` green on `f7c4e8f3` (20:36Z), `clean` [M]. Open since 10-06 14:35Z (45 h). It carries P1-34, pm-pass-watch and the digest subject. Yours to merge, as always.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None older than two days [M, 11:56Z: 11 channels active in 14 days, 73 candidate mentions, 3 open. The open ones are Tim in #water-cooler (10-07, 17 h), Tim in #rd-marketing (10-06, 43 h) and Erik's thanks in #caltex (10-06, 38 h). None of them is an ask. Positive control: a 21-day window finds 19 channels and 6 open]. Yesterday's two Roalson lines from Erik are closed: the operator replied or reacted.

## What landed since the 10-07 morning report [M, pulls API]

20 PRs, all from the operator's sessions; the 10-07 evening section lists them. Since that section was written: **#1253** (the evening pass, 20:01Z) and **#1244** (P1-35, `scripts/pm-cockpit.mts`, 20:21Z, the first time this pass has run it). Nothing has merged since 20:21Z.

**Open PRs** [M, 11:54Z]: #1214 (release, green, clean) and #1222 (Renovate security, green, held by the preset). None is red or a draft.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-07T12:04:39Z`) [M]

`PM_COCKPIT_SUMMARY broken=0 watch=2 approval=2 sites=17 new=0`, `just_wait_left_out=1`.

- **Needs you:** Espada and Revogen, each "Maintenance 2026-10 ready" (ask 1).
- **Watch:** Data Dynamiq and LA Homelessness Initiative, each with "Maintenance 2026-10 ready" (ask 1) and "Search Console: no property matched (lookup 2026-10-05)".
- **Data Dynamiq's Watch line is stale, and it will stay that way for about a month.** Item 93 closed at 19:08Z yesterday, after the property was verified, and its journal says "the first nightly will record the stored outcome". That is not true. `site_health.search_console_outcome` is written only by `draftReport` (`src/reports/draft.ts:326-331`, via `lookupFields`). `daily-reports` skips a (site, type) already drafted this period (`src/cli/commands/report.ts:437-459`), and "refresh preview" runs the Search Console query but never writes the lookup back (`src/reports/send/rerender.ts:199-207`) [M, code read]. So the 10-05 `no-property` stays until November's draft. This is new item **P1-36**.
- **LAHI's `no-property` is unexplained.** No backlog item names it [M, grep]. It is not asked today, because it does not block LAHI's report [I].

## Nightlies (scheduled, created ≥ 10-07 12:00Z) [M, Actions API and job logs]

| Run | Created | Result |
| --- | --- | --- |
| daily-reports | 10-07 16:41Z | green: 0 drafted, Vineyard sent (delivered 16:42Z, at 78, as you chose), digest skipped (the 10-07 evening section) |
| fleet-smoke | 10-07 17:09Z | green, `wrote=15 failed=0 total=15` (the evening section) |
| fleet-form-e2e | 10-07 17:26Z | green, `wrote=15 failed=0 total=15` (the evening section) |
| release-health | 10-07 20:05Z | green (it was pending at the evening pass) |
| renovate | 17:59Z, 03:07Z | green |
| forms-deadletter-replay | 23:19Z, 06:41Z | green |
| pm-pass-watch | 02:15Z, 10:55Z | green |
| fleet-db-backup | 10-08 11:32Z | `DUMP_VERIFY loaded=true tables=11 rows=1132 blob_bytes=11433275 hashed=11 mismatches=0` |
| fleet-prismic-drift | 10-08 11:44Z | `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15` |
| fleet-prismic-sync (`workflow_run`) | 10-08 11:44Z | `PRISMIC_SYNC_SUMMARY sites=15 … in_sync=11 skipped=4 failed=0` |

Rows went from 1124 to 1132, and `blob_bytes` did not change. No "Nightly … failing" issue opened or closed [M, issues API].

**Pending at ~12:00Z (not yet created):** today's fleet-security, fleet-lighthouse, daily-reports, fleet-smoke, fleet-form-e2e and release-health, plus the later renovate and forms-deadletter-replay slots.

**Certificates (the 10-05 snapshot's "re-read on 10-08")** [M, `site_health.cert_days_remaining`, 17 rows]: Espada and Beachfront Dentistry have renewed (neither is under 35 days now). ERP Industrials reads **30** (33 on 10-05), so it has not renewed. Next lowest: Reddoor 52, Vineyard 54. Nothing is under 25, so there is no ask. Re-read ERP on Mon 10-12.

## Issues since the last report [M]

- Closed: #1236 (P1-34), #1241 (P1-35), #1246 (P1-33b).
- Still open: #1230 (P1-33a; its work landed in #1232) and #1231 (P1-33d; landed in #1235 and #1238). Neither was closed when its PR merged. They are left for P1-33's Monday step.
- Updated: #754 (posture floor) and #490 (Renovate dashboard).
- No new issue was opened.

## What went wrong, or nearly did

- **A day passed with P1-34 live and nothing pressed.** The refresh was the only thing between three late client reports and sending them. It was the evening section's first ask, and no `report-rerender` run exists [M]. This is the operator's click, not a defect. It is listed here because the reports are now three days late.
- **A belief written on 10-07 is wrong:** "the first nightly will record the stored [Search Console] outcome" (journal `2026-10-07-1908`). No nightly writes it (P1-36). That journal entry is left as it is. This report is the correction.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=1 stale=1 stale_fresh=0 scanned=1 older_skipped=37` [M, 11:52Z]. The one branch pushed in the last 7 days without a merged PR is `claude/jolly-keller-9h8tzh` (82 h, known residue, not asked again). No `claude/*` or `fix/*` branch has a commit in the last 24 h. No ask sits only on a branch.

## Next for agents

**P1-33 is parked until Mon 10-12**, by your 10-07 call to save usage. Ready today, all small:

- **P1-36 (new): the Search Console lookup outcome refreshes outside a draft.** The brief is below.
- **P1-31:** the `contrast-unmeasured` remedy. Its _Verify_ was re-run this morning and is unchanged (`unparseableColourRemedy` at `src/audits/util/contrast-unmeasured.ts:86`, the `none` branch at 89–90). Yesterday's brief stands as written.
- **#1148:** form-e2e waits for hydration. Its _Verify_ was re-run and is unchanged (`goto` 643, `fillAll` 928, inject 938, `refilled` 981, no `data-hydrated`). Yesterday's brief stands as written.

**Not ready:** item 87 (dead letters; your pick).

### Briefs

```markdown
## Worker brief — P1-36: "refresh preview" writes the Search Console lookup back to `site_health`

**Item.** P1-36 · no issue yet (open one) · 🟡 YELLOW (behaviour change → 3-lens review) · effort S
Data Dynamiq's Search Console property was verified on 10-07 19:08Z (Operator
decisions 93), but the cockpit's Watch still reads "no property matched
(lookup 2026-10-05)". `site_health.search_console_outcome` and
`search_console_checked_at` are written only by `draftReport`
(`lookupFields`), and `daily-reports` never re-drafts a period that is
already drafted. So a fixed property shows as broken until the next
period's draft, about a month later. "Refresh preview" already runs the
draft's Search Console query for an unapproved report on an enrolled site,
but it drops the lookup result.

**Verify first.** `grep -n 'lookupFields\|searchConsoleLookupFields' -r src --include=*.ts`
Expect: `lookupFields` defined at `src/reports/draft.ts:478`, called only at `:331`.
`searchConsoleLookupFields` is defined at `src/fleet/site-fields.ts:532` and
used only by `draft.ts`. There are no hits in `src/reports/send/rerender.ts`
[M, 2026-10-08 ~12:00Z]. Then, with a SELECT-only client: Data Dynamiq's
`site_health.search_console_outcome` is `no-property`, checked 2026-10-05.

**Start here.**

- `src/reports/send/rerender.ts:199-207`: `measureSearch`, and the dep at `:45-51`
- `src/reports/draft.ts:326-331`: the draft's own write (`analyticsHealthFields` + `lookupFields`) is the pattern to follow
- `src/fleet/site-fields.ts:523-538`: `SearchConsoleLookupWriteback`
- `tests/reports/send/rerender.test.ts`

**Done when.** A refresh whose Search Console lookup ran writes the three
lookup cells (`outcome`, `resolved`, `checked_at`) to the site's
`site_health`, the same way the draft does. A refresh where the lookup did
not run (no credentials, not enrolled, an approved report) writes nothing.
Both are pinned by tests. The `REPORT_RERENDER` line names the outcome. After
it lands, the operator's refresh on `/s/data-dynamiq` (ask 1 of the
2026-10-08 report) clears its Watch line. If it lands after that refresh, one
more refresh clears it.

**Mutations I will run** (each must turn a test red):

1. Skip the write-back (today's behaviour).
2. Write back when the lookup did not run, which erases the stored outcome with nulls.
3. Write back for an approved report.
4. Write the outcome but not `checked_at`.

**Stop conditions** (beyond AUTONOMY.md's six):

- If the rerender workflow has no Turso write path for `site_health` and adding one widens its permissions, stop and ask under Operator decisions.
- Do not write to Data Dynamiq's row by hand.
- Two dirty review rounds → "Operator decisions", landed on `main` as a docs-only PR, not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` → Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim an issue. Worktree from `origin/main`. Red test first.
3. `pnpm lint`, `pnpm typecheck`, the changed tests, a changeset, the 3-lens review, the mutations table in the PR body.
4. Move P1-36 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry as a new file in `docs/journal/`, landed before the session ends.
```

## Evening

**Headline: Espada, LA Homelessness Initiative and Revogen went out at 16:40Z. Data Dynamiq is the one draft left: it was refreshed at 18:52Z (best practices 78 → 100, Search Console lookup resolved) and still waits on your approve.**

This pass started at **19:49Z (12:49 PDT)** [M, `date -u`]. `<since>` is #1254's `merged_at`, 2026-10-08T12:06:26Z [M, pulls API].

### Asks (ordered by date)

1. **Due 10-05: approve Data Dynamiq on `/s/data-dynamiq`; it sends with tomorrow's 16:07Z run.** `report-rerender` run 37827548693 (18:52Z) printed `scores=refreshed scores_change=bp:78→100 lookup=resolved` for `report_01M46NNZ…` [M, job log]. The cockpit lists it as the only approval: `Maintenance 2026-10 ready` [M, `pm-cockpit.mts`]. No preflight warning.
2. **Since 10-06: release PR #1214** (`chore(release): version packages`). `build` green at 19:22Z, `clean` [M]. Yours to merge, as always.
3. **Since 10-06: #1222, `sharp` 0.35.5 [security].** `build` green on `7d7fd12a` at 15:46Z; `mergeable_state` still `unknown` [M]. The fleet preset holds it ("Automerge: Disabled by config"), so this is a rule working. _Ask:_ merge it.
4. **From #1275 (open, green, `clean`, 19:32Z):** its item 81 line says the Dropbox file request `jh6y6vw6vpc8u4ip4a71` is still open. _Ask:_ close it under Dropbox → File requests. This line is on the PR's branch only; it reaches `main` when #1275 lands [M, `evening-branches.mjs`].

### Evidence

**Branches** [M]: `EVENING_BRANCHES_SUMMARY main_decision_lines=114 asks=0 decision_lines=2 stale=1 stale_fresh=0 scanned=2 older_skipped=37`. The 114 lines added to "Operator decisions" on `main` today are items 98, 99 and 100 and the Roalson status lines under items 81 and 83, and every one carries its `**Answered 2026-10-08 (AskUserQuestion)**` line: 98 (a), built in #1259; 99 (a), #1264; 100 (a), built in #1270. No new open ask. No ask sits only on a branch. Older unprotected residue: `claude/jolly-keller-9h8tzh` (90 h, no PR).

**Nightlies** (non-PR runs created ≥ 10-07 19:50Z) [M, Actions API and job logs]:

| Run | Created | Result |
| --- | --- | --- |
| release-health | 10-07 20:05Z | green |
| forms-deadletter-replay | 23:19Z, 06:41Z, 14:04Z | green |
| pm-pass-watch | 02:15Z, 10:55Z (+15:25Z dispatch) | green |
| renovate | 03:07Z, 18:02Z | green |
| fleet-db-backup | 11:32Z | green (morning section) |
| fleet-prismic-drift / -sync | 11:44Z | green (morning section) |
| fleet-security | 12:30Z | green |
| fleet-lighthouse | 15:20Z | green |
| daily-reports (`schedule`) | 16:38Z | green: 0 drafted (4 already drafted 2026-10), **sent Espada, LAHI, Revogen** at 16:40Z, digest skipped ("unchanged since 2026-10-05; 1 items") |
| fleet-nightly (dispatched by tucksravin) | 16:51Z | green, `NIGHTLY_CONDUCTOR_SUMMARY dispatched=1 completed=1 … total=1` (fleet-smoke only) |
| fleet-smoke | 16:51Z | green |
| report-rerender | 15:03Z, 15:05Z, 15:10Z, 18:51Z | green: Espada `p:93→100,bp:78→100`; Revogen `bp:78→100`; Data Dynamiq `scores=locked` at 15:10Z, then `bp:78→100 lookup=resolved` at 18:51Z |

- **fleet-form-e2e did not run in the 24 h.** Its last run is 10-07 17:26Z [M]. #1259 (16:50Z) moved it from its own `schedule` to the conductor, and the hand-dispatched 16:51Z conductor ran smoke only. The first full conductor run is tonight's (06:07Z Netlify clock or 02:17Z cron) [I, from P1-38's done-when "reads 10-09 to 10-11"].
- No 16:07Z `send` run exists yet: the send clock went live with #1259 after today's 16:07Z. Today's sends came from the old `schedule` run at 16:38Z [M].
- No tracking issue opened or closed since `<since>` [M, issues API].

**Merged since `<since>`** (17, all tucksravin) [M]: #1255, #1256, #1260, #1263, #1267, #1265, #1266 (docs); #1259 P1-38 conductor + 16:07Z send; #1264 P1-37 spam pass; #1269, #1271, #1272, #1273 (docs/journal); #1270 unapprove + send claim; #1268 P1-36 lookup write-back; #1274 refresh beside Unapprove. Issues #1257, #1258, #1261, #1262 closed with them.

**Open PRs** [M]: #1214 (release, green, clean), #1222 (Renovate security, green, preset-held), #1275 (docs, green, clean, 19:32Z). None red, none a draft.

**Cockpit** [M]: `PM_COCKPIT_SUMMARY broken=0 watch=1 approval=1 sites=17 new=0`. Data Dynamiq's stale `no-property` from the morning is gone (P1-36, #1268). LA Homelessness Initiative still shows `no property matched www.lahomelessnessawareness.org (lookup 2026-10-05)`; its report sent today, so the next draft's lookup replaces it.
