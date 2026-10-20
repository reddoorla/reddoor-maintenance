# Morning brief — 2026-10-20 (PM pass, Tuesday, 11:51Z)

## One-line verdict

**Every nightly was green and yesterday cleared most of the stack (Williamson launched and `maintained`, all 14 `sharp` merges, ERP's `devalue` fix, the lock-file preset, all eight kit 3 promotions), but the preset fix uncovered a new break: 9 of the 11 sites now red in the cockpit have a lock-file PR failing `svelte-check` because a fresh lockfile no longer brings in `@types/node`. Today's dated item is the P1-33 cutover window, which opens when this PR lands.**

This pass started at **11:51Z (04:51 PDT, Tuesday)** [M, `date -u`]. It covers the time from #1403 (merged 10-19 12:16:59Z) to now: 66 commits on `main`.

Open asks: 19 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 82, 87, 97, 120, 121, 133, 137); oldest: item 97, ≥ 898 h (97(a), asked 2026-09-13T01:21:28Z) [M]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. Of the 20 items on the 10-19 line, four are gone, each with the line that closes it: **123** ("Closed", 10-19 ~14:10Z), **126** ("Done 2026-10-19 14:32Z"), **129** ("Done 2026-10-19 14:29Z"), and **136**, which was answered twice on 10-19 and whose deck is out: Tim posted his assessment in #crca at 16:37Z and you posted the Figma deck there at 20:04Z [M, Discord]; this PR adds that status line. New since: **133** (P1-63's #1444, held after round 7) and **137** (the review-minor choices, (a)–(s)). Items 130, 131, 132, 134 and 135 opened and closed on 10-19.

## Top of stack (yours; ordered by date)

