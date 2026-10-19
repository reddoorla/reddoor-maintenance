# Morning brief — 2026-10-19 (PM pass, Monday, 11:49Z)

## One-line verdict

**All 32 nightlies over four nights were green, but the fleet's Renovate is not delivering three things: SvelteKit 3 reached eight more maintained repos overnight (9 sites red in the cockpit, NEW), no lock-file maintenance PR has opened in any of the 15 maintained repos since 09-15, and 36 green `sharp` security PRs (High) have waited up to 13 days for your merge with no alarm. Today is also the Williamson verifier run and D0, and both sites still need `launch`.**

This pass started at **11:49Z (04:49 PDT, Monday)** [M, `date -u`]. It covers the time from #1386 (merged 10-15 12:10:20Z) to now. It is the Monday pass: the fleet snapshot was re-read from Turso, P1 was re-ranked from scratch, the project repos were read, and the week's claims and `CLAUDE.md` were checked.

Open asks: 20 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 82, 87, 97, 120, 121, 123, 126, 129); oldest: item 97, ≥ 874 h (97(a), asked 2026-09-13T01:21:28Z) [M]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, item 3 is absent, and all 19 items on the 10-15 line are still present. One is new: **129** (the `sharp` merges). Items 127 and 128 opened and closed on 10-16 (#1388, #1395), so neither is on the line.

## Top of stack (yours; ordered by date)

1. **Today, Mon 10-19: the Williamson verifier, then D0.**
   - **Run:** `node scripts/williamson-cutover-verify.mjs`, then cancel Webflow billing (D0). Remove the domains from Webflow only after that run.
   - **State:** neither repo has a commit since 10-14 20:55Z, and #williamson has had no message since the 10-15 report [M].
2. **Overdue since Thu 10-15: launch both Williamson sites (item 123(f)).**
   - **Run:** `reddoor-maint launch williamson-construction-co` and `reddoor-maint launch williamson-homes`, then approve both go-live emails.
   - **Why:** both rows are still `building` [M, SELECT, 11:55Z]. `launch-check` read READY 8/8 on both on 10-15 [M then]; it was not re-run today.
3. **NEW: merge the `sharp` 0.35.5 security PRs (item 129).**
   - **What:** 36 PRs in 15 repos, all green, none merged [M, check-runs on each head]. The advisory is GHSA-wq5f-xc86-pv6w, CVSS 8.9 High. The oldest are from 10-06.
   - **Why it is yours:** the preset's rule that `sharp` never automerges without a human and a green Netlify preview. The PR body reads "Automerge: Disabled by config". The rule is working; nothing told you.
   - **The `main` pairs:** 29-navy #76/#77, beachfront-dentistry #85/#86, caltex-landing #77/#78, espada #81/#82, medical-solutions-of-texas #74/#75, revogen #93/#94, vineyard-custom-homes #74/#75, williamson-construction-co #25/#26, williamson-homes #37/#38, roalson-interests #267 (dependabot's #290 is the same bump), gallerysonder #121/#122, vida-legacy-foundation #105/#106, mantis-landscaping #48/#49, alamo-anatomy #75/#76. The `staging` copies ride each repo's next promotion.
4. **By Thu 10-22: on `/s/erp-industrials`, tick the lock-file box (item 126).**
   - **Do:** on erp-industrial#41, tick "chore(deps): lock file maintenance". It now sits under **Pending Status Checks** (it was under Awaiting Schedule last week) [M].
   - **Why it will not happen by itself:** Renovate rebuilt the branch at 02:30Z today (`e5095848`), and it has **no check runs** [M], so `prCreation: not-pending` holds it. P1-52 found this is fleet-wide (see "What went wrong").
   - **Effect:** the PR opens and automerges on green to production; it clears the three high `devalue` advisories before the 10-25 report drafts.
5. **Before Fri 10-23 (item 121):**
   - Add `RESEND_API_KEY` and `OPERATOR_EMAIL` to reddoor-workspace's Actions.
   - Read the staged `CLAUDE.md` (workspace `cutover/claude-md`).
   - **New:** both cutover drafts here, #1347 and #1342, now read `dirty` against `main`, and #1347's `build` check is red [M]. They need `main` merged in before the window.
6. **Item 120, the Roalson packages:** no change. #roalson-interests has had no message since the 10-15 report [M]. The next step is still Erik's word that the client approved.

Reports: none needs approval. Due in the next 14 days: ERP Industrials Maintenance on **10-25** and 1836dig Maintenance on **10-31**, neither drafted, and `approveBlockers` finds nothing for either [M].

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

Nothing needs an answer. 12 channels were active in the last 14 days. They held 54 candidate mentions, and 7 are open [M, 11:55Z]. All 7 are older than two days:

- **#crca, 10-15 22:20Z, Nicole:** she shared her CRCA assessment notes with you as a Dropbox link. It is an FYI, not a question.
- **#crca, 10-15 20:00Z and 10-16 15:22Z, Tim:** a bare ping, then "I will load everything here shortly".
- **Not asks:** Tim's "Thank you sir!" (#water-cooler, 10-16), Erik's Zoom check-in (10-08), Tim's note on scheduled drafts (#rd-marketing, 10-06) and Erik's "Happy writing" (#caltex, 10-06).

**Positive control:** 47 mentions were closed by a later post from you. No channel answered 403. Your last post was 10-16 16:19Z in #water-cooler. This read checked reactions only on the mentions no post had closed, and found none from you.

## Projects

1. **Williamson Construction**: still `building` [M]. Next: today's verifier run and D0, then `launch` (asks 1 and 2, yours). No commit since #29 (10-14). Its kit 3 pair (#27/#28, red since 10-12) and `sharp` pair (#25/#26) are open [M, repo read].
2. **Williamson Homes**: the same as Construction. Its adapter 7 PR (#40, red) and `sharp` pair (#37/#38) are open [M].
3. **Mantis Landscaping**: no code change since mantis#55 (10-14). Its `sharp` pairs on `main` (#48/#49) and `staging` (#50/#51) are open [M]. mantislandscaping.com still waits on DNS (61.2) and the matching gate (78) [I, not re-read].
4. **Roalson Interests**: roalson-interests#302 (10-16) removed the old Dropbox uploader. The packages are still with Erik and the client (item 120) [M].
5. **CalTex**: no code change since 10-06. Its kit 3 pair (#79/#80) opened red today, and its `sharp` pair (#77/#78) has waited since 10-06 [M]. No #caltex message [M].
6. **Gift of Life Alliance (GOLA)**: no change. It has no site row and no repo to read; #gift-of-life-alliance has no message since the 10-15 report [M].
7. **Alamo Anatomy and Hedloc**: Alamo has no code change since alamo#81 (10-14); its `sharp` pairs (#75/#76 on `main`) are open [M]. Hedloc: hedloc#53 (the Prismic CLI move, yours, green) has been open since 10-04 [M].

The Monday heavy read reached every project repo through `add_repo`. The Deployments API answered empty for all ten repos read, so the last production deploy comes from Turso: the newest `last_deploy_at` on any row is 10-15 17:20Z [M].

## What landed since the 10-15 report [M, `git log origin/main`, 5 commits]

- **Code:** #1388 (`scripts/dropbox.mjs`, the Dropbox API uploader, Operator decisions 127) and #1395 (the file-request uploader as its fallback, 128).
- **Docs:** #1387, #1389 and #1402.
- **In client repos:** roalson-interests#302.

`main` has had no commit since 10-16 23:50Z.

**Open PRs here** [M, 11:56Z]: only #1347 and #1342, the P1-33 cutover drafts. Both now read `dirty`, and #1347's `build` is red. No release PR is open.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-15T12:10:20Z`) [M]

`PM_COCKPIT_SUMMARY broken=9 watch=1 approval=0 sites=17 new=9`, `just_wait_left_out=0`. The script refused an UPDATE first.

- **Needs you, all NEW 10-19:** 1836dig, 29 Navy, Beachfront Dentistry, CalTex, Data Dynamiq, Espada, LA Homelessness Initiative and Reddoor, each "2 Renovate PRs failing CI". This is the kit 3 / adapter 7 pair, which is P1-53's work, not yours, until each promotion PR opens. The ninth is Vida, "1 Renovate PR failing CI": its vitest 5 PR (#112), whose three red `main-gate` runs date from 10-13/14 when it targeted `main`. That alarm is stale, not a new failure [M, job timestamps].
- **Watch:** ERP Industrials, the three high `devalue` advisories (ask 4).

## Nightlies (created ≥ 10-15 12:00Z) [M, Actions API and job logs]

Every scheduled and dispatched run in the window concluded `success` (93 runs). None is pending except the weekly `time-travel` (Mondays 11:00Z cron, not yet started; its last run was 10-12 20:05Z).

| Night | Conductor (06:07Z clock) | Summary | daily-reports finished | Fallback cron |
| --- | --- | --- | --- | --- |
| 10-16 | 38859404969 | `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8` | 07:06Z | 07:12Z, `skipped=8` |
| 10-17 | 39008723356 | the same | 07:11Z | 06:58Z, `skipped=8` |
| 10-18 | 39102902938 | the same | 07:09Z | 07:14Z, `skipped=8` |
| 10-19 | 39208070672 | the same | 07:12Z | 07:48Z, `skipped=8` |

- **No `clock-missed` line on any night.** The only hits for the phrase are the workflow's own script text.
- **Every night, the same lines:**
  - fleet-prismic-drift `wrote=15 failed=0`;
  - fleet-prismic-sync `in_sync=11 skipped=4 failed=0`;
  - fleet-security `wrote=15 failed=0`, `PROTECTION_AUDIT gaps=13`, `PACKAGE_MANAGER_PIN gaps=5`;
  - fleet-lighthouse `wrote=15` and `wrote=23`, both `failed=0`;
  - fleet-smoke `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`;
  - fleet-form-e2e `wrote=15 failed=0`.
- **fleet-db-backup:** `DUMP_VERIFY … mismatches=0` each night, with rows 1173, 1177, 1183 and 1189. That is down from 1190 on 10-15; the drop of 17 on 10-16 was not read [I: a prune].
- **daily-reports draft:** "No reports due" each night, `DIGEST_STATE_WRITE turso=1 rollup=1`. `DIGEST_SEND_LOG decision=added` on 10-17 and 10-19, `unchanged` on 10-16 and 10-18.
- **Sends:** every 16:07Z send (10-15 to 10-18) found "No reports ready to send". Each fallback logged that a send run had already succeeded, except 10-17's, which ran before 16:37Z and deferred to the clock. There was no `send-clock-missed` or `send-run-failed`.
- **Weekly:** `fleet-config-drift` (10-18 12:06Z) green, with `SYNC_CONFIGS_DRIFT drifted=15 clean=0 total=15`, the same as the week before. Its issue, #1007, stays open.
- **Also green:** release-health ×4, renovate ×8, pm-pass-watch ×16, forms-deadletter-replay ×16.

**Tracking issues:** #754 was updated by the bot on 10-16 to 10-19 (gaps=13 each time), and #1007 on 10-18. No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Opened:** #1390 to #1394 (the `dropbox.mjs` review minors) and #1396 to #1401 (the file-request uploader's minors), all 10-16, all with 0 comments.
- **Closed:** none.
- **Updated by bots only:** #754, #1007 and #490.

**All open issues (the Monday read):** 44. Of those, 3 are trackers (#1007, #754 and #490), 28 are review-minor spill from 10-13 to 10-16, and 13 are older human-filed items. No human has commented on any issue since the 10-15 report.

## What went wrong, or nearly did

- **Lock-file maintenance has stopped fleet-wide (P1-52, re-ranked first).**
  - **The finding [M]:** all 15 maintained repos have a `renovate/lock-file-maintenance` branch and no lock-file PR. The newest merged one is MSOT#65 (09-15). 29-navy and vida-legacy-foundation have never had one.
  - **Effect:** transitive-vuln cleanup rides on these PRs, so it has been off for five Mondays. ERP is just where it first reached the cockpit.
  - **Likely cause:** the preset's own 2026-09-21 note (`reddoorla/.github` `renovate-config.json:11`) says a lock-file branch carries no stability status and falls through to the 25 h `prNotPendingHours` timeout, "which the grouped branch, rebased every Monday inside an 18-hour window, never reaches". That day's `internalChecksAsSuccess` fix works through the stability status, which a lock-file branch does not have [I that this is the whole cause; the zero check runs on ERP's branch are M].
  - **Next:** the P1-52 brief below.
- **36 security PRs waited 13 days and no alarm said so (P1-54).** The hold is a rule working (`sharp` never automerges). What failed is the instrument: no `sharp` advisory appears anywhere in the cockpit.
- **SvelteKit 3 reached eight more maintained repos at 02:43–04:23Z (P1-53).** It was expected: plan §4 step 5 is "as Renovate reaches it". Each pair is red for the 10-12 reasons. Read on 1836dig: kit 3 refuses `svelte.config.js`, and adapter 7 throws in `adapt` on kit 2.
- **The unprotected branch `claude/p1-45-kit3-sync`** (WIP, 10-12, 166 h) is still there, now `older`. Say it can go.

## Refute the week's claims

Ten claims from the 10-12 to 10-15 reports and the 10-12 journal went through `refute-claims` against `main` at `040f5dc1`. Each had one Opus skeptic, and a critic followed. The guard read HEAD = origin/main = `040f5dc1`. The claims file is in the session log (`.session-logs/refute-claims-2026-10-19.json`), which is not committed.

**Result: 6 confirmed, 1 refuted, 3 untested, and 2 of the 3 then measured.**

- **Refuted:** the 10-13 report's "`@reddoorla/maintenance` peers kit `^2.0.0`" (`package.json:104-106`). It was true when written, and #1370 (10-14) widened it to `^2.0.0 || ^3.0.0`. This PR adds a forward pointer to the 10-13 report.
- **Confirmed:**
  - #1370's widened peer;
  - #1377's `launch-check` and runbook;
  - the Routine prompt's "once a day";
  - the staging-flow patch's path;
  - the conductor's order of eight;
  - the 02:17Z fallback cron.
- **Untested, then measured this morning:**
  - c08, the send fallback's "a send run succeeded since … so the fallback sends nothing". All four fallback runs from 10-15 to 10-18 printed it (one deferred before 16:37Z instead).
  - c05, `branchTip` reading a 422 as no branch. GitHub answered a missing branch with `422 "No commit found for SHA"`, the exact text `src/github/gh.ts:954` matches.
- **Still untested:** c10, `analytics-tag` refusing a kit 3 site. The branch is at `src/recipes/analytics-tag/index.ts:313`; the round's fixture experiment was not run.

## `CLAUDE.md` fact-check

**CLAUDE.md fact-check: head `040f5dc1`, 8 lines: 7 confirmed, 0 refuted, 1 untested.**

- **Range:** from the last check's head, `8602f123`. There are 92 added lines from #1300, #1305, #1312, #1362, #1363, #1388 and #1395. The next check lists from `040f5dc1`.
- **Confirmed:**
  - **`scripts/dropbox.mjs` has `check` and `upload`** (`scripts/dropbox.mjs:76`, `:80`).
  - **The fallback script and its runbook exist.**
  - **"The connector writes only text":** the Dropbox MCP server's own instructions list binary upload as unsupported.
  - **The model rule "sat on an unmerged branch … from 2026-09-30 until 2026-10-13":** the branch commit is 09-30 21:35Z, and #1362 merged 10-13 21:59Z.
  - **R8's "16 of 17 verdicts … 2.3 times faster":** `docs/workJournal.md:3200` has 317 s against 737 s. The numbers are in the journal, though, not in the spec `CLAUDE.md` cites, which holds only R8's plan.
  - **"Five dirty rounds since 2026-10-12":** item 107's `Closed 2026-10-12` line.
  - **The 2026-10-13 archive-line quote:** `docs/journal/2026-10-13-2157-archive-line-two-answers.md:7`.
- **Untested:** "One session in that gap ran about 330 agents". No second authority was found on disk.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=1 stale=1 stale_fresh=0 scanned=3 older_skipped=38` [M, 11:56Z]. No ask sits only on a branch. The one decision line is #1347's staged cutover stub. No `claude/*` or `fix/*` branch here is under a day old.

## Next for agents

**Ready today, in rank order:**

1. P1-52: lock-file maintenance, now fleet-wide. It is read-only until it proposes a preset PR.
2. P1-53: kit 3 on the eight newly red repos, one repo at a time, onto `staging`.
3. P1-54: why a held security PR never reaches the cockpit.

**Held:**

- P1-51's last step, on ask 2;
- P1-46, on Erik and the client;
- the P1-33 cutover, until 10-23;
- williamson-construction-co's kit 3 migration, until after today's D0 (116(b)).

### Briefs

```markdown
## Worker brief — P1-52: lock-file maintenance opens no PR anywhere in the fleet

**Item.** P1-52 · reddoorla/reddoor-maintenance (finding), reddoorla/.github (any preset change) · 🟡 YELLOW · effort S–M
All 15 maintained repos have a `renovate/lock-file-maintenance` branch and
no lock-file PR; the newest merged one is medical-solutions-of-texas#65
(2026-09-15), and 29-navy and vida-legacy-foundation never had one [M,
2026-10-19, `pulls?state=all&head=reddoorla:renovate/lock-file-maintenance`].
erp-industrial's branch (`e5095848`, rebuilt 2026-10-19 02:30Z) has zero
check runs and a combined status of `pending` with no contexts [M], and
erp-industrial#41 lists it under "Pending Status Checks". The preset
(`reddoorla/.github` `renovate-config.json`, `b3e549e`) sets
`prCreation: not-pending` (line 22) and `lockFileMaintenance.schedule:
before 6pm on monday` (line 24). Its own 2026-09-21 note (line 11) says a
lock-file branch "carries no stability status, and so falls through to the
25-hour `prNotPendingHours` timeout, which the grouped branch, rebased every
Monday inside an 18-hour window, never reaches". The likely cause is that
path [I]. ERP's three high `devalue` advisories (Operator decisions 126) are
the visible cost.

**Verify first.**
`for r in erp-industrial espada vida-legacy-foundation; do gh api "repos/reddoorla/$r/pulls?state=open&head=reddoorla:renovate/lock-file-maintenance" --jq length; done`
Expect: `0` three times. Attach each repo with `add_repo` (push) first, or
the API answers 403. If the operator has ticked ERP's box, ERP shows 1:
keep going, since the cause is still open.

**Start here.**

- `reddoorla/.github` `renovate-config.json:10-11` (the `prCreation` notes),
  `:22` (`prCreation`), `:24-30` (`lockFileMaintenance`).
- `docs/patches/2026-09-29-github-renovate-grouped-pr-immediate.patch` in
  this repo: an earlier proposal of the same shape for grouped PRs.
- The Renovate runs that touched a fleet repo on 2026-10-19 (`renovate` in
  reddoorla/.github or this repo's `renovate` workflow runs at 00:00Z and
  12:00Z). Look for the lock-file branch's "pending" or "not creating PR"
  lines. Debug logging may be needed.

**Done when.**

1. The cause is named with a Renovate log line or a reproduced config, not
   inferred. If the `prNotPendingHours` path is wrong, say what it is.
2. A proposed preset change (for example `prCreation: "immediate"` inside
   `lockFileMaintenance` only) is open as a PR in reddoorla/.github, with
   proof from `renovate --dry-run=full` or a one-repo `extends` trial that a
   lock-file PR now opens, plus the preset's `validate.yml` green. Do not
   merge it: a fleet-wide preset is the operator's (🔴). Put the merge under
   "Operator decisions".
3. A journal entry, and the P1-52 row updated, landed here with
   `node scripts/land-prs.mjs`.

**Mutations I will run** (a config claim needs a negative control):

1. With the change reverted, the same dry run or trial shows no lock-file
   PR.
2. The change does not alter `prCreation` for any other update type (diff
   the dry run's PR list with and without it).

**Stop conditions** (beyond AUTONOMY.md's six):

- Never tick Dashboard boxes or merge Renovate PRs in client repos: that is
  item 126, the operator's.
- No push to any client repo's default branch. A one-repo trial goes on a
  branch with a draft PR, and only if the dry run cannot answer.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean (file the minors as issues).
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** As in the template. Check fresh `claude/*` and `fix/*`
branches first. Use a worktree.
```

```markdown
## Worker brief — P1-53: SvelteKit 3 and adapter-netlify 7 on the eight newly red repos

**Item.** P1-53 · reddoorla/reddoor-maintenance (backlog), one client repo per PR · 🟡 YELLOW · effort M per repo
Renovate opened the kit 3 / adapter 7 pair on 2026-10-19 02:43–04:23Z in
1836dig (#27/#28), 29-navy (#79/#80), beachfront-dentistry (#87/#88),
caltex-landing (#79/#80), data-dynamiq (#64/#65), espada (#83/#84),
la-homelessness-initiative (#51/#52) and reddoor-website (#262/#263, base
`staging`) [M]. All are red: on 1836dig the kit 3 PR stops at `prepare` with
`config_file_unsupported`, and the adapter 7 PR throws
`Cannot read properties of undefined (reading 'assets')` on kit 2.70.3 [M,
job logs 117888579144 and 117888559443]. Plan §4 step 5 covers it, and
Operator decisions 113's answer sets the flow: each migration lands on that
repo's `staging`, workers merge into `staging` on green, only the operator
promotes.

**Verify first.** `pnpm tsx scripts/pm-cockpit.mts`
Expect: eight sites with "2 Renovate PRs failing CI". Vida's one is a stale
`main-gate` failure on its vitest 5 PR, not this item.

**Start here.**

- `docs/sveltekit-3-migration-2026-10.md:15` (§1, what kit 3 changes),
  `:53` (§2, where each config key moves), `:112-147` (§4, the order and the
  env-var note).
- `docs/runbooks/staging-flow.md:54` (the order) and `:112` (promotion):
  cutting `staging`, `main-gate`, and the rulesets the operator creates
  before a promotion merges.
- reddoor-starter#187 (the starter-shaped diff), and vida#100,
  la-homelessness-youth#32, gallerysonder#116 and alamo-anatomy#70 (the
  factory-shaped ones), as worked examples.
- `src/recipes/analytics-tag/index.ts:313`: `analytics-tag` refuses a kit 3
  site, so check each repo's GA tag is already in before migrating it.

**Done when.** For each repo, one at a time: a migration PR on its
`staging` replaces its Renovate pair (close both as superseded), `ci` and
`@smoke` on staging match production, `/health` is identical, and a
promotion PR is open for the operator with any ruleset command in its body.
Start with 1836dig (its Maintenance report is due 10-31) and say in the
backlog which shape (starter or factory) each of the eight is.

**Mutations I will run** (each must turn a test red):

1. Restore `svelte.config.js` beside the kit 3 config: the copied
   `kit-config.test.ts` (or the build) must fail.
2. Put back a `$app/stores` import, where a repo had one: the test must fail.
3. Set `paths.origin`: the copied test must fail.

**Stop conditions** (beyond AUTONOMY.md's six):

- Never merge into any repo's `main`, and never promote: that is the
  operator's.
- williamson-construction-co and williamson-homes are not in this item
  (116(b) holds Construction until after its cutover window).
- A repo whose shape fits neither the starter nor the factory pattern:
  write it up rather than invent a third.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** As in the template. Attach each client repo with `add_repo`
(push) before touching it. Check that repo's fresh `claude/*` and `fix/*`
branches first. Land the backlog update here with `node scripts/land-prs.mjs`.
```

```markdown
## Worker brief — P1-54: a held, green security PR never reaches the cockpit

**Item.** P1-54 · reddoorla/reddoor-maintenance · 🟢 GREEN (finding and fix here; no preset change) · effort S–M
36 green `sharp` 0.35.5 `[security]` PRs (GHSA-wq5f-xc86-pv6w, CVSS 8.9) sit
unmerged in 15 repos, the oldest since 2026-10-06 [M, 2026-10-19]. They are
held by the preset's "never auto-merge packages that reshape the dependency
graph" rule (`sharp` is one of six names), which is correct. But
`pm-cockpit.mts` lists no vuln for any of those sites [M], so 13 days of a
High advisory reached no morning report.

**Verify first.** `pnpm tsx scripts/pm-cockpit.mts` (no `--since`)
Expect: no CalTex, 29 Navy, Espada or Revogen line mentioning a vuln, while
caltex-landing#78 is open and green.

**Start here.**

- `src/alerts/waiting.ts:30-38`: `DIRECT_VULN_WAIT_DAYS`, and the note that
  "a held PR (the `automerge: false` group) needs the operator".
- `src/alerts/attention.ts` and `src/alerts/digest-collectors.ts`: where
  the "critical/high vulns" items are built.
- What `fleet-security` actually stored for caltex-landing's security
  fields last night (SELECT only): is the `sharp` advisory counted at all,
  as direct or transitive?

**Done when.** The cause is named with the stored row as evidence, and a
held, green security PR older than its wait reaches Needs-you, with a test
that fails on today's code. If the advisory is never recorded by the
security sweep at all, the fix is there, not in `waiting.ts`.

**Mutations I will run** (each must turn a test red):

1. A held security PR inside its wait is listed (it must not be).
2. A held security PR past its wait is not listed (it must be).
3. Mark the held PR as automerge-eligible: it must go back to waiting.

**Stop conditions** (beyond AUTONOMY.md's six):

- Never merge any of the 36 PRs: that is Operator decisions 129.
- No change to the `reddoorla/.github` preset.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** As in the template.
```
