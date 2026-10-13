# Morning brief — 2026-10-13 (PM pass, Tuesday, 11:51Z)

## One-line verdict

**All eight nightlies finished green by 07:06Z, the cockpit shows nothing broken, and no report needs approval. Four things are yours. Williamson's Tuesday DNS step has not run, and #williamson has been silent since 10-11, so Wednesday's cutover is at risk. The five kit 3 `staging` branches are waiting for you to promote them. The Routine still runs its old two-pass prompt. The 23 Roalson packages are waiting for your review.**

This pass started at **11:51Z (04:51 PDT, Tuesday)** [M, `date -u`]. It covers the time from #1296 (merged 10-12 12:12:40Z) to now. It is a weekday pass, so there was no re-rank. It is also the first pass under #1305's rules: no do, date or drop list, no clean-send table, and no evening pass.

Open asks: 18 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 82, 87, 97, 110, 113, 120); oldest: item 97, 731 h [I]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. Every item on the 10-12 line is still present except **81**, which this PR closes: all four Dropbox file requests now read `is_open: false` [M]. Three items are new: **110** (its (b), the Routine), **113** (your promotion chores) and **120** (your package review). The other new items, 108, 109, 111, 112, 114 to 117 and 119, were answered on 10-12 or 10-13 and leave nothing for you to do. 107 is closed.

## Top of stack (yours; ordered by date)

1. **Today, Tue 10-13: the Williamson DNS step (P0-5), before Wed 10-14's cutover.**
   - **Nothing has changed** [M, dns.google, 11:58Z]: both apexes are `198.202.211.1`, and each `www` is a CNAME to `cdn.webflow.com.` with TTL **3600**.
   - #williamson has had no message since your 10-11 14:18Z post [M], so Tim's go, D0 (Webflow billing after 10-19) and his MarkUp tweaks are all still outstanding.
   - Either get Tim's go and do the runbook's Tuesday step today (add the custom domains in Netlify, and lower the `www` TTL to 300 at GoDaddy; `docs/runbooks/williamson-cutover-2026-10-14.md`), or tell him the cutover moves.
   - Before Construction's DNS moves, a test `/join-the-team` submission on the preview must arrive at the contact-form recipient (D6 is answered).
