# Morning brief — 2026-10-11 (PM pass, Sunday, 13:52Z)

> Superseded in part by 2026-10-12 — Morning brief (its "Refute the week's claims"): `fleet-prismic-sync` is dispatched by the conductor since #1287, no longer only by `workflow_run`.

## One-line verdict

**All four October Maintenance reports have gone out, nothing is due before ERP on 10-25, and every nightly on 10-09, 10-10 and 10-11 finished green by 07:12Z, so P1-38 is done. Three things need you before Wednesday. The Williamson cutover on 10-14 still needs D0, D6, the poster frames and Tuesday's domain step. Erik relayed two client asks on Friday that nobody has answered: Hedloc's 4th Executive Team slot, due the week of 10-12, and Roalson's pre-launch list. And `fleet-prismic-sync` has not run for three nights without raising any alarm (P1-39).**

This pass started at **13:52Z (06:52 PDT, Sunday)** [M, `date -u`]. It covers #1254 (merged 10-08 12:06:26Z) to now. The Routine's documented schedule is Monday to Thursday (`48 4,12 * * 1-4`). This fire came on a Sunday, so either the schedule changed or the pass was started by hand [I]. The operator was live during the pass and asked for Discord, the fleet state, and work to run in the background today.

Clean [TEST] sends in a row: **0**. The bottom row, Vineyard (10-05), names the 78. No row is `awaiting`, so no [TEST] verdict is asked today [M, BACKLOG table].

Open asks: 19 (items 7, 13, 14, 15, 18, 31, 33, 45, 57, 61, 67, 72, 74, 78, 79, 81, 82, 87, 97); oldest: item 97, 684 h [I]. **Control:** the clone is not shallow, item 13 dates to 2026-09-29T06:53:39Z, and item 3 is absent. Two items from the 10-08 line close in this PR. **90** is live on www.caltexmedical.com, and the operator told Erik "both fixed" (10-06 20:08Z). **91** closes because all four drafts are sent. Item 7 stays open on D0 and D6, and its D7 is answered (see ask 1). Items 98, 99 and 100 were added and answered on 10-08.

## Top of stack (yours; ordered by date)

