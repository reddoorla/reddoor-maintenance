# Morning brief — 2026-10-12 (PM pass, Monday, 11:50Z)

## One-line verdict

**Every nightly finished green by 07:12Z, and `fleet-prismic-sync` ran under the conductor for the first time (P1-39 holds). Three things need you. The Williamson cutover is Wednesday, and D0, D6, the poster frames and tomorrow's Netlify-domain and TTL step are all still yours. Two worker PRs (#1294 MSOT, #1295 Vineyard) each wait on a land-or-round-3 answer, and both are numbered Operator decisions 107. SvelteKit 3 reached the fleet overnight. Its Renovate PRs are red in six repos, and the cockpit shows three maintained sites as broken (P1-45).**

This pass started at **11:50Z (04:50 PDT, Monday)** [M, `date -u`]. It covers #1278 (merged 10-11 14:15:20Z) to now. It is the Monday pass: the fleet snapshot was re-read from Turso, P1 was re-ranked from scratch, the do, date or drop list and the one-time two-week check are below, and the `CLAUDE.md` fact-check ran.

Clean [TEST] sends in a row: **0**. The bottom row, Vineyard (10-05), names the 78. No row is `awaiting`, so no [TEST] verdict is asked today [M, BACKLOG table].

Open asks: 16 (items 13, 14, 15, 18, 31, 33, 45, 57, 61, 72, 78, 79, 81, 82, 87, 97); oldest: item 97, 706 h [I]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. Three items from the 10-11 line close in this PR: **67** is done (the Prismic connector now answers on erp-industrial, alamo-anatomy and vineyard-custom-homes, while the-tower-burbank and the-pointe-burbank still refuse) [M], and **7** (D0, D6) and **74** (the poster frames) close as carried by P0-5, which is dated 10-14. They stay in the top of stack through that row. Items 101 to 106 were all answered on 10-11 and 10-12. The new item **107** (the two-week check) and the two asks on branches (#1294, #1295) are not counted, because none is on `main` yet.

## Top of stack (yours; ordered by date)

1. **Tue 10-13 and Wed 10-14: the Williamson cutover (P0-5).**
   - **Tue 10-13 (🔴, yours):** add the custom domains in Netlify, and lower the `www` TTL from 3600 to 300 at GoDaddy. The checklist is `docs/runbooks/williamson-cutover-2026-10-14.md`.
   - **Still open:** **D0**, what Webflow billing stops on 10-19, and **D6**, who receives Construction's `/join-the-team`.
   - **Item 74's three poster frames** are unpublished: williamson-construction has published no document since 10-05, and it holds no release [M, Prismic].
   - On Wednesday, `node scripts/williamson-cutover-verify.mjs` turns GREEN once the cutover has worked.
2. **New 10-12 04:26Z: #1294, MSOT accessibility (P1-43, medical-solutions-of-texas#77).** It is built to your 106 answers. The nightly's lhci config scores the build 1.0 ×3, against 0.92 on `main`, and round 2 found no page defect.
   - _Ask:_ (1) land #77 on green CI with no third round; run a third round first; or hold. (2) For the 390 px video case, about 2.4:1 on bright frames [I]: file it as an issue, or strengthen the phone scrim before landing.
   - _Worker's pick:_ (1) land, (2) file it.
3. **New 10-12 04:41Z: #1295, Vineyard accessibility (P1-44, vineyard-custom-homes#77).** The nightly's 0.88 was reproduced on production, and the deploy preview scores 1.00 ×3. Round 2's one major (the project page's medallion) was fixed by restoring `main`'s markup in that file.
   - _Ask:_ (A) land #77 at `7768390` with no third round; (B) run a third round first; or (C) narrow the medallion back to `/` only.
   - _Worker's pick:_ (A).
   - **Either way:** Prismic release `asxLxxIAAEc3J2qU` (the tile's alt text) is staged and unpublished [M]. Publishing it rebuilds the prerendered home page.
   - **Both docs PRs number their item 107** [M, both diffs]. This PR adds the next item, which prettier numbers 107 on `main`. Prettier renumbers an ordered list when a branch merges `main`, so the two land as 108 and 109; the asks inside them are unchanged [I].
4. **New 10-12: SvelteKit 3 is red in six repos (P1-45).** `/s/la-homelessness-youth`, `/s/sonder` and `/s/vida-legacy-foundation` each show "2 Renovate PRs failing CI" [M, cockpit]. These are the `@sveltejs/kit` 3 and `adapter-netlify` 7 majors, and kit 3 refuses `svelte.config.js` [M, vida-legacy-foundation#97's log].
   - **Nothing to click on the sites.** Leave the twelve PRs open and unmerged.
   - _Ask:_ say "go P1-45", and a worker migrates reddoor-starter first and writes the fleet plan (brief below). The same two PRs are red in williamson-construction-co, mantis-landscaping and alamo-anatomy, which the cockpit does not flag [M]. More will follow as Renovate reaches each repo [I].
5. **Since 10-09: tell Erik that Hedloc and Roalson are done.** Both of his asks are still unanswered in Discord, at 68 h and 62 h [M]. Shankar has been live on Hedloc's Executive Team page since 10-11, and the Roalson pre-launch notes have been live since the same day (P1-40 and P1-41 in Done). A reply for Erik is in hedloc#55's body (Operator decisions 104) [M]. Roalson's should be in the body of roalson-interests#283, P1-41's last PR, as its brief asked [I].
   - Nicole's "we are losing the map now?" (10-09 21:58Z) has had no reply in Discord. The Projects line below says what the live homepage shows.
6. **Item 81: four Dropbox file requests are still open** [M, `list_file_requests`]: `jh6y6vw6vpc8u4ip4a71`, `iyz37ta31o0q6luhveaj`, `ppalikt0nhktpla2iawb` and `szf5iq8hu7vj0if46524`. Close them under Dropbox → File requests.
7. **New: Operator decisions 107, the two-week check** (below): keep or cut five practices.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

12 channels were active in 14 days, with 68 candidate mentions and 7 open [M, 11:53Z]. All seven are older than two days. Three of them are asks, and all three are ask 5 above:

- **#hedloc-web, Erik, 10-09 15:34Z and 20:44Z:** the 4th Executive Team slot for Shankar; he asked to be told once it was added.
- **#roalson-interests, Erik, 10-09 21:46Z:** the final pre-launch notes, addressed to you.

The other four are not asks: Tim's auto-post thread in #rd-marketing (10-06), Erik's "Happy writing" in #caltex (10-06), Tim's banter in #water-cooler (10-07), and Erik's Zoom check-in in #reddoor-project-list (10-08), whose time has passed.

**Positive control:** 12 of 14 reaction lookups found your reaction, and 58 asks were closed by a later post from you. A 21-day window finds the same 7 open. One channel, `#rd-paperwork`, answered 403 and was not read. Your last post anywhere was 10-11 14:18Z in #williamson, asking for the cutover to be this week's priority.

## Do, date or drop

The controls are as above. Each line was first listed on **2026-10-12**: no earlier Monday report had this section. Answer each line with **done**, **a date**, or **drop and why**. The minutes come from the source, and all are [I].

1. **97(a)**, asked 09-13 01:21Z: enable org-wide secret scanning and push protection, for existing repos and by default. Route: org Settings → Code security. ~3 min. This also closes the scanning half of 33(d).
2. **97(b)**, 09-13: clean the laptop `.env`. Delete `DROPBOX_ACCESS_TOKEN`, `GOOGLE_SEARCH_API_KEY`, `TURNSTILE_SECRET_KEY_1` and the 11 legacy `<SITE>_PRISMIC` names, and keep `FIGMA_PAT`. Say where `report-edit.env`'s keys belong, and remove the dead `GITHUB_TOKEN` PAT. ~10 min.
3. **97(c)**, 09-13: keep, fold or archive each of `src/blux`, `src/webflow` and canvas-starter. Route: a three-word reply. Minutes: unknown.
4. **97(d)**, 09-13: say what `#trinity-law-school` is, and whether fleet output should reach it. A one-line reply. ~10 min.
5. **97(g)**, 09-13: one off-GitHub destination for the nightly backup, keeping a copy a month. Pick the destination, and a worker wires it. Minutes: unknown.
6. **97(h)**, 09-17: reply to or close the Rick Garcia lead thread. Route: Gmail. Minutes: unknown.
7. **13**, asked ≥ 09-29 (≥ 317 h): add referrer and API restrictions to the three Google Maps keys in GCP, then close the four alerts (#754). Minutes: unknown.
8. **14**, ≥ 09-29: pick promotion identity A, B or C, so reddoor-website `staging` can be promoted to `main` (#623 → #545). Route: a reply with the letter. Minutes: unknown.
9. **18 #773**, ≥ 09-29: the laptop's local-only git objects. Route: a laptop session. Minutes: unknown.
10. **97(e)**, 09-29: post the B7 team note (`docs/operating-model-rollout.md:60-66`) in Discord, or say it is posted. Minutes: unknown.
11. **97(f)**, 09-29: add the four B8 vendor Gmail filters (`operating-model-rollout.md:68-79`). Minutes: unknown.
12. **15**, 09-29: on the laptop, `git am` `docs/patches/2026-09-29-github-renovate-grouped-pr-immediate.patch` in a `.github` checkout, and open the PR. Minutes: unknown.
13. **18 #672**, 09-29: mark up `docs/cockpit-design-brief-2026-09.md`. Minutes: unknown.
14. **31**, 09-30: book the five form-e2e client PRs (ERP, then Revogen, Data Dynamiq, LAHI, LA Homelessness Youth), one per site in its release window, and say whether you want the per-site contact-path column. Route: "go". Minutes: unknown.
15. **33(d)**, 09-30: branch protection and secret scanning on williamson-homes and williamson-construction-co; the webhooks are done. Route: repo Settings, or 97(a). Minutes: unknown.
16. **18 #674**, 09-30: accept or cut the 34 new design-review rule candidates, choose the encode order, and decide whether N4 stays cut (`docs/design-review-rules-2026-09.md`, last section). Minutes: unknown.
17. **45**, 09-30: send the starter's DRAFT privacy template to a lawyer once, with the three 10-04 questions. Route: email. Minutes: unknown.
18. **45**, 09-30: decide whether clients hear about the privacy page before it goes live (pick: a line in the next Maintenance email). Minutes: unknown.
19. **61.2**, 10-01: ask Nicole who holds Mantis's Squarespace Domains and who changes the apex `A` and `www`. It was deferred until the client has reviewed the build. Minutes: unknown.
20. **57(a)** 🔴, 10-01: mint a Custom Types write token and set `PRISMIC_WRITE_TOKEN` for vida-legacy-foundation, then `reddoor-maint prismic-ci`. the-tower-burbank is probably moot under 57(d) [I]. Minutes: unknown.
21. **57(b)**, 10-01: `prismic-ci` against reddoor-website `main` once reddoor-website#237 has merged. Route: say go. Minutes: unknown.
22. **57(c)**, 10-01: one throwaway reformat PR per site, to exercise each site's own secret. Route: say go. Minutes: unknown.
23. **57, phase 5**, 10-04: "Switch to type builder" and set the simulator URL in 13 Prismic repositories. Route: each repo's Prismic dashboard. Minutes: unknown.

Just under the 168 h line, and so listed next Monday: 72's token rotation, 78, 79, 81, 82 and 87.

## Two-week check

This is the one-time check of the operating model that began on 09-29, measured on `main` at `8602f123` [M]. A row is judged only if its method reproduced the baseline first, and every judged row did.

| Measure | Baseline | Now | Moved |
| --- | --- | --- | --- |
| Discord asks older than two days, per report | 1, 1, 0, 0, 0 (09-30 to 10-06) | 0, 0, 0 (10-07, 10-08, 10-11), 0 today | yes, and held |
| Duplicate-work incidents | 6 (7 grep headings, one false) | 6 (8 headings; the new 10-07 one is a false hit: "twice" counts skeptic rounds) | yes, none since 10-07 |
| Two-dirty-round escalations | 27 at `6ea7c10` | 36: 92, 94, 95, 96, 99, 101, 103, 104, 105 added; about 3.7 a day before 10-06, 1.5 a day since | in use, rate down |
| PRs that ran a third round | 10 items at `6ea7c10` | 16 items, 17 PRs: 92 (#1232, six rounds), 95, 96, 101, 104, 105 (×2) | up, by your choice of (b) on 101, 104 and 105 |
| Open asks | 18 items at `6ea7c10` | 16 items | down: 67, 74 and 88 left the set; 97 joined it. 7 joined on 10-11 and left today |
| Release-PR wait, median | 15.56 h, n=7 | 17.26 h, n=8; #1214 waited 123.25 h | wrong way |
| [TEST] verdicts awaiting | 5 (10-06), 0 (10-07) | 0, with no [TEST] send since 10-05 | nothing to judge |

Not judged: minutes per morning (dropped), days a zero-blocker report waited for its click (no instrument), asks answered and their latency (frozen at 10-06), and fix-of-fix PRs (no definition).

**The keep-or-cut ask** is Operator decisions 107: keep or cut the two-round stop, the open-asks line, do, date or drop, the evening pass, and the clean-send table. The pick is to keep the first four, and to keep the table only if a [TEST] send is booked. This PR removes the check's bullet from `docs/pm-pass.md`, as that bullet asked.

## Projects

1. **Williamson Construction**: building; cutover Wed 10-14. Nothing moved since 10-11 [M].
   - Still on Webflow: the apex `A` is `198.202.211.1`, `www` is a CNAME to `cdn.webflow.com.` with TTL 3600 (not yet lowered), and the page carries `data-wf-site`.
   - The netlify.app canonical has not changed yet; that is Tuesday's runbook step.
   - Renovate's kit 3 and adapter 7 PRs (#28, #27) are red, as in the client repos.
   - Next: Tuesday's domain and TTL step, then D0, D6 and the frames (ask 1). All yours.
2. **Williamson Homes**: building; the same cutover, with the same DNS state [M]. `main` is `62113b5` (10-06), and Renovate opened no kit 3 PR here. No change.
3. **Mantis Landscaping**: building; still blocked on Operator decisions 61.2 (DNS) and 78 [M]. The kit 3 and adapter 7 PRs (#41, #40) are red; nothing else is new. `main` is `6e87f02` (10-06).
4. **Roalson Interests**: building. Erik's pre-launch notes are live (P1-41: #281, #282 and #283 landed 10-11, and the release is published) [M].
   - The homepage map is gone from the live page: no maplibre, no canvas. The Properties page's new ALL view keeps every listing on one map [M].
   - Nicole's objection has had no reply in Discord, so tell her and Erik together (ask 5).
   - Erik's listing-PDF notes promised for Monday had not been posted by 11:53Z [M]. Follow-ups are roalson-interests#286 to #288.
5. **CalTex**: maintained. No change [M]. #66 (all-minor-patch, 09-21) is green and still unmerged.
6. **Gift of Life Alliance (GOLA)**: no change. The last #gift-of-life-alliance message is yours, 10-01 [M]. There is no repo called `gift-of-life-alliance` to attach [M, `add_repo`: not found].
7. **Alamo Anatomy and Hedloc**: launching.
   - **Hedloc:** Shankar went live 10-11 (hedloc#55, `2641a0e`) [M]. Erik has not been told (ask 5). #53, your move off Slice Machine, is open, 8 days old and green.
   - **Alamo Anatomy:** no change. Its kit 3 and adapter 7 PRs (#68, #67) are red, and so are their Netlify deploy previews [M].

None of the seven repos records GitHub deployments, so "last production deploy" is read from Turso's `last_deploy_at` instead: CalTex 10-06 19:50Z, Alamo and Hedloc 07-04, and null for the four building sites [M].

## What landed since the 10-11 report [M, pulls API]

- **Release #1214** (0.106.0) merged 10-11 17:50Z, after 123 h open. **#1222**, `sharp` 0.35.5 [security], merged 14:23Z.
- **Code:**
  - #1280, the Williamson cutover checklist and verifier (P1-42), after round 3.
  - #1287, the conductor dispatches `fleet-prismic-sync` right after drift (P1-39).
- **Docs:** #1281, #1282, #1283 and #1284 (Operator decisions 101 to 105); #1286, #1289 and #1292 (Hedloc, P1-40); #1288 and #1291 (Roalson, P1-41); #1290 (P1-39's journal); and #1293 (P1-43, Operator decisions 106).
- **Done in client repos on 10-11:**
  - hedloc#55 (`2641a0e`): Shankar is live.
  - roalson-interests#281, #282 and #283, with their Prismic release published.

**Open PRs** [M, 11:56Z]: #1294 and #1295, both docs-only, both by workers, both green with `build` and `clean`. Each holds an ask (top of stack 2 and 3). No release PR is open.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-11T14:15:20Z`) [M]

`PM_COCKPIT_SUMMARY broken=3 watch=1 approval=0 sites=17 new=3`, `just_wait_left_out=1`.

- **Needs you:** LA Homelessness Youth, Sonder and Vida Legacy Foundation, each `NEW` and each "2 Renovate PRs failing CI (first flagged 2026-10-12)". All six PRs are the kit 3 and adapter 7 majors (ask 4).
- **Watch:** LA Homelessness Initiative, Search Console "no property matched www.lahomelessnessawareness.org (lookup 2026-10-05)", unchanged.
- **Also open in those repos, and not red:** the 10-06 `sharp` [security] pairs (gallerysonder #111 and #112, vida-legacy-foundation #94 and #95, reddoor-starter #185 and #186). They are held by the fleet preset, as #1222 was here.

**Reports due in the next 14 days** [M, a SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports]:

- ERP Industrials Maintenance, **10-25**. After it: 1836dig 10-31, Sonder 11-01, Beachfront Dentistry 11-08, CalTex and MSOT 11-21.
- Nothing is pending approval.
- **Control:** `approveBlockers` on Espada, with its recipients and contact blanked, returns `recipients-missing`.

## Nightlies (created ≥ 10-11 14:00Z) [M, Actions API and job logs]

All 20 non-PR runs in the window concluded `success`. None is in progress or queued.

| Night | Conductor (06:07Z clock) | Summary | Last completion | Fallback cron |
| --- | --- | --- | --- | --- |
| 10-12 | 38210992273 | `dispatched=8 completed=8 wait_exceeded=0 skipped=0 dispatch_failed=0 total=8` | 07:11Z (daily-reports, 1.5 min) | 09:15Z, `skipped=8` |

What each nightly printed:

- **fleet-db-backup:** `DUMP_VERIFY loaded=true tables=11 rows=1153 blob_bytes=11433275 hashed=11 mismatches=0`, on both the plain and the encrypted dump.
- **fleet-prismic-drift:** `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15`.
- **fleet-prismic-sync (first conducted run):** `PRISMIC_SYNC_FETCH sites=15 build=0 in_sync=11 skipped=4 failed=0`, then `PRISMIC_SYNC_SUMMARY sites=15 opened=0 updated=0 unchanged=0 closed=0 in_sync=11 would_open=0 held=0 declined=0 skipped=4 failed=0`. P1-39's fix holds.
- **fleet-security:** `wrote=15 failed=0`, `PROTECTION_AUDIT gaps=13 covered=17 skipped=7 total=37` (unchanged, #754), and `PACKAGE_MANAGER_PIN gaps=5 fleetPin=pnpm@12.5.1`.
- **fleet-lighthouse:**
  - `wrote=15 failed=0` and `wrote=23 failed=0`.
  - `LIGHTHOUSE_FAILURES` on accessibility again: MSOT 0.92 (color-contrast, heading-order) and Vineyard 0.88 (image-alt, color-contrast). These are asks 2 and 3.
- **fleet-smoke:** `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`.
- **fleet-form-e2e:** `wrote=15 failed=0`.
- **daily-reports draft:** "No reports due." The digest went out (`DIGEST_STATE_WRITE turso=1 rollup=1`, `DIGEST_SEND_LOG write=1 decision=added`), which is the first non-skipped digest since 10-08. The added content is the three broken sites [I].
- **Sends:** the 10-11 16:07Z send found "No reports ready to send". Its fallback (18:10Z) printed "a send run succeeded since 2026-10-11 (1), so the fallback sends nothing". There was no `clock-missed`, `send-clock-missed` or `send-run-failed`.
- **Weekly fleet-config-drift** (10-11 14:10Z): `SYNC_CONFIGS_DRIFT drifted=15 clean=0 skipped=0 total=15`, the same as 10-04. #1007 is updated and still open.
- **Also green:** release-health (10-11 19:07Z), renovate, forms-deadletter-replay and pm-pass-watch.

**Pending:** today's 16:07Z send and release-health.

**Tracking issues:** #1279 and #1285 closed on 10-11 with their PRs. #754, #490 and #1007 were updated by bots. Nothing opened. No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Closed:** #1279 (P1-42), #1285 (P1-39).
- **Updated:** #754, #490, #1007.
- **Opened:** none in this repo.
- **Filed in client repos by workers:**
  - medical-solutions-of-texas #76, #78 and #79.
  - vineyard-custom-homes #76 and #78.
  - roalson-interests #286, #287 and #288.

## What went wrong, or nearly did

- **A refute guard read a SHA out of its own documentation.** On its first run, the refute-claims round stopped with "evidence not at main's head". It reported `remoteMain` as `aed93a31…`, which is the example SHA in the workflow file's own comment. `git ls-remote origin refs/heads/main` returned `8602f123`, the same as the checkout [M]. The guard is a Haiku agent, so its reading of `ls-remote` is a reading, not a measurement. The second run's guard read `8602f123` for all three, and the round went on.
- **Two workers chose the same Operator decisions number, 107, about 15 minutes apart, and so does this PR's two-week item, since prettier numbers it after 106** (#1294 at 04:26Z, #1295 at 04:41Z). Vineyard's Prismic release label also says "P1-43", because MSOT took that P1 number mid-flight. The two-dirty-round rule says to write the line on its own branch first, and neither worker could see the other's branch. `evening-branches.mjs` caught both [M].
- **Two items still share the number 99** (one sits after "Active projects"), and **53 appears twice with no 56** [M]. A later docs PR should renumber them; this PR does not, so that it stays off the lines the open PRs touch.
- **The table kept its row order in the re-rank.** #1294 edits P1-43's row, so moving rows would have made it DIRTY. The rank is written in the backlog header instead.

## Refute the week's claims

Ten [M] claims from the 10-08 and 10-11 reports went through `refute-claims` against `main` at `8602f123`. Each had one Opus skeptic, and the round had a completeness critic. The claims file and evidence are in the session log (`.session-logs/refute-claims-2026-10-12.json`), which is not committed.

**Result: 8 confirmed, 1 refuted, 1 untested.**

- **Confirmed:**
  - the send fallback's `23 13 * * *`;
  - `pm-pass-watch.mjs` keys on `## One-line verdict` and `## Evening`;
  - the two items numbered 99;
  - #779's title still says "five";
  - the plan's §7 OD7-P4 brief, and the §2.1, §2.2 and §4 anchors;
  - the clean-send table's bottom row;
  - the Routine's `48 4,12 * * 1-4`.
- **Refuted:** the 10-11 report's "`fleet-prismic-sync`'s only trigger is `workflow_run` on `fleet-prismic-drift`". It was true when written. #1287 (10-11 18:07Z, four hours later) made the trigger `workflow_dispatch` only, and the conductor now dispatches the sync. This PR adds a forward pointer to the 10-11 report.
- **Untested, then measured:** "client sends fire daily at 16:07Z". The skeptic's experiment was run: `daily-reports send` dispatch runs were created at 16:07:05–07Z on 10-09, 10-10 and 10-11, all `success`. That is every day since the clock went live on 10-08 at 16:50Z [M].

## `CLAUDE.md` fact-check

**CLAUDE.md fact-check: head `8602f123`, 10 lines: 9 confirmed, 0 refuted, 1 untested.**

- **Range:** the base is `ebcd0dc2` (`--before=2026-10-05T11:50Z`, #1150), and 109 added lines from #1158, #1162, #1176, #1188, #1211, #1218, #1224, #1225 and #1232. This is the first fact-check, so the next one lists from `8602f123`.
- **Confirmed:**
  - the frozen `workJournal.md` and its test;
  - the `docs/journal/` naming (all 33 files match);
  - `main`'s strict up-to-date rule (REST ruleset);
  - this repo is public and reddoor-workspace is private with no workflows (REST);
  - the backlog's answered form (12 matches);
  - #1143's ask gap, measured at 13.8 h (dee49526 at 10-04 22:21Z, then `main` at 10-05 12:07Z), against the line's "13 hours";
  - #918's round two on 09-23 and the backlog on 09-29;
  - the stop hook checks only its own checkout.
- **Untested:** the GitHub connector's 403 on creating an org repo. The only record is the source the line cites, and testing it would mean creating a repo.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY asks=2 decision_lines=0 stale=0 stale_fresh=0 scanned=2 older_skipped=38` [M, 11:56Z]. The two asks are #1294 (`claude/sweet-wright-24ypgx`) and #1295 (`claude/upbeat-ride-g46w2q`), both lifted above. No branch is unprotected. `claude/jolly-keller-9h8tzh` has aged out of the 7-day scan.

## Next for agents

**Ready today:**

- **P1-45**, the SvelteKit 3 migration: the starter first, then a fleet plan. Brief below.
- **P1-33(e)**: the operator parked P1-33 until today. Its brief needs the private workspace's recommendations, so a worker writes its own from the row.
- **P1-31**: unchanged.

**Held on you:** P1-43 (#1294) and P1-44 (#1295).

### Briefs

```markdown
## Worker brief — P1-45: SvelteKit 3 and adapter-netlify 7, the starter first

**Item.** P1-45 · open an issue in reddoorla/reddoor-maintenance · 🟡 YELLOW · effort M
Renovate opened `@sveltejs/kit` 3 and `@sveltejs/adapter-netlify` 7 in three
client repos overnight 10-12, and all six PRs are red: la-homelessness-youth
#29/#30, gallerysonder #113/#114, vida-legacy-foundation #96/#97 [M]. The
cockpit lists the three sites as broken. Kit 3 refuses `svelte.config.js`
("`svelte.config.js` is no longer used. Please pass configuration via the
`sveltekit(...)` plugin in your Vite config", `config_file_unsupported`) [M,
vida-legacy-foundation#97's `ci / ci` log].

**Verify first.** `gh api 'repos/reddoorla/vida-legacy-foundation/pulls?state=open' --jq '.[].title'`
Expect: both majors open [M, 2026-10-12 ~11:55Z]. Then
`gh api repos/reddoorla/reddoor-starter/contents/package.json --jq .content | base64 -d | grep sveltejs`
Expect: kit `^2.61.1` and adapter-netlify `^6.0.4` [M].

**Start here.**

- reddoor-starter: `svelte.config.js`, `vite.config.ts`, `package.json`.
- This repo: `src/recipes/sync-configs/templates.ts:66`. `svelte.config.js` is
  a synced template, so the fleet's copy comes from here, and
  `fleet-config-drift` reads it.
- The kit 3 migration guide (svelte.dev). Read it, and the adapter 7
  changelog, before editing.

**Done when.**

1. A plan in `docs/` names, for kit 3, each config key the fleet uses and
   where it moves. It also covers what `sync-configs`, `kit.csp` (the CSP
   baseline) and the prerender settings need, and gives a roll-out order.
2. reddoor-starter is migrated in one PR: CI green, `@smoke` passing,
   Lighthouse unchanged.
3. `sync-configs`' templates match the starter.
4. The fleet roll-out itself is an operator decision. Write it as one
   "Operator decisions" line, and do not push to client repos.

**Mutations I will run** (each must turn a test red):

1. Leave `svelte.config.js` in place beside the plugin config.
2. Drop `kit.csp` from the moved config.
3. Template drift: the starter differs from `templates.ts`.

**Stop conditions** (beyond AUTONOMY.md's six):

- Do not merge or close the client Renovate PRs (twelve, in six repos).
- A fleet-wide push is 🔴.
- If kit 3 needs Svelte 6 or a Vite major the fleet is not on, stop and
  write the scope up.
- Two dirty review rounds → "Operator decisions", not a third round.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** Check fresh `claude/*` and `fix/*` branches here and in
reddoor-starter first. Use a worktree, and land the starter PR under its
ruleset. Here, the plan and the template change go in one PR via
`node scripts/land-prs.mjs`, with a journal entry as a new file in
`docs/journal/`.
```