2. **New since 10-12: promote the five kit 3 `staging` branches (item 113).**
   - None is promoted yet [M, `git ls-remote`]. Each repo's `staging` is still ahead of `main`.
   - **Each promotion PR (vida-legacy-foundation#101, mantis-landscaping#44, la-homelessness-youth#33, gallerysonder#117, alamo-anatomy#72) needs its `staging` ruleset created first.** The command is in each PR's body. Without it, the merge deletes `staging`.
   - mantis#44 also needs a `main` ruleset, because mantis `main` has no protection at all.
   - After each merge, make `main-gate` required (`docs/runbooks/staging-flow.md`, step 6).
   - Then `git am` `docs/patches/2026-10-12-github-renovate-staging-flow.patch` on `reddoorla/.github`, which has had no commit since 09-22 [M], and land the five `extends` drafts.
   - **Read P1-47 before promoting.** Ending a Prismic preview is expected to break on kit 3 on every one of these sites [I]. The cause, `@prismicio/svelte` 2.2.2 passing `noScroll`, is confirmed [M]. A worker can fix it first (brief below), or you can promote now and take the fix as a follow-up.
3. **New since 10-12: item 110(b), the Routine.** Today's 04:48 PT fire ran the **old** stored prompt [M]. It says the Routine "fires twice a day" and sends a 12:00 PT fire to "The evening pass", a section #1305 removed. In the "Reddoor Project Manager" Routine, set the cron to `CRON_TZ=America/Los_Angeles 48 4 * * 1-4`, and paste the text under "The Routine's stored prompt" in `docs/pm-pass.md`.
4. **New 10-13 04:19Z: item 120, the Roalson packages (P1-46).** All 23 have been rebuilt to your 120 answers (roalson-interests#297, `eedf175`).
   - **Yours:** review the set, then send it to Erik for Matt.
   - **The broker's:** Menger Springs Road's flood sentence.
   - Nothing goes to Prismic `package_pdf` before then.

Reports: none needs approval. The next one due is ERP Industrials Maintenance on **10-25** (details below).

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None. 12 channels were active in the last 14 days. They held 72 candidate mentions, and 4 are open [M, ~11:57Z]. Three of the four are older than two days, and none of those is an ask:

- Erik's Zoom check-in in #reddoor-project-list (10-08), whose time has passed.
- Tim's thread about auto-posting in #rd-marketing (10-06).
- Erik's "Happy writing" in #caltex (10-06).

The fourth is Erik's 10-12 22:11Z note in #roalson-interests, 14 h old, that Land ID images become the listings' hero shots. P1-46 has already built it.

**Positive control:** 67 mentions were closed by a later post from you and 1 by your reaction. No channel answered 403 this time. Hedloc's and Roalson's asks from 10-09 are closed: you posted in both channels on 10-12. Your last post anywhere was 10-12 21:36Z in #roalson-interests.

## Projects

1. **Williamson Construction**: building. The cutover is set for Wed 10-14 and is at risk (ask 1) [M].
   - Item 74's posters went live 10-12 16:06Z, and D6 is answered.
   - The site's status is `building`, and Webflow still serves `www` (`data-wf-site` is present).
   - Next: Tim's go (yours).
   - Its kit 3 migration is held until after the cutover (116(b)).
2. **Williamson Homes**: building. It has the same DNS state and the same cutover [M]. No change.
3. **Mantis Landscaping**: building.
   - The kit 3 migration is on `staging` (`cfb092cf`) and waits on promotion PR mantis#44 (ask 2) [M].
   - `main` is still `6e87f022` (10-06). Operator decisions 61.2 and 78 are unchanged.
4. **Roalson Interests**: building. 10-12 was a busy day [M, Discord and the backlog]:
   - Erik's Ri-Pin2 pins are in (roalson-interests#289; 111: no stroke, at 0.81).
   - Featured Properties now heads the left column (#291).
   - Erik's hero subheadline is published (117). The repository has no release left staged [M, Prismic].
   - The 23 packages are rebuilt (ask 4).
   - Nicole's "losing the map?" was answered in the channel: the map goes from the home page only.
5. **CalTex**: maintained. No change [M]. The last #caltex message is from 10-06. The Prismic connector refused `caltex` this morning ("unable to verify MCP activation"), so its releases were not read.
6. **Gift of Life Alliance (GOLA)**: no change. The last #gift-of-life-alliance message is yours, from 10-01 [M].
7. **Alamo Anatomy and Hedloc**: launching.
   - **Alamo:** its kit 3 migration is on `staging` (`e42a3e69`) and waits on alamo-anatomy#72 (ask 2) [M].
   - **Hedloc:** on 10-12 you and Erik agreed to leave it mostly as it is, with small improvements only as time allows, since the extra effort can't be billed [M, #hedloc-web 14:14–14:31Z].

## What landed since the 10-12 report [M, `git log origin/main`]

- **Release #1317** (0.107.0) merged 10-12 21:32Z, about 9.5 h after it opened.
- **Code:**
  - #1301: kit 3 `sync-configs` templates, `createKitConfig` and the migration plan (P1-45).
  - #1305: five review rounds, with minors filed as issues; the PM pass is now morning-only (107).
  - #1308: `contrast-unmeasured` names Tailwind's `black/<alpha>` (P1-31).
  - #1316: form-e2e waits for hydration (#1148 closed).
  - #1318: the credentials Read deny rule is anchored at `~/` (P1-33(e)).
- **Docs:** #1294, #1295, #1298 to #1300, #1302 to #1304, #1306, #1307, #1309 to #1315, #1319 to #1332. These are Operator decisions 108 to 120, journal entries, P1-43, P1-44 and P1-45 done, the staging-flow runbook, and 97(h) closed.
- **Done in client repos (per the backlog):**
  - erp-industrial#71;
  - medical-solutions-of-texas `709079f`;
  - vineyard-custom-homes `6a9f6ae` and its alt-text release;
  - roalson-interests #289, #291 and #297;
  - kit 3 on `staging` in five repos.

**Open PRs** [M, 11:56Z]: none in this repo. No release PR is open.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-12T12:12:40Z`) [M]

`PM_COCKPIT_SUMMARY broken=0 watch=1 approval=0 sites=17 new=0`, `just_wait_left_out=2`.

- **Needs you:** none. The three kit 3 sites that were broken yesterday (LA Homelessness Youth, Sonder, Vida) cleared once their Renovate pairs closed as replaced [I].
- **Watch:** LA Homelessness Initiative, Search Console "no property matched www.lahomelessnessawareness.org (lookup 2026-10-05)", unchanged.

**Reports due in the next 14 days** [M, a SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports]:

- ERP Industrials Maintenance, **10-25**. After it come 1836dig on 10-31, Sonder on 11-01, Beachfront Dentistry on 11-08, and CalTex and MSOT on 11-21.
- Nothing is pending approval. The one unsent draft is Vida's withdrawn 2026-09 row (item 41).
- **Control:** `approveBlockers` on Espada, with its recipients and contact blanked, returns `recipients-missing`.

## Nightlies (created ≥ 10-12 12:00Z) [M, Actions API and job logs]

Every scheduled and dispatched run in the window concluded `success`. None is in progress.

| Night | Conductor (06:07Z clock) | Summary | Last completion | Fallback cron |
| --- | --- | --- | --- | --- |
| 10-13 | 38354949567 | `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8` | 07:05Z (daily-reports, 1.6 min) | 09:27Z, `skipped=8` |

- **fleet-db-backup:** `DUMP_VERIFY loaded=true tables=11 rows=1161 blob_bytes=11433275 hashed=11 mismatches=0`, on both dumps. Rows went from 1153 to 1161.
- **fleet-prismic-drift:** `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15`.
- **fleet-prismic-sync:** `PRISMIC_SYNC_SUMMARY sites=15 … in_sync=11 skipped=4 failed=0`.
- **fleet-security:** `wrote=15 failed=0`. `PROTECTION_AUDIT gaps=13 covered=17 skipped=7 total=37` is unchanged (#754), and so is `PACKAGE_MANAGER_PIN gaps=5`.
- **fleet-lighthouse:** `wrote=15 failed=0` and `wrote=23 failed=0`. **No `LIGHTHOUSE_FAILURES` line**: MSOT and Vineyard pass accessibility on production now (P1-43, P1-44).
- **fleet-smoke:** `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`.
- **fleet-form-e2e:** `wrote=15 failed=0`. This is the first run with #1316's hydration wait.
- **daily-reports draft:** "No reports due". Digest `DIGEST_STATE_WRITE turso=1 rollup=1`, `DIGEST_SEND_LOG write=1 decision=unchanged`.
- **Sends:** the 10-12 16:07:07Z send found "No reports ready to send". Its fallback (21:46Z) logged "a send run succeeded since 2026-10-12 (1), so the fallback sends nothing". There was no `clock-missed`, `send-clock-missed` or `send-run-failed`.
- **Also green:** release-health (10-12 22:11Z), renovate, time-travel, forms-deadletter-replay and pm-pass-watch.

**Pending:** today's 16:07Z send and release-health.

**Tracking issues:** #1297 (P1-45) and #1148 (form-e2e) closed on 10-12. #754, #545 and #490 were updated. Nothing opened. No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Closed:** #1297 and #1148.
- **Updated:** #754 (bot), #545 (your staging-flow issue, 22:47Z) and #490 (Dependency Dashboard).
- **Opened:** none in this repo. Workers filed roalson-interests #294 to #296 (P1-46 minors) and medical-solutions-of-texas#80 (the 390 video case).

## What went wrong, or nearly did

- **Dependabot security updates started failing on 10-12** [M]. Twelve `npm_and_yarn … Update` runs failed: six at 17:22–18:01Z and six again at 20:53Z and 21:32Z. They cover `postcss-selector-parser`, `source-map-js`, `compression`, `brace-expansion`, `proxy-addr` and `@grpc/grpc-js`. One log says why: "The latest possible version of postcss-selector-parser that can be installed is 7.1.4. The earliest fixed version is 7.1.6." These are transitive pins that Dependabot cannot lift.
  - There were no such runs between 10-01 and 17:22Z on 10-12, and none on 10-13 so far.
  - It probably started when security settings were changed during 97(a) on 10-12 [I].
  - It alerts no one, and Renovate owns vulnerabilities here. It is noise, not a finding. The alert list itself answered 403 to this session.
- **An unprotected WIP branch, `claude/p1-45-kit3-sync`** (`39eb1cf8`, 10-12 14:04Z, "WIP P1-45: kit 3 sync-configs templates and red tests (unfinished, handed off)", 10 files). It has no PR. #1301 landed the same work at 16:30Z, so it is probably superseded [I]. _Ask:_ open a PR from it, or say it can go.
- **The Routine's prompt and `docs/pm-pass.md` disagree** (ask 3). The prompt told this session to choose between a morning and an evening pass by the clock. The file has no evening pass now. The pass followed the file.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=0 decision_lines=0 stale=1 stale_fresh=1 scanned=1 older_skipped=38` [M, 11:55Z]. No ask sits only on a branch. The one stale branch is listed above.

## Next for agents

**Ready today:**

- **P1-47**, the Prismic preview exit on kit 3. It is new, and it sits in front of your five promotions. Brief below.
- **P1-33**, the next queued item after (e). Its park ended on 10-12. Item 115's answer reshapes the cutover, so a worker should re-read the row and 115 before choosing.

**Held on you:** P1-46 (ask 4), and the five kit 3 promotions (ask 2).

### Briefs

```markdown
## Worker brief — P1-47: Prismic preview exit on SvelteKit 3

**Item.** P1-47 · open an issue in reddoorla/reddoor-maintenance · 🟡 YELLOW · effort S–M
`@prismicio/svelte` 2.2.2 (the latest) peers `@sveltejs/kit` `^2`, and its
`PrismicPreview` ends a preview with
`goto(url, { invalidateAll: true, noScroll: true })`
(`src/kit/PrismicPreview.svelte:71`) [M, `npm pack`, 2026-10-13]. Kit 3
removed `noScroll` (`goto_options_removed`). Operator decisions 113's worker
read kit 3.0.1's source: it throws under `pnpm dev` and scrolls to the top in
production [I, not run in a browser]. reddoor-starter has been on kit 3 since
reddoor-starter#187. Five client repos carry kit 3 on `staging`, waiting for
the operator to promote them: vida-legacy-foundation, mantis-landscaping,
la-homelessness-youth, gallerysonder and alamo-anatomy.
`@reddoorla/maintenance` still peers kit `^2.0.0` (`package.json:104-106`) [M].

**Verify first.** `npm view @prismicio/svelte version peerDependencies`
Expect: `2.2.2`, kit `^2` [M]. If a newer version supports kit 3, the fix
is a bump. Say so and stop there.

**Start here.**

- reddoor-starter: where `PrismicPreview` is mounted (`src/routes/+layout.svelte`
  or similar), and `package.json`.
- `node_modules/@prismicio/svelte/dist/kit/PrismicPreview.svelte:55-80`.
- This repo: `package.json:104-106` (the peer range).

**Done when.**

1. The failure is reproduced on the starter under kit 3 with a dev server:
   either the thrown `goto_options_removed`, or the scroll jump in a
   production build. If it does not reproduce, report that and stop.
2. The fix is in the starter: a local `PrismicPreview` wrapper or a pnpm
   `patchedDependencies` entry. Pick one, with a test, and file the issue
   upstream in prismicio/prismic-svelte.
3. This package's peer is widened to `^2.0.0 || ^3.0.0`, with a changeset.
4. A one-paragraph port note for the five `staging` branches. Do not push to
   client repos: that is the operator's roll-out.

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
