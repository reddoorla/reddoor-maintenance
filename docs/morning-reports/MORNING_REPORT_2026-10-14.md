# Morning brief — 2026-10-14 (PM pass, Wednesday, 11:49Z)

## One-line verdict

**All eight nightlies finished green by 07:18Z. Williamson cut over a day early and both domains serve from Netlify. The kit 3 promotions are all done. Four things are yours today: close two abandoned Renovate PRs (one of them is Vida's only cockpit alarm), run the live Williamson `/join-the-team` test, merge release #1352, and keep the 10-16 and 10-19 Williamson checks. The Prismic preview-exit defect (P1-47) is now in production on five kit 3 sites, and today's 2.2.3 release does not fix it.**

This pass started at **11:49Z (04:49 PDT, Wednesday)** [M, `date -u`]. It covers the time from #1333 (merged 10-13 12:09:11Z) to now. It is a weekday pass, so there was no re-rank. The Routine's prompt now says "fires once a day" and names no evening pass. That was 110(b)'s check, and it passed [M].

Open asks: 17 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 82, 87, 97, 120, 121); oldest: item 97, ≥ 754 h (97(a), asked 2026-09-13T01:21:28Z) [M]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. Two items from the 10-13 line are gone:

- **110:** closed 10-13 by your "routine is saved" (#1335).
- **113:** closed by this PR. The second promotions all merged at 21:48–21:49Z [M].

Two items are new:

- **121:** answered, but your two pre-10-23 chores are still open.
- **122:** answered and landed in #1346, so nothing is left for you.

## Top of stack (yours; ordered by date)

1. **Today, Wed 10-14: close two abandoned Renovate PRs.** They are vida-legacy-foundation#80 and alamo-anatomy#58, both `vitest to v5 - abandoned` and both aimed at `main`.
   - **Why:** on vida#80, `main-gate` fails as designed, with "no 'fast-track' label … Majors and everything else target staging" [M, the job log, 04:35Z]. That is the cockpit's only alarm: **NEW, `/s/vida-legacy-foundation`, "1 Renovate PR failing CI"**.
   - **Effect:** closing them clears the cockpit [I]. The staging flow sends the vitest major to `staging` now.
2. **Today: the live Williamson Construction form test.**
   - **The test:** send a submission from `https://www.williamson-construction.com/join-the-team`. The newest Williamson submission in Turso is still your 21:37:49Z preview test [M, SELECT].
   - **Also yours:** the by-eye check on phone and desktop, then `reddoor-maint launch` for each site. Both rows are still `building`.
   - **Already fine:** both `www` names are CNAMEs to their Netlify sites, and each home page answers 200 with a `www` canonical and no Webflow marker [M, 11:54Z].
3. **Release PR #1352** (`chore(release): version packages`): open 21 h, `clean` [M]. Yours to merge.
4. **Fri 10-16: the Williamson verifier run** (`node scripts/williamson-cutover-verify.mjs`).
5. **Mon 10-19: the Williamson verifier again, then D0** (Webflow billing). Remove the domains from Webflow only after that run, since keeping them until then is the rollback.
6. **Before Fri 10-23 (item 121, new):**
   - Add the `RESEND_API_KEY` secret and the `OPERATOR_EMAIL` variable to reddoor-workspace's Actions.
   - Read the staged `CLAUDE.md` (workspace `cutover/claude-md`).
7. **Item 120, the Roalson packages (P1-46).** All 23 PDFs and the sign-off note reached Erik in Dropbox on 10-13. Now it waits on Erik's review and Matt's sign-off.
   - **Yours, when Erik answers:** is the cream watermark (Erik's re-save of four covers) the new standard? A yes means one generator change and a rebuild of all 23.
   - **Chore:** the Dropbox file request "Roalson packages - Oct 2026 sign-off" is **still open**, with 24 files [M, Dropbox connector]. Close it in the Dropbox web UI.

Reports: none needs approval. The next one due is ERP Industrials Maintenance on **10-25**, with no draft yet and no blocker [M].

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None. 11 channels were active in the last 14 days. They held 63 candidate mentions, and 4 are open [M, 11:51Z]. None of them is a real ask:

- **Older than two days:** Erik's Zoom check-in in #reddoor-project-list (10-08), Tim's post on scheduling social posts in #rd-marketing (10-06), and Erik's "Happy writing" in #caltex (10-06).
- **Under two days:** Erik's 10-13 17:59Z question in #roalson-interests about where the PDFs are. He answered it himself at 18:00Z ("Never mind, found them").

**Positive control:** 58 mentions were closed by a later post from you and 1 by your reaction. No channel answered 403. Your last post was 10-13 17:47Z in #roalson-interests.

## Projects

1. **Williamson Construction**: cut over 10-13 ~22:14Z, a day early, on Tim's verbal go, with the verifier GREEN (64 of 64) [M, per P0-5; DNS and pages re-read 11:54Z]. Status is still `building`. Next: ask 2, then 10-16 and 10-19 (yours). Its kit 3 migration is unblocked, but it is best left until 10-19 closes the rollback window [I].
2. **Williamson Homes**: cut over with Construction. Its certificate issued at 21:43:51Z, and `www.williamson-homes.com` is a CNAME to `williamson-homes.netlify.app` [M]. Next: the same as Construction.
3. **Mantis Landscaping**: on kit 3 in production. mantis#44 and #47 merged on 10-13 [M]. mantislandscaping.com still serves the old site, because DNS (61.2) and the matching gate (78) are unchanged. There is no #mantis channel.
4. **Roalson Interests**: the packages are with Erik (ask 7). #roalson-interests has been quiet since 10-13 18:00Z [M].
5. **CalTex**: no change. There has been no #caltex message since 10-06 [M].
6. **Gift of Life Alliance (GOLA)**: no change [M].
7. **Alamo Anatomy and Hedloc**: Alamo is on kit 3 in production (alamo#72 and #74) [M], and #58 is in ask 1. Hedloc: no change [M].

## What landed since the 10-13 report [M, `git log origin/main`, 18 commits]

- **Code:**
  - #1345, `scripts/decisions.mjs` (P1-33 W2);
  - #1338, `evening-branches` takes a required `--backlog` argument (W3);
  - #1346, the nightly Search Console re-check (P1-48). It worked on its first night: LAHI's Watch line is gone, and the cockpit shows `watch=0` [M].
- **Docs:** #1334, #1335, #1337, #1343, #1344, #1350, #1351, #1358 to #1364 and #1366. These cover P0-5's cutover, Operator decisions 121 and 122, the P1-46 handoff, the model rule on `main`, the archive line, and P1-49 (Vineyard's WCAG check: 17 findings, filed as vineyard-custom-homes#79 to #90).
- **In client repos:** the five kit 3 promotions and their second promotions (item 113, closed), `.github` #37 (the staging-flow preset), and roalson-interests #301.

**Open PRs here** [M, 11:52Z]:

- **#1352**, the release (ask 3).
- **#1347 and #1342**, the P1-33 cutover drafts, marked "do not land before 10-23". #1347's red `ci` comes from `tests/docs/moved-files.test.ts`, which is expected for a draft that edits the frozen set.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-13T12:09:11Z`) [M]

`PM_COCKPIT_SUMMARY broken=1 watch=0 approval=0 sites=17 new=1`, `just_wait_left_out=2`. The script refused an UPDATE first.

- **Needs you:** NEW Vida Legacy Foundation, "1 Renovate PR failing CI", first flagged 10-14 (ask 1).
- **Watch:** none. LAHI's stale `no-property` line cleared on #1346's first night.

**Reports due in the next 14 days** [M, a SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports]:

- ERP Industrials Maintenance on 10-25, with no draft yet.
- The one unsent row is Vida's withdrawn 2026-09 draft (item 41).
- **Control:** `approveBlockers` on Espada, with its recipients and point of contact blanked, returns `recipients-missing`.

## Nightlies (created ≥ 10-13 12:00Z) [M, Actions API and job logs]

Every scheduled and dispatched run in the window concluded `success`. None is pending.

| Night | Conductor (06:07Z clock) | Summary | Last completion | Fallback cron |
| --- | --- | --- | --- | --- |
| 10-14 | 38520344801 | `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8` | 07:17Z (daily-reports, 1.5 min) | 07:40Z, `skipped=8` |

- **fleet-db-backup:** `DUMP_VERIFY loaded=true tables=11 rows=1181 … mismatches=0`. Rows went from 1161 to 1181.
- **fleet-prismic-drift:** `wrote=15 failed=0`.
- **fleet-prismic-sync:** `in_sync=11 skipped=4 failed=0`.
- **fleet-security:** `wrote=15 failed=0`. **`PROTECTION_AUDIT gaps=15`, up from 13.**
  - The two new gaps are not in the fleet. They are probe failures on alamo and vida: "No commit found for SHA: renovate/staging-major-vitest-monorepo (HTTP 422)".
  - That branch does not exist on vida, and `branchTip` (`src/github/gh.ts:951`) returns `null` only on a 404. This is new as **P1-50**.
  - `PACKAGE_MANAGER_PIN gaps=5` is unchanged.
- **fleet-lighthouse:** `wrote=15` and `wrote=23`, both with `failed=0`, and no `LIGHTHOUSE_FAILURES` line.
- **fleet-smoke:** `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`.
- **fleet-form-e2e:** `wrote=15 failed=0`.
- **daily-reports draft:** "No reports due." Digest `DIGEST_STATE_WRITE turso=1 rollup=1`, `DIGEST_SEND_LOG write=1 decision=unchanged`.
- **Sends:** the 10-13 16:07:07Z send found "No reports ready to send". Its 19:54Z fallback sent nothing, because a send had already succeeded. There was no `clock-missed`, `send-clock-missed` or `send-run-failed`.
- **Also green:** release-health (10-13 20:18Z), renovate ×2, pm-pass-watch ×3 and forms-deadletter-replay ×3.
- **One cancelled run:** `release` on main at 10-13 14:29Z, probably superseded by the next push [I].

**Tracking issues:** #754 was updated by the bot (gaps=15). No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Closed:** #1336 (P1-48) and #1365 (P1-49).
- **Opened:** review minors, all with 0 comments:
  - #1339, #1340 and #1341 (P1-48);
  - #1348 and #1349 (evening-branches);
  - #1353 to #1357 (`decisions.mjs`).
- **Updated:** #754 (bot).

## What went wrong, or nearly did

- **P1-47 shipped.** The five promotions merged with the preview-exit defect still in them. `@prismicio/svelte` 2.2.3 came out 10-14 00:47Z and still passes `noScroll: true` (`PrismicPreview.svelte:60`, peer kit `^2`) [M, `npm pack`]. So the fix is ours, not a bump. Editors on Vida, Mantis, LHY, Sonder and Alamo will hit it the first time they end a preview [I, not reproduced].
- **The staging flow made two monitors misread Renovate.**
  - The cockpit counts `main-gate`'s by-design refusal of an abandoned major as "failing CI" (ask 1).
  - The protection audit counts a not-yet-created `renovate/staging-…` branch as a probe failure (P1-50).
  - Neither is a fleet fault. Both came from the 10-13 promotions, the gate's first full day.
- **The unprotected branch `claude/p1-45-kit3-sync`** (WIP, 10-12, superseded by #1301 [I]) is still there, now 46 h old. It is listed in the `older` group. Say it can go.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=1 stale=1 stale_fresh=0 scanned=3 older_skipped=38` [M, 11:52Z]. No ask sits only on a branch. The one "decision line" is #1347's cutover banner ("Moved on 2026-10-23 …"). It is a staged stub, not an ask.

## Next for agents

**Ready today:**

- **P1-47**, the preview exit, which is now in production. Brief below. This is yesterday's brief, re-measured. The changes are that 2.2.3 exists and does not fix it, and that the fix now goes to five `main`s through `staging`.
- **P1-50**, the audit's 422. It is small (🟢). Brief below.

**Held:** williamson-construction-co's kit 3 migration, until after 10-19 [I]; P1-46, on Erik and Matt; the P1-33 cutover, until 10-23.

### Briefs

```markdown
## Worker brief — P1-47: Prismic preview exit on SvelteKit 3 (now in production)

**Item.** P1-47 · open an issue in reddoorla/reddoor-maintenance · 🟡 YELLOW · effort S–M
`@prismicio/svelte` 2.2.3 (published 2026-10-14 00:47Z, the latest) still
peers `@sveltejs/kit` `^2`, and its `PrismicPreview` ends a preview with
`goto(url, { invalidateAll: true, noScroll: true })`
(`dist/kit/PrismicPreview.svelte:50-62`) [M, `npm pack`, 2026-10-14]. Kit 3
removed `noScroll` (`goto_options_removed`): by a reading of kit 3.0.1's
source it throws under `pnpm dev` and scrolls to the top in production [I,
not run in a browser]. Since 2026-10-13 17:45–17:47Z it is in production on
vida-legacy-foundation, mantis-landscaping, la-homelessness-youth,
gallerysonder and alamo-anatomy, all on kit 3. reddoor-starter has been on
kit 3 since reddoor-starter#187. `@reddoorla/maintenance` still peers kit
`^2.0.0` (`package.json:104-106`).

**Verify first.** `npm view @prismicio/svelte version peerDependencies`
Expect: `2.2.3`, kit `^2` [M]. If a newer version drops `noScroll` or
peers kit 3, the fix is a bump: say so and stop there.

**Start here.**

- reddoor-starter: where `PrismicPreview` is mounted (`src/routes/+layout.svelte`
  or similar), and `package.json`.
- `node_modules/@prismicio/svelte/dist/kit/PrismicPreview.svelte:45-90`.
- This repo: `package.json:104-106` (the peer range).

**Done when.**

1. The failure is reproduced on the starter under kit 3: either the thrown
   `goto_options_removed` in a dev server, or the scroll jump in a
   production build. If it does not reproduce, report that and stop.
2. The fix is in the starter: a local `PrismicPreview` wrapper or a pnpm
   `patchedDependencies` entry. Pick one, with a test, and file the issue
   upstream in prismicio/prismic-svelte (check for an existing one first;
   2.2.3 had PR builds `2.2.3-pr.64.*` on 10-14).
3. This package's peer is widened to `^2.0.0 || ^3.0.0`, with a changeset.
4. A one-paragraph port note for the five sites. Under the staging flow the
   port goes to each repo's `staging`, then a promotion the operator merges.
   Do not push to client repos: the roll-out is the operator's.

**Mutations I will run** (each must turn a test red):

1. Restore `noScroll: true` in the wrapper or patch.
2. Narrow the peer back to `^2.0.0`.

**Stop conditions** (beyond AUTONOMY.md's six):

- No pushes to the five client repos' `staging` or `main`.
- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean (file the minors as issues).
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** Check fresh `claude/*` and `fix/*` branches here and in
reddoor-starter first. Use a worktree, and land the starter PR under its
ruleset. Here, the peer change and a journal entry go in one PR via
`node scripts/land-prs.mjs`.
```

```markdown
## Worker brief — P1-50: the protection audit's 422 on a missing Renovate branch

**Item.** P1-50 · reddoorla/reddoor-maintenance · 🟢 GREEN · effort S
The 2026-10-14 06:16Z `fleet-security` run printed `PROTECTION_AUDIT
gaps=15`, up from 13. The two new gaps are probe failures on alamo-anatomy
and vida-legacy-foundation: "No commit found for SHA:
renovate/staging-major-vitest-monorepo (HTTP 422)" (#754's 10-14 comment)
[M]. That branch does not exist on vida (`GET branches`). The Dependency
Dashboard names it before Renovate creates it. `branchTip` returns `null`
only on a 404 (`src/github/gh.ts:951`), so the 422 throws and the whole
repo's probe becomes a gap.

**Verify first.**
`gh api repos/reddoorla/vida-legacy-foundation/commits/renovate/staging-major-vitest-monorepo`
Expect: HTTP 422, "No commit found for SHA". (Attach vida with `add_repo`
first.) If it answers 200, the branch now exists: say so, and still fix
the 422 path if `PROTECTION_AUDIT` on the latest run still lists it.

**Start here.**

- `src/github/gh.ts:936-960` (`branchTip`).
- Its callers in `src/audits/protection-coverage.ts` (`probe failed`, `:809`).
- The existing `branchTip` tests (`grep -rn branchTip tests`).

**Done when.**

1. A 422 whose message carries "No commit found for SHA" returns `null`, as
   a 404 does. Every other 422, and every other error, still throws.
2. Tests cover both, through the code path the audit uses.
3. The next `fleet-security` run's `PROTECTION_AUDIT` no longer lists either
   probe failure (record it in the journal entry; until then, done is
   "landed, proof pending").

**Mutations I will run** (each must turn a test red):

1. Drop the 422 case (back to 404 only).
2. Widen it to every 422, whatever the message.

**Stop conditions** (beyond AUTONOMY.md's six):

- Five dirty review rounds → "Operator decisions"; a minors-only round is
  clean (file the minors as issues).
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** Check fresh `claude/*` and `fix/*` branches first. Use a
worktree, include a journal entry and the BACKLOG row move, and land via
`node scripts/land-prs.mjs`.
```