1. **Today, Tue 10-20: the P1-33 cutover window (item 121).**
   - **When:** it opens once this PR has landed (#1519 merged at 02:39Z [M]) and no worker session is live. It must finish before Wednesday's 11:48Z pass, which is the first proof.
   - **State [M]:** #1347 reads `behind` and #1342 reads `dirty` against `main`; both are drafts, every check green on their heads. Re-freezing #1347 in the window is runbook step 5, as planned. No `claude/*` branch here has a commit under 17 h old [M, `evening-branches`].
   - **First step in the window:** re-date the workspace runbook (the 10-22 report check, the watcher's `dry_run`, the 10-26 proof), and prove the watcher on the new dates.
   - **One thing to settle first:** the P1-64 worker below must not run during the window. Start it after, or tomorrow.
2. **NEW: item 137, the behaviour choices left in the 10-19 review minors.** Nineteen one-line asks, (a) to (s), each with a pick. Answer by letter. None is dated, and none blocks production.
3. **NEW: item 133, P1-63's #1444 is held after seven rounds.** Round 7 found one reproduced major (`&>> out git push` unflagged, a regression against `main`). The ask is resume through an eighth round, or OD 131's (c), a read-only agent type in place of detection, or leave it held. The tripwire gates nothing in production.
4. **NEW, from P1-53: six repos lost their `staging` branch** when the promotion merged (1836dig, beachfront-dentistry, caltex-landing, data-dynamiq, espada, la-homelessness-initiative), because none had its `staging` ruleset yet. Recutting each is yours, with the ruleset created first. Until then, Renovate PRs to `main` in those repos fail `main-gate` (caltex-landing#86 and #66 do today [M]).

Reports: none needs approval. Due in the next 14 days [M, `nextDueDates` over a SELECT-only connection that refused an UPDATE]: **ERP Industrials Maintenance 10-25**, **1836dig Maintenance 10-31** and, new to the window, **Sonder Maintenance 11-01**. None is drafted.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

Nothing needs an answer. 14 channels were active in the last 14 days, with 55 candidate mentions; 48 were closed by a later post from you and 7 by nothing [M, 11:58Z]. The 4 left after the reaction check are all older than two days and none is an ask: Tim's "Thank you sir!" (#water-cooler, 10-16), Erik's Zoom check-in (#reddoor-project-list, 10-08), Tim's note on scheduled drafts (#rd-marketing, 10-06) and Erik's "Happy writing" (#caltex, 10-06).

**Positive control:** the three #crca mentions open on 10-19 are closed by your 10-19 posts there. No channel answered 403. Your last post was 10-19 20:04Z in #crca.

## Projects

1. **Williamson Construction**: `maintained` since 10-19 [M, SELECT]. You ran `launch` from the laptop, withdrew the Launch email, and D0 (Webflow billing) is done (#1508). The first Quarterly Maintenance report is due 2027-01-14. Open PRs: the kit 3 pair (#27/#28), `@prismicio/svelte` 3 (#33) and the lock-file PR (#31) are red [M]. Next: P1-64 for #31; the kit 3 hold (116(b)) can lift now that its cutover is done.
2. **Williamson Homes**: `maintained` since 10-19 [M]. Red: kit 3 (#44), adapter 7 (#40) and lock-file (#42) [M].
3. **Mantis Landscaping**: `building`, no change [M, SELECT]. No `#mantis-landscaping` channel exists to read.
4. **Roalson Interests**: `building` [M]. **Changed:** Erik in #roalson-interests, 10-19 13:16Z: "six minor edits to the PDFs, and then we should be ready to go live" [M]. The six edits are not written anywhere in this repo yet. Next: Erik's list of the six (item 120 / P1-46).
5. **CalTex**: `maintained`; its kit 3 promotion went live 10-20 ~02:29Z (P1-53) [M]. Its `staging` branch is gone (ask 4). No #caltex message.
6. **Gift of Life Alliance (GOLA)**: Erik, 10-19 13:12Z: "still waiting to hear back on the proposal" [M]. No other change.
7. **Alamo Anatomy and Hedloc**: both `launching`, no change [M, SELECT]. No message in either channel.

## What landed since the 10-19 report [M, `git log origin/main`, 66 commits]

- **The fleet, by sessions you ran:** Williamson launch close-out, the 14 `sharp` merges (item 129), erp-industrial#76 (`devalue` 5.9.4, item 126), `reddoorla/.github#38` (lock-file `prCreation: immediate`, item 130), and all eight kit 3 promotions (P1-53, #1520).
- **Here:** #1412 (P1-54, `pnpm audit` for multi-document lockfiles), #1417 (the bake-off harness), the bake-off rows #1443, #1475, #1503 and their follow-ups, the 19-item cleanup (#1427–#1494), the overnight review-minor batch (#1522–#1528), #1491 (this repo's own lock-file maintenance) and the release PR #1415.
- **Open PRs here** [M, 11:59Z]: #1444 (held, item 133, `dirty`), and the cutover drafts #1347 (`behind`) and #1342 (`dirty`). No release PR is open.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-19T12:16:59Z`) [M]

`PM_COCKPIT_SUMMARY broken=11 watch=0 approval=0 sites=19 new=10`, `just_wait_left_out=14`.

- **Needs you, 11 sites, all "Renovate PRs failing CI".** Read PR by PR in the 11 repos [M, check runs on each head]:
  - **Lock-file PRs failing `svelte-check` (P1-64, new):** 29-navy#88, beachfront-dentistry#91, medical-solutions-of-texas#86, revogen#100, vida-legacy-foundation#114 (`staging`), vineyard-custom-homes#91, williamson-construction-co#31, williamson-homes#42. Each log reads `Cannot find name 'node:fs' … install type definitions for node`. None of those repos lists `@types/node` in `package.json`; the three that do (caltex-landing, erp-industrial, gallerysonder) have no such failure, and reddoor-starter lacks it too [M].
  - **`@prismicio/svelte` 3, a new major:** vida#113, gallerysonder#130 (both `staging`) and williamson-construction-co#33 are red.
  - **Kit 3 / adapter 7 outside P1-53's eight:** erp-industrial#73/#74, vineyard-custom-homes#92/#93, williamson-homes#40/#44 and williamson-construction-co#27/#28.
  - **`main-gate` only:** caltex-landing#86 and #66, and beachfront-dentistry#66 (ask 4), and Vida's stale #112.
- **Watch:** none. ERP's `devalue` line is gone, since #76 merged.
- **`just_wait_left_out=14`** is P1-54's expected wave: the 06:13Z `fleet-security` run added `pnpm audit` for 15 repos with multi-document lockfiles and found High advisories in most [M, job log]. They wait inside their window and are not asks yet.

## Nightlies (created ≥ 10-19 12:00Z) [M, Actions API and job logs]

All 17 scheduled and dispatched runs concluded `success`. None is pending.

- **Conductor** 39378566496 (06:07Z clock): `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8`, finished 07:14:59Z. The 07:36Z fallback cron logged `skipped=8`. No `clock-missed` line (the only hits are the workflow's script text).
- **Per nightly:**
  - fleet-db-backup: `DUMP_VERIFY … rows=1200 … mismatches=0`, up from 1189.
  - fleet-prismic-drift `wrote=17 failed=0`; fleet-prismic-sync `sites=17 in_sync=13 skipped=4 failed=0`. The fleet is 17 sites now, up from 15, with both Williamsons `maintained`.
  - fleet-security `wrote=17 failed=0`, `PROTECTION_AUDIT gaps=11` (down from 13: `launch` protected both Williamson `main`s), `PACKAGE_MANAGER_PIN gaps=5`.
  - fleet-lighthouse `wrote=17` and `wrote=23`; fleet-smoke `wrote=17`, `FLEET_SMOKE_UNMEASURED count=0`; fleet-form-e2e `wrote=17`. All `failed=0`.
  - daily-reports draft (07:13Z): "No reports due", `DIGEST_STATE_WRITE turso=1 rollup=1`, `DIGEST_SEND_LOG decision=added`.
- **Send:** 10-19's 16:07Z run found "No reports ready to send". Its 19:22Z fallback logged "a send run succeeded since 2026-10-19 (1), so the fallback sends nothing". There was no `send-clock-missed` or `send-run-failed`.
- **Also green:** time-travel (weekly, 10-19 17:18Z), release-health, renovate, pm-pass-watch ×2, forms-deadletter-replay ×2.

**Tracking issues:** #754 updated by the bot (gaps=11). No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Opened:** 59, all from sessions (review minors from the 10-19 PRs), 40 still open.
- **Closed:** 43, mostly by the cleanup (#1427–#1494) and the overnight batch (#1522–#1528).
- **Older issues touched:** #1339 (P1-48's alarm: #1484 fixed the cheap half, "the rest is a design choice for the operator"; it has no "Operator decisions" line yet), #754 and #490 (bots).
- **Open now:** 67, up from 44.

## What went wrong, or nearly did

- **The lock-file fix exposed a fleet-wide type gap (P1-64, new).** Lock-file PRs had not opened since 09-15, so nothing had re-resolved the transitive `@types/node` that `svelte-check` leaned on. The 10-19 P1-58 bake-off saw the same break on reddoor-starter (48 errors) and recorded it as a fact about the task, not as a fleet finding. The fix is one devDependency per repo and one in the starter.
- **The staging deletions (ask 4).** The merge's "delete branch" removed `staging` in six repos with no ruleset. `docs/runbooks/staging-flow.md` creates the ruleset before the first promotion; these six were promoted before that step.
- **No item has a "first wave" check for P1-54.** Its proof was "tomorrow's sweep must store CalTex's advisory"; CalTex's `sharp` was merged before that sweep, so CalTex's own line no longer proves it. The 06:13Z log does: 15 repos took the `pnpm audit` path [M].

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=2 stale=1 stale_fresh=1 scanned=4 older_skipped=39` [M, 11:59Z].

- The two decision lines are #1347's staged cutover stub and `claude/p1-62-od135` (closed #1460), whose line is **already item 135** on `main`.
- **Unprotected, NEW:** `claude/p1-62-od135`, 3 commits not on `main`, last "Merge branch 'main' into claude/p1-62-od135" (17.7 h). Its content landed as item 135: say it can go.

## Next for agents

**Ready, after the cutover window closes:**

1. **P1-64:** add `@types/node` to the eight red repos and to reddoor-starter, one PR per repo, so the lock-file PRs go green and automerge.

**Held:**

- P1-63 (#1444), on item 133;
- P1-46, on Erik's six edits;
- the kit 3 pairs outside P1-53 (ERP, Vineyard, both Williamsons) are not briefed today: P1-64 first, since each kit 3 PR also re-resolves the lockfile.

### Briefs

```markdown
## Worker brief — P1-64: a fresh lockfile drops `@types/node`, so lock-file PRs fail `svelte-check`

**Item.** P1-64 · reddoorla/reddoor-maintenance (backlog), one client repo per PR, plus reddoorla/reddoor-starter · 🟡 YELLOW · effort S per repo
Start only after the P1-33 cutover window has closed (item 121): the window
needs no worker sessions live.
The preset fix of 2026-10-19 (`reddoorla/.github#38`) opened lock-file PRs
fleet-wide at 14:15Z, and eight are red on `ci / ci`: 29-navy#88,
beachfront-dentistry#91, medical-solutions-of-texas#86, revogen#100,
vida-legacy-foundation#114 (base `staging`), vineyard-custom-homes#91,
williamson-construction-co#31 and williamson-homes#42 [M, 2026-10-20]. Each
log reads `Error: Cannot find name 'node:fs'. Do you need to install type
definitions for node?` from `svelte-check` (revogen: 4 errors in 1 file). None
of the eight lists `@types/node` in `package.json`; caltex-landing (`^25.9.1`),
erp-industrial (`^24.0.0`) and gallerysonder (`^25.9.3`) do, and their
lock-file PRs have no such failure. reddoor-starter's `package.json` has no
`@types/node` either [M]. The P1-58 bake-off saw the same 48 errors on the
starter (`docs/journal/2026-10-19-1705-p1-58-bakeoff-pnpm-update.md`).

**Verify first.**
`for r in 29-navy revogen williamson-homes; do gh api "repos/reddoorla/$r/contents/package.json" --jq .content | base64 -d | grep -c '@types/node'; done`
Expect: `0` three times. Attach each repo with `add_repo` (push) first.

**Start here.**

- Each repo's `package.json` `devDependencies`, and the Node major in its
  `.nvmrc` (pick the matching `@types/node` major, as caltex-landing and
  gallerysonder did).
- `docs/runbooks/staging-flow.md`: a repo whose `main` runs `main-gate`
  takes the change on `staging`, and the promotion is the operator's.
  29-navy#88 fails `main-gate` as well as `ci` [M], so 29-navy is one;
  vida-legacy-foundation's lock-file PR already targets `staging`.
- The red lock-file PR in each repo: once the fix is on its base, Renovate
  rebases it on its next run; it should go green and automerge.

**Done when.** In each repo, one PR adds `@types/node` and nothing else
(`pnpm add -D @types/node@<major>`), its `ci` is green, and after it merges
the repo's lock-file PR goes green on its rebased head. reddoor-starter gets
the same PR so new sites inherit it. The P1-64 row records each repo's PR,
and a journal entry lands here with `node scripts/land-prs.mjs`.

**Mutations I will run** (each must turn a check red):

1. On one repo's branch, remove `@types/node` again and run `pnpm check`:
   it must fail with the `node:fs` error.
2. Pin `@types/node` to a major older than the repo's `.nvmrc`: record
   whether `svelte-check` notices (if not, say so; it is not a gate).

**Stop conditions** (beyond AUTONOMY.md's six):

- Never merge Renovate's PRs by hand, and never promote `staging` to
  `main`: promotion is the operator's.
- The six repos whose `staging` was deleted (1836dig,
  beachfront-dentistry, caltex-landing, data-dynamiq, espada,
  la-homelessness-initiative) need their ruleset first; that is the
  operator's. For beachfront-dentistry, if `main-gate` refuses a PR to
  `main`, stop and ask rather than recutting `staging`.
- No change to the `reddoorla/.github` preset.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** As in the template. Check each repo's fresh `claude/*` and
`fix/*` branches first. Use a worktree.
```