1. **Before cutover Wed 10-14: Williamson Construction and Homes (P0-5).**
   - **D7 is settled** [M, Discord #williamson]. Tim holds GoDaddy and sent you the invite, and you wrote "I got the dns delegation" at 10-05 23:06Z. The backlog still listed D7 as open, and this PR records the answer.
   - **Still open:** **D0**, what Webflow billing actually stops on 10-19, and **D6**, who receives `/join-the-team`.
   - **Item 74's three poster frames** are still unpublished. No williamson-construction document has been published since 10-05 [M, Prismic `list_document_publications`].
   - **Tim's MarkUp tweaks** ("later this week", 10-05 16:50Z) have not reached Discord since [M].
   - **The plan's Tue 10-13 step** is yours (🔴): add the custom domains in Netlify, and lower the `www` TTL from 3600 to 300 at GoDaddy (`docs/webflow-conversions-2026-10.md` §4).
   - **A worker can build the cutover checklist and verifier today** (P1-42, brief below).
2. **Week of 10-12 to 10-16: Hedloc, a 4th Executive Team slot for Shankar Annamalai** (Erik in #hedloc-web, 10-09 15:34Z and 20:44Z; no reply yet) [M, Discord].
   - **The change:** slide the three left, make the row 4 wide, and add Shankar's bio and headshot, which are linked from Dropbox in Erik's message.
   - **Today's state:** the live page shows 3 members (Ben Friedman, Dan Hord, Jack Harper) [M, hedloc.netlify.app].
   - **_Ask:_** to let a worker add the content, activate the Prismic MCP for `hedloc` (hedloc.prismic.io → Settings → MCP), because the connector answers "Prismic MCP is not activated for repository hedloc" [M]. Otherwise you enter Shankar by hand and the worker does only the layout (P1-40, brief below).
3. **Since 10-09 21:46Z: Roalson, Erik's "final website notes before launch"** (#roalson-interests, about 11 changes, P1-41) [M, Discord].
   - **_Ask:_** settle "lose map entirely" on the homepage with Erik and Nicole first. Nicole objected at 21:58Z ("we are losing the map now?"), and Erik has not answered.
   - **Everything else on the list can go to a worker today** (brief below).
   - Erik adds notes on the listing PDFs on Mon 10-12.
4. **Since 10-06: release PR #1214** (`chore(release): version packages`, 0.106.0). It has been open 119 h, `build` is green on `c720258f`, and it is `clean` [M]. It carries Unapprove, the Search Console write-back, the refresh-preview score write-back, the spam pass and the digest subject. Yours to merge, as always.
5. **Since 10-06: #1222, `sharp` 0.35.5 [security].** `build` is green on `7d7fd12a`. It is `mergeable`, but its `mergeable_state` is `behind` [M]. The fleet preset holds it ("Automerge: Disabled by config"), so this is a rule working. _Ask:_ merge it, or say "land #1222" and this session updates the branch and lands it.
6. **Item 81: close four Dropbox file requests, not one** [M, Dropbox `list_file_requests`]. The 10-08 one (`jh6y6vw6vpc8u4ip4a71`) and three from the 09-29 refresh (`iyz37ta31o0q6luhveaj`, `ppalikt0nhktpla2iawb`, `szf5iq8hu7vj0if46524`) are all open. Each is described as temporary. Close them under Dropbox → File requests.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

**No ask is older than two days** [M, 13:53Z]. 13 channels were active in 14 days, with 68 candidate mentions and 7 open. Four of the open ones are older than 48 h, and none of those is an ask:

- Tim's Instagram reply in #rd-marketing (10-06), which you answered with a reaction on his next message.
- Erik's "Happy writing" in #caltex (10-06).
- Tim's remark in #water-cooler (10-07).
- Erik's Zoom check-in in #reddoor-project-list (10-08), whose time has passed.

The other three are asks 2 and 3 above. Hedloc's first message turns 48 h at 15:34Z today.

**Positive control:** a 21-day window finds the same 13 channels, 90 candidates and 7 open. Of the 43 messages checked for reactions, your reaction was found on 30. Your last post anywhere is 10-08 19:42Z.

## Projects

1. **Williamson Construction**: building; cutover Wed 10-14. D7 is settled. D0, D6, the poster frames and Tuesday's domain step are yours. Tim's MarkUp tweaks are his. The checklist and verifier can start today (P1-42). [M]
2. **Williamson Homes**: building; the same cutover. Tim called it "good to move over" on 10-05. Its Turso row now has `git_repo` `reddoorla/williamson-homes`, where the backlog last said null. No other change. [M]
3. **Mantis Landscaping**: building; still blocked on Operator decisions 59–62 (P1-30). No change. [M: no release, no Discord activity in the window]
4. **Roalson Interests**: building. Since 10-08:
   - The 10-05 final round went live at 18:13Z: 14 crops, 8 pins and the Spencer Ranch listing.
   - Its package was swapped for the new-template build at 19:30Z [M, Prismic publications].
   - Erik's pre-launch list is in (ask 3), and his PDF notes come Monday.
   - The package generator is still only on unmerged branches, and the other 22 listings still link the old packages.
   - Next: the map call (Erik and Nicole), then a worker (P1-41). [M]
5. **CalTex**: maintained. Item 90 is closed: the AED Programs labels are live, and Erik was told. No message since 10-06. No change otherwise. [M]
6. **Gift of Life Alliance (GOLA)**: no change. The last #gift-of-life-alliance message is from 10-01 (the proposal's timeline). [M]
7. **Alamo Anatomy and Hedloc**: launching. Hedloc has a client ask for the week of 10-12 (ask 2). No change for Alamo. [M]

## What landed since the 10-08 morning report [M, pulls API]

Since the 10-08 evening section, one PR has merged: **#1275**, the Roalson Spencer Ranch package in the new template (10-09 14:24Z). Nothing has merged since.

**Open PRs** [M, 13:55Z]: #1214 (release, green, `clean`) and #1222 (Renovate security, green, `behind`, held by the preset). None is red or a draft.

## Cockpit (`scripts/pm-cockpit.mts --since 2026-10-08T12:06:26Z`) [M]

`PM_COCKPIT_SUMMARY broken=0 watch=1 approval=0 sites=17 new=0`, `just_wait_left_out=1`.

- **Needs you:** none.
- **Watch:** LA Homelessness Initiative, "Search Console: no property matched www.lahomelessnessawareness.org (lookup 2026-10-05)". Its report has sent, and the next draft's lookup replaces the line. No item names it.

**Reports due in the next 14 days** [M, SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports]:

- ERP Industrials Maintenance, **10-25**.
- After that, 1836dig on 10-31, Sonder on 11-01 and Beachfront Dentistry on 11-08.
- Nothing is pending approval.
- **Control:** `approveBlockers` on Espada, with its recipients and contact blanked, returns `recipients-missing`.

## Nightlies (created ≥ 10-08 12:00Z) [M, Actions API and job logs]

All 203 runs in the window concluded `success`. None is in progress or queued.

| Night | Conductor (06:07Z clock) | Summary                                                                  | Last completion | Fallback cron (02:17Z)       |
| ----- | ------------------------ | ------------------------------------------------------------------------ | --------------- | ---------------------------- |
| 10-09 | 37891873838              | `dispatched=7 completed=7 wait_exceeded=0 skipped=0 dispatch_failed=0`   | 07:09:34Z       | 09:07Z, skipped 7            |
| 10-10 | 38029824884              | same                                                                     | 07:07:14Z       | 08:31Z, skipped 7            |
| 10-11 | 38117009870              | same                                                                     | 07:11:48Z       | 08:54Z, skipped 7            |

What each nightly printed:

- **fleet-db-backup:** `DUMP_VERIFY loaded=true tables=11 rows=1141|1149|1153 blob_bytes=11433275 hashed=11 mismatches=0`.
- **fleet-prismic-drift:** `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15`. 11 sites match Prismic.
- **fleet-security:** `wrote=15 failed=0`. It also printed `PROTECTION_AUDIT gaps=13`, the same as on 10-08, which updates #754, and `PACKAGE_MANAGER_PIN gaps=5 fleetPin=pnpm@12.5.1`.
- **fleet-lighthouse:**
  - Two summary lines, `wrote=15 failed=0` and `wrote=23 failed=0`.
  - `ROSTER_URL_SUMMARY checked=34 pass=32 fail=0`.
  - `LIGHTHOUSE_FAILURES` every night on accessibility: MSOT at 0.92 and Vineyard at 0.88.
- **fleet-smoke:** `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0`.
- **fleet-form-e2e:** `wrote=15 failed=0`. 7 of 15 sites self-skip with no `forms.testMode`. Issue #779's title still says five.

Daily reports:

- **Drafts:** 0 new on each of the three nights. The digest was skipped as unchanged on 10-09 and as "nothing ready, nothing needs attention" on 10-10 and 10-11.
- **The 16:07Z send clock:** it sent **Data Dynamiq** on 10-09 (run 37956759187) and found nothing ready on 10-10. Its fallback sent nothing both days, as designed.
- **Logs:** no `clock-missed`, no `send-clock-missed`, no `send-run-failed`.

**fleet-prismic-sync has not run since 10-08 11:44:55Z** (P1-39). Its only trigger is `workflow_run` on `fleet-prismic-drift`. It followed all three scheduled drift runs (10-06 to 10-08) and none of the three that the conductor dispatched with `github.token` [M].

**Pending, not yet created:** fleet-config-drift (Sunday's weekly job, which started at 13:18Z last week), release-health, today's 16:07Z send, and the later renovate and forms-deadletter-replay slots.

**Tracking issues:** none opened or closed since 10-08 16:50Z. #1257, #1258, #1261 and #1262 closed on 10-08 with their PRs. #754 and #490 were updated by bots. No "Nightly … failing" issue is open [M].

## Issues since the last report [M]

- **Closed:** #1257 (P1-37), #1258 (P1-38), #1261 (P1-36), #1262 (Unapprove), all on 10-08.
- **Updated:** #754 (posture floor; 13 gaps, unchanged) and #490 (Renovate dashboard).
- **Opened:** none.

## What went wrong, or nearly did

- **A nightly went silent, and no alarm fired.**
  - The conductor (#1259) dispatches drift with `github.token`, and GitHub does not start a `workflow_run` from an event that token caused [I, GitHub docs]. So the pull-sync stopped on the first conducted night.
  - Every check stayed green, because a run that never starts cannot fail.
  - No sync was missed in practice: drift is clean on all 15 sites.
  - P1-38's row had asked exactly this question, "whether `fleet-prismic-sync` follows a conducted drift run", and the answer was readable on 10-09. Nobody read it until today.
- **The backlog was four days behind Discord on D7.** Tim had given the operator the GoDaddy delegation on 10-05, while three reports still listed D7 as open.
- **The Prismic publication log is not a complete record.** caltex-landing's `list_document_publications` shows nothing after 10-05 23:16Z, yet the live page carries release `asUDwhIAAMIrgcs0`'s text [M, curl]. Item 90 is closed on the live page, not on the log.
- **The open-asks control first gave a wrong date for item 13, from this pass's own error.** The pass's first query searched for the number "13", but at the backlog's creation the item was numbered 11, so the query returned 09-29 17:35Z. The form `pm-pass.md` gives (`^ ?[0-9]+\. \*\*<prefix>`) returns 06:53:39Z, and the control passes.
- **Two items carry the number 99.** "#1259, P1-38 nightly conductor" sits after "Active projects", outside "Operator decisions", while "#1264, P1-37 spam pass" sits inside it. Both are answered. A later docs PR should renumber or move one.

## Live worker sessions (reported, not touched)

`EVENING_BRANCHES_SUMMARY main_decision_lines=124 asks=0 decision_lines=1 stale=1 stale_fresh=0 scanned=1 older_skipped=37` [M, 13:55Z]. The one branch with commits in the last 7 days and no PR is `claude/jolly-keller-9h8tzh` (156 h, known residue). No ask sits only on a branch. No `claude/*` or `fix/*` branch has a commit in the last 24 h.

## Next for agents

**Ready today:** P1-42 (Williamson cutover checklist and verifier), P1-40 (Hedloc 4th slot), P1-41 (Roalson pre-launch list, without the homepage map) and P1-39 (prismic-sync under the conductor). P1-31 and #1148 are unchanged. **P1-33 stays parked until Mon 10-12**, when its (e) falls due.

**Not ready:** item 87 (dead letters; your pick).

### Briefs

```markdown
## Worker brief — P1-42: OD7-P4, the Williamson cutover checklist and verifier (before Wed 10-14)

**Item.** P1-42 · open "OD7-P4 cutover" (the OD7 issue is #1029) · 🟢 GREEN for the worker; every DNS and Netlify-domain step is 🔴 and belongs to the operator · effort S
Cutover of www.williamson-construction.com and www.williamson-homes.com from
Webflow to Netlify is planned for Wed 10-14, with Webflow serving until 10-19
as the rollback (`docs/webflow-conversions-2026-10.md` §4). The plan's own
brief is §7 "Worker brief — OD7-P4"; follow it. Its _Verify first_ holds: Tim
wrote "both are good to move over" (Discord #williamson, 10-05 16:50Z), and
D7 is settled (the operator has the GoDaddy delegation, 10-05 23:06Z) [M].
Domaru is out of scope: it lapses on 10-19 (item 7, answered 09-30).

**Verify first.** `for h in www.williamson-construction.com www.williamson-homes.com williamson-construction-co.netlify.app williamson-homes.netlify.app; do echo "$h $(curl -sSL https://$h/ | grep -c data-wf-site)"; done`
Expect: 1, 1, 0, 0 [M, 2026-10-11 14:05Z]. Then `dig +short` the apex A,
`www` CNAME, MX and TXT of both domains, and compare them with the plan's §2.1
and §2.2 records. If they differ, the checklist follows the live records and
the plan is corrected in the same PR.

**Start here.**

- `docs/webflow-conversions-2026-10.md` §2.1, §2.2 (measured records), §4 (schedule), §7 OD7-P4
- `scripts/` — the verifier goes here as a small `.mjs` with a test under `tests/`
- `reddoor-maint launch <site>` — what it does at launch; do not run it before the operator's go

**Done when.** (1) A per-domain checklist for the operator, in the plan or a
runbook, that changes only the apex `A` and the `www` `CNAME`. MX, SPF, `MS=`
and the verification TXT are listed as DO NOT TOUCH, with their current
values. It also lists the 10-13 Netlify custom-domain and TTL steps. (2) A
verifier that, for each domain, checks every §2 path on apex and `www` for 200
and `server: Netlify`, a valid certificate, no `data-wf-site`, and MX identical
to §2. It is red on today's Webflow hosts and green on both `*.netlify.app`
previews, and both runs are pasted in the PR.

**Mutations I will run** (each must turn a test red):

1. A page that still carries `data-wf-site` passes.
2. Changed MX answers pass.
3. A 301 loop on the apex passes.
4. A path missing from the new host (404) passes.

**Stop conditions** (beyond AUTONOMY.md's six):

- Never log in to Webflow, GoDaddy or Netlify's domain settings, and never edit DNS.
- If the live records differ from §2 in MX or TXT, stop and ask: the cutover plan assumed them.
- A roster status flip to `maintained` is the operator's.
- Two dirty review rounds → "Operator decisions", not a third round; your pick
  there follows `CLAUDE.md`'s two-rounds rule.
- At any stop condition: ask as `CLAUDE.md` → "Worker sessions ask a blocking
  question once, with all its context" says, in its order.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` → "Concurrent sessions"); if one under a day old touches these files, stop.
2. Claim on the issue. Worktree from `origin/main`. Red test first.
3. `pnpm lint`, `pnpm typecheck`, the changed tests, the mutations table in the PR body.
4. Move P1-42 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry as a new file in `docs/journal/`, landed before the session ends.
7. Stopped instead of landing? Follow `CLAUDE.md`'s asking rule, in its order.
```

```markdown
## Worker brief — P1-40: Hedloc, a 4th Executive Team slot for Shankar Annamalai

**Item.** P1-40 · open an issue in reddoorla/hedloc · 🟡 YELLOW (layout change on a client site) · effort S
Erik asked in #hedloc-web (10-09 15:34Z and 20:44Z): "sometime during the week
of 12-16 Oct" build a 4th slot into the Executive Team line-up, "slide these
three to the left, and have 4-wide". Shankar is 4th. His bio (.docx) and
headshot are linked from Dropbox in the 20:44Z message. Erik asked to be told
once they are added [M, Discord].

**Verify first.** `curl -sSL https://hedloc.netlify.app/executive-team | grep -o '<h4[^>]*>[^<]*</h4>' | sort -u`
Expect: Ben Friedman, Dan Hord, Jack Harper [M, 2026-10-11 14:05Z].

**Start here.**

- `src/routes/[[preview=preview]]/executive-team/+page.svelte:33-87` — the row:
  an empty `lg:w-1/4` `#team-top` column (it shows the selected member), then
  one `lg:w-1/4` button per `content.team_member`. Four members need that
  spacer column gone or moved, and the selected-member view (`:89-120`, the
  `lg:w-2/3` panel) reworked to match.
- `customtypes/about/index.json` — `team_member` is a repeatable group
  (headshot, name, title, body) on the `about` singleton; no model change is needed.
- Discord #hedloc-web, Erik's 10-09 20:44Z message (GET only, `DISCORD_BOT_KEY`):
  the Dropbox links for the bio and headshot. Read them with the Dropbox connector.

**Done when.** At `lg` the four members sit in one row, left-aligned, and
clicking any of them shows that member's bio, as clicking one of three does
today. Phone and tablet keep stacking. Shankar's entry (headshot, name, title,
bio from the .docx) is staged in a Prismic release for the operator to
publish. Screenshots at 1440, 1024 and 390 are in the PR. A one-line reply
for Erik is drafted in the PR body. The operator posts it; never post to
Discord.

**Mutations I will run** (each must turn a test red):

1. Render only the first three `team_member` items.
2. Keep the spacer column, so the 4th member wraps to a second row at `lg`.
3. Clicking the 4th member opens the 1st member's bio.

**Stop conditions** (beyond AUTONOMY.md's six):

- The Prismic connector answers "Prismic MCP is not activated for repository
  hedloc" [M, 10-11]. If it still does, land the layout with a fixture member,
  leave the content to the operator, and say so. Do not look for another way
  to write to Prismic.
- The .docx has no title for Shankar: ask, do not invent one.
- Two dirty review rounds → "Operator decisions", not a third round.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** In reddoorla/hedloc (attach it with `add_repo`, push). Check its
fresh branches first. Worktree, red test, its own lint, check and test
scripts, a 3-lens review, then merge under its ruleset. Then a journal entry
here, as a new file in `docs/journal/`, with P1-40 moved to Done, via
`node scripts/land-prs.mjs`.
```

```markdown
## Worker brief — P1-41: Roalson, Erik's pre-launch notes (without the homepage map)

**Item.** P1-41 · open an issue in reddoorla/roalson-interests · 🟡 YELLOW · effort M
Erik posted "final website notes before launch" in #roalson-interests at
10-09 21:46Z, about 11 changes [M, Discord]. Read the message whole
(GET only, `DISCORD_BOT_KEY`, channel #roalson-interests). Nicole objected to
one of them at 21:58Z, and it is held.

**Verify first.** `git -C <roalson clone> log -1 --format='%h %cI'` and
`grep -n 'Go Back' src/lib/components/PersonProfile.svelte`.
Expect: `href="/"` at `:41` [M, `7508601`, 2026-10-11]. List the repo's
`claude/*` branches by date; the listing-package generator sits on
`claude/nifty-dirac-2zmegy` and `claude/listing-packages-spencer-ranch`. Leave
those alone.

**Start here.**

- Home: the hero subhead (HomeHero slice content); "Our Legacy" → "About Us"
  (`src/lib/slices/Partners`, the eyebrow; its band needs an anchor id); "Go
  Back" → that anchor (`src/lib/components/PersonProfile.svelte:41`); "FEATURED
  PROPERTIES" more prominent within the existing type styles
  (`src/lib/slices/FeaturedProperties/index.svelte:218`).
- Properties: an "ALL" filter selected by default, with every listing on the
  map, replacing the land/featured split; keep the list view
  (`src/lib/components/PropertyListing.svelte`). Pins: the selected one at 120%
  with a small "Ri" logo in its head, the others at 90% and lower opacity
  (`src/lib/components/PropertyMap.svelte`). "Past Projects" at the bottom: a
  checkbox on `customtypes/property` like "featured", with admin-editable
  bullets, laid out from Nicole's 3-column mockup.
- Listing: "View on Google Maps" → "Aerial Map"
  (`src/lib/components/PropertyDetail.svelte:119`); fold Details (`:130`)
  into the bulleted list.

**Done when.** Each group lands as its own PR (home, properties and pins,
past projects, listing). Each is live on roalson-interests.netlify.app with
screenshots at 1440, 834 and 390. Content edits sit in one Prismic release for
the operator to publish. A model change rides its PR and the site's model
workflow. A reply for Erik is drafted in the last PR body. The operator posts
it.

**Mutations I will run** (each must turn a test red):

1. The Properties page lands with "Land" selected instead of "ALL".
2. "ALL" shows only featured listings on the map.
3. A property without the past-project box appears under Past Projects.
4. "Go Back" returns to `/` without the anchor.

**Stop conditions** (beyond AUTONOMY.md's six):

- **Do not remove the homepage map.** Nicole objected, and Erik has not answered.
- If Nicole's Past Projects mockup is not in Discord or Dropbox, build the
  other groups and ask for it once.
- If "more prominent within existing type styles" admits more than one
  reading, show two options in the PR rather than asking.
- One agent session per site repo: if another session holds a fresh branch
  touching these files, stop.
- Two dirty review rounds → "Operator decisions", not a third round.
- At any stop condition: ask as `CLAUDE.md`'s asking rule says, in its order.

**Landing.** In reddoorla/roalson-interests (attach with `add_repo`, push),
under its ruleset, each PR CI-green and reviewed. Then a journal entry here,
as a new file in `docs/journal/`, with P1-41 moved to Done, via
`node scripts/land-prs.mjs`.
```
