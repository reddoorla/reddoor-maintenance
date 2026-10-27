# Morning brief — 2026-10-06 (scheduled PM pass, Tuesday, 11:51Z)

## One-line verdict

**The five October Maintenance reports are a day past due and held on you: answer item 88 (roll out the two cookie fixes) and say how to re-draft the stored 78s; LAHI stores 100 and can go today. Overnight was quiet: every scheduled run green, no branch-only asks, nothing on Discord.**

This pass started at **11:51Z (04:51 PDT)** [M, `date -u`]. It covers the 10-05 evening pass (00:50Z) → 10-06 12:00Z.

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28). Five `awaiting` rows from 10-05 22:47Z stop the count (ask 2).

## Top of stack (yours; ordered by date)

1. **Due 10-05, held by you: five Maintenance drafts (P0-4, items 88 and 89).** All five are still pending approval [M, 11:55Z, SELECT-only client that refused an `UPDATE` first]. The hold was for the Best Practices 78, and it is real: two third-party cookies, not the instrument (item 88).
   - **LAHI stores 100.** If you lift its hold: approve on `/s/la-homelessness-initiative`, and it sends with the next `daily-reports` run.
   - **Data Dynamiq** reads 100 live (`site_health.bp_score`, stamped 00:41Z by the bp-78 branch's dispatch) but its draft stores 78, and "refresh preview" does not re-read Lighthouse (`render-from-row.ts:67`). _Ask:_ how to re-draft a held row (item 88's last bullet).
   - **Espada, Revogen, Vineyard** store 78 and read 78 live, with `lighthouse_failing_audits` = `third-party-cookies`, `inspector-issues` [M, Turso]. ERP and MSOT read the same and have no report due. _Ask (item 88):_ (a) a worker opens five per-repo PRs (Espada, MSOT, Revogen: lazy Vimeo; Vineyard: Vimeo and the `app.html` toolbar tag; ERP: the tag), each checked by a deploy-preview Lighthouse run; or (b) accept the 78s. _Worker's pick:_ (a). A brief is ready below for when you say (a).
   - `preflightSite` returns nothing for any of the five (control: Espada with recipients and contact blanked → `recipients-missing`) [M]. Nothing else is due before 10-20 [M, `nextDueDate` over all 47 rows].
2. **Verdict on the five [TEST] sends of 10-05 22:47Z** (Data Dynamiq, Espada, LAHI, Revogen, Vineyard): `clean`, or what was wrong. Only you saw the emails.
3. **Item 89: #1205** (the nightly names the audits behind a failed category; it is the evidence behind item 88). CI `build` green on `49cc0133` [M], branch behind `main`. _Ask:_ (a) land as is and fix the "pass with no assertions read" status in a follow-up; or (b) fix it in #1205 and run a third round. _Worker's pick:_ (a).
4. **Before cutover Wed 10-14: Williamson Construction (P0-5).** Tim's three facts are still open on `main`: **D0** (Webflow billing on 10-19), **D6** (who receives `/join-the-team`), **D7** (who holds GoDaddy). Nothing records whether yesterday's walkthrough happened [I]. Say so if it did.
5. **Release PR #1183, `0.105.0`:** `build` green, clean [M]. It carries the Prismic toolbar CSP (#1157), `prismic-sync` (#1143), the cockpit's "just wait" (#1199), the `verify-dump` content hashes (#1195), the `data-hydrated` smoke marker (#1194) and the `analytics-tag` test-file fix. Yours to merge, as always.
6. **Asked 10-05, still open [M where noted]:**
   - **Item 87:** dead letters wait two replay cycles (12 h) before they alarm, (a), or alarm from the first row, (b). Pick: (a). #1199 landed without it.
   - **Item 85:** merge caltex-landing `staging` into `main` (the production deploy, editors move to slices). Still unmerged [M, `staging` `23763ef` not in `main` `f4d5291`]. Pick: merge as is.
   - **Item 81:** upload the two Hwy 46 files to the Roalson media library (or say where they are), then publish release `asP91BIAAH8K23X-`. Still unpublished [M, `list_releases`].
   - **Item 82:** two Roalson aerials: (a) ask Matt for landscape aerials, (b) letterbox, (c) trim. Pick: (a).
   - **Item 72 follow-up, 🔴:** rotate the-pointe-burbank's `PRISMIC_WRITE_TOKEN`, which round 3's demo printed into a session transcript, or say it can stay.
   - **Item 79 leftovers:** tell Erik Our Story and AED Programs are live; delete the stray asset `_t3eeXeDKfYMiE5v` in caltex-landing's media library [I: not re-read].
   - **`claude/jolly-keller-9h8tzh`:** 3 docs commits, no PR, last commit 34 h old [M]. Open a PR from it, or say it can go. Asked once last evening; not asked again after today.
7. **Undated, unchanged:** Mantis, Williamson Homes and Williamson Construction below the posture floor (🔴, #754, item 33 (d)); Mantis P4a real submit from a browser (item 71); #1090 phase 5, the Type Builder switch and simulator URL per repo (item 57); 57 (a) Vida's `PRISMIC_WRITE_TOKEN` (🔴); Roalson 55 (ii); privacy 45 and 46 parked; item 74 (Williamson poster frames) and item 78 (Mantis matching gate, laptop) are already yours by your answers.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None. [M, ~11:54Z: 10 channels active in 14 days, 71 candidate mentions, 0 neither replied to nor reacted to by you. Positive control: a 21-day window finds 19 channels, 120 candidates and 3 open, among them Erik's 09-17 lines in #full-financial and #acacia-landscaping, so the scan does see an unanswered mention. Each channel reads at most 100 messages.]

## What landed since the 10-05 evening pass (merged on `main`, after 00:50Z) [M, pulls API]

| PR | What |
| --- | --- |
| #1143 | D1 nightly Prismic pull-sync (item 72 closed) |
| #1193 | the time-travel shim fakes Date only; closed #1171 |
| #1199 | "just wait" items leave Watch and the digest; closed #1190 |
| #1187 | post-kit proposal |
| #1201, #1202, #1203, #1204, #1206 | the evening pass, item 72's close, two journals, Operator decisions 88–89 |

Elsewhere [M, each repo's `main`]: mantis-landscaping #29 (`fa96aa7`, 23:37Z) and #30 (`1150d1a`), so **item 80 is closed**; roalson-interests #263 (`1595756`, 23:26Z), so item 84 is done.

**Open PRs** [M, ~11:57Z]: #1183 (release, green, clean) and #1205 (held, item 89; green, behind). None red, none draft.

## Nightlies (scheduled, 10-06 00:50Z → 11:57Z) [M, Actions API and job logs]

| Run | When | Result |
| --- | --- | --- |
| forms-deadletter-replay | 00:22Z, 06:53Z | green |
| renovate | 03:26Z | green |
| fleet-db-backup | 11:26Z | `DUMP_VERIFY loaded=true tables=11 rows=1118 blob_bytes=11433275 hashed=11 mismatches=0`, on the dump and on the `.gpg` |
| fleet-prismic-drift | 11:41Z | `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15`, no warning lines |

The backup is the first scheduled one with #1195's content hashes (`hashed=11`), and `blob_bytes` moved (11437644 → 11433275) for the first time since 10-01, as the five new header images predicted. Rows 1101 → 1118.

No "Nightly … failing" issue opened. #1171 (time-travel) closed at 01:19Z with #1193; its next scheduled run is the proof.

**Pending at 12:00Z (not yet started):** fleet-security, fleet-lighthouse (its first scheduled run with #1205's audit names is not possible until #1205 lands), daily-reports, fleet-smoke, fleet-form-e2e, time-travel, release-health, the first scheduled `fleet-prismic-sync`, and the later renovate and forms-deadletter-replay slots.

## Issues since the last report [M]

Closed: #1171, #1190. Commented: #1148 (form-e2e's own injection; the `data-hydrated` marker it can wait on now exists), #947. Open bot issues: #754, #490 (Renovate dashboard).

## What went wrong, or nearly did

- Nothing new overnight. The branch check found no ask only on a branch (`EVENING_BRANCHES_SUMMARY … asks=0 … scanned=9`) [M].
- **`time-travel` is the instrument to watch today:** #1193 has not yet passed a scheduled run.

## Live worker sessions (reported, not touched)

- **bp-78** (`claude/trusting-brahmagupta-413csl`, last commit 01:36Z): ended at items 88 and 89.
- **GOLA** (`claude/practical-ride-kbipzv`): unchanged since 10-01 02:25:59Z, no PR [M].
- No `claude/*` branch other than these pushed in the last 24 h [M, `for-each-ref`].

## Next for agents

P1 holds one ready item, P1-31. #1148 is ready too: the marker it waits on landed (reddoor-starter#184). Item 88's rollout is ready the moment you answer (a); its brief is below, marked as waiting.

**Not ready:** #1205's follow-up (item 89), dead letters (item 87), CalTex (item 85), the a11y spec's wait on `html[data-hydrated]` (Watching, unranked).

### Briefs

```markdown
## Worker brief — P1-31: `contrast-unmeasured`'s remedy for Tailwind `black/<alpha>`

**Item.** P1-31 · no issue yet (open one) · 🟢 GREEN · effort S
Tailwind v4's `black/<n>` compiles to `color-mix(in oklab, #000 N%, transparent)`,
which lightningcss 1.33 folds to `oklab(0% none none/.N)`. The gate's remedy
says "write 0 for none in the oklab() token", but no such token exists in the
site's source. The real fix is defining black as `oklab(0 0 0)`
(reddoor-website#260, byte-identical render).

**Verify first.** `sed -n 86,93p src/audits/util/contrast-unmeasured.ts`
Expect: `unparseableColourRemedy` at line 86, and the `none` branch at 89–90
returning `write 0 for "none" in the ${token}` [M, 2026-10-06 11:57Z].

**Start here.**

- `src/audits/util/contrast-unmeasured.ts:86` — `unparseableColourRemedy`
- `tests/audits/a11y.test.ts:32`, `:1938`, `:1963` — where it is imported and pinned
- reddoor-website#260 — the per-site fix to name in the remedy

**Done when.** A colour of the shape `oklab(0% none none / α)` gets a remedy
naming Tailwind's `black/<n>` and the `oklab(0 0 0)` definition; every other
`none` colour keeps today's remedy; both are pinned by tests. The fleet list
of sites using `black/<n>` with sRGB black (starter and starter-blux first)
is written into the issue. Per-repo fixes are separate PRs, not this one.

**Mutations I will run** (each must turn a test red):

1. Drop the new branch (today's behaviour).
2. Match any `oklab(... none ...)`, not only lightness 0 with two `none`s.
3. Match `oklch(0% none none)` as well.
4. Lose the alpha (match only the opaque form).

**Stop conditions** (beyond AUTONOMY.md's six):

- No fleet sweep. Listing the sites is reading; fixing them is per-repo PRs.
- Two dirty review rounds → "Operator decisions", landed on `main` as a
  docs-only PR, not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim the issue. Worktree from `origin/main`. Red test first.
3. `pnpm lint`, `pnpm typecheck`, the changed tests, a changeset, a review,
   the mutations table in the PR body.
4. Move P1-31 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```

```markdown
## Worker brief — #1148: form-e2e waits for hydration before it injects

**Item.** #1148 · 🟢 GREEN · effort S
`fillAll` runs `injectExpr` (and `SYNTHESIZE_REQUIRED_EXPR`) straight after
`goto(…, { waitUntil: "domcontentloaded" })`, before Svelte hydrates. Svelte 5
treats the injected `<input name="testMode">` as a hydration mismatch and
re-mounts the form, 5 of 5 times on Mantis; without the injection, 0 of 19.
So a `refilled` pass cannot tell a site defect from the probe's own.

**Verify first.** `grep -n 'domcontentloaded\|const fillAll\|page.evaluate(injectExpr)\|const refilled' src/audits/form-e2e.ts`
Expect: `goto` with `domcontentloaded` at 643, `fillAll` at 928, the inject at
938, `refilled` at 981, and no `data-hydrated` anywhere in the file [M, 2026-10-06 11:57Z].

**Start here.**

- `src/audits/form-e2e.ts:643` (goto), `:880` (`injectExpr`), `:928-940` (`fillAll`), `:981-983` (the refill)
- `tests/audits/form-e2e.test.ts`, `tests/audits/form-e2e-live-runner.test.ts`
- #1148's comment of 10-05 23:38Z: what `html[data-hydrated]` guarantees (reddoor-starter#184)

**Done when.** Before `fillAll`, the probe waits for `html[data-hydrated]`
where the page will write it, else a bounded settle after `load`. A fixture
that injects before hydration reports `refilled`, and the fixed probe on the
same fixture does not. A site with no marker still passes, with a note that
hydration was not proven.

**Mutations I will run** (each must turn a test red):

1. Remove the wait (today's behaviour).
2. Wait for `footer` instead of `html[data-hydrated]`.
3. Wait with no upper bound on a page that never writes the marker.
4. Drop the "hydration not proven" note.

**Stop conditions** (beyond AUTONOMY.md's six):

- If waiting for the marker changes a live verdict on any site in the
  nightly, stop and list the sites under Operator decisions.
- Two dirty review rounds → "Operator decisions", landed on `main`, not a third round.

**Landing.** As in the P1-31 brief, steps 1–6; close #1148 and move its
Watching bullet (4) to Done.
```

```markdown
## Worker brief — item 88: the two cookie fixes, five per-repo PRs (WAITING on your (a))

**Item.** Operator decisions 88 · 🟡 YELLOW per repo (each PR is reviewed; no mass push) · effort M
Espada, MSOT, Revogen and Vineyard render the `player.vimeo.com` iframe on
load (Cloudflare `__cf_bm`); ERP and Vineyard hard-code
`static.cdn.prismic.io/prismic.js` in `src/app.html` outside the preview gate.
Each costs `third-party-cookies` (w5) and `inspector-issues` (w1): BP 78.

**Verify first.** SELECT `bp_score, lighthouse_failing_audits` from
`site_health` for the five. Expect 78 and both audits on each [M, 2026-10-06 11:55Z].

**Start here.** The starter's `VimeoBanner.svelte` and Vida's
`VimeoBackground.svelte` (iframe after a real pointer, wheel, key or touch);
each site's `ScreenWidthImage`/`ScreenWidthMedia`/`TwoCol`/`ContentWidthMedia`;
ERP's and Vineyard's `src/app.html` and the `isPreviewSession` gate in their
layouts; data-dynamiq#59, the fix already proven.

**Done when.** Five PRs, one per repo, each with a deploy-preview Lighthouse
run reading BP 100 (3 runs) and the Vimeo hero still playing after a real
interaction; real Prismic previews still show the toolbar.

**Stop conditions.** A site whose Vimeo must autoplay before any interaction
(a design call) → Operator decisions. Production merges follow your usual
rule for client repos. Two dirty review rounds → Operator decisions.

**Landing.** Per repo, `node scripts/land-prs.mjs <pr> --repo reddoorla/<site>`;
then re-drafting the held October rows is yours (item 88's last bullet).
```

## Evening

**Headline: the five October Maintenance reports are a day past due and still pending approval. Item 88's fix is live, but four of the drafts still store 78, so the ask now is how to re-draft them. LAHI stores 100 and can go. A green Renovate security PR (#1222, sharp/librsvg) and release PR #1214 wait on you. Every scheduled run was green, and no ask sits only on a branch.**

Evening pass, 2026-10-06 17:49 PDT (00:49Z 10-07) [M, `date -u`]. `<since>` = #1207 merged_at, 2026-10-06T12:05:43Z.

### Asks (ordered by date)

1. **Due 10-05: the five October Maintenance drafts, all still pending approval** [M, Turso SELECT at ~00:55Z: `draft_ready=1`, not approved, not sent, not withdrawn; control: 27 rows in `reports`; nothing sent since 10-06]. `daily-reports` 16:02Z skipped all five as "already drafted 2026-10" and sent nothing.
   - **LA Homelessness Initiative** stores best practices 100. Approve it on `/s/la-homelessness-initiative` and it sends with tomorrow's run.
   - **Data Dynamiq, Espada, Revogen, Vineyard Custom Homes** store 78, but live reads 100 after item 88's fixes (fleet-lighthouse 14:51Z wrote `bp_score` 100 for all four [M, BACKLOG item 88]). _Ask (item 88's last bullet):_ how should a held row be re-drafted? "Refresh preview" does not re-read Lighthouse (morning report, ask 1). Approve each one on `/s/<slug>` only after its re-draft shows 100, or approve now with 78 if you accept that.
2. **#1222: `sharp` 0.35.4 → 0.35.5 [security]** (GHSA-wq5f-xc86-pv6w, an RCE in the bundled librsvg on glibc Linux). Renovate opened it at 17:28Z. `build` is green on `82c185f9` [M]. Renovate says "Automerge: Disabled by config", so the fleet preset holds this PR for a human. I did not read the preset itself tonight [I]. _Ask:_ merge it.
3. **Release PR #1214** (`chore(release): version packages`, opened 14:35Z): `build` green on `55aac492` [M]. It is yours to merge, as always. Since #1183, it carries #1205 and #1213 (the nightly names the audits behind a failed category, and reports "warn" instead of "pass" when lhci exits non-zero without assertion results) [I, from merged titles].

Still open from this morning and not asked again tonight: the verdict on the 10-05 [TEST] sends, Williamson Construction D0/D6/D7 before the 10-14 cutover, and items 87, 81, 82, 72's token, 79's leftovers and 57. Tomorrow's morning pass re-checks them. Settled today: 85 (CalTex `staging` is live), 89 (#1205 landed), 90 (the CalTex release was published and checked live at 19:50Z, journal #1223), and 88's rollout (all five sites read 100).

### Evidence

`EVENING_BRANCHES_SUMMARY main_decision_lines=115 asks=0 decision_lines=2 stale=5 stale_fresh=0 scanned=6 older_skipped=33 now=2026-10-07T00:49:47.872Z` [M]. Six branches were scanned, so the check ran. The 115 decision lines added on `main` are today's worker notes on items 49, 83, 85, 88, 89 and 90. The only `_Ask:_` among them, item 90's CalTex release, was published and verified (#1223). No `NEW` unprotected branch. The five `older` ones are known residue: `a11y-blend-mode-unmeasured`, `a11y-browser-missing-csp-r3`, `jolly-keller-9h8tzh`, `pm-0930-answers` and `practical-ride-kbipzv`. `jolly-keller` was asked twice and is not asked again.

The Mantis home release `asQ6NhIAAIoP2_HX` (journal, Mantis P5) no longer appears in `list_releases` for `mantis-landscaping`, so it was published or deleted [M]. The control is Roalson: the same call lists `asP91BIAAH8K23X-` (item 81), which is still unpublished.

**Nightlies: scheduled runs created ≥ 10-06 00:49Z, 13 runs** [M, Actions API and job logs]:

| Run | Result | FLEET_WRITE_SUMMARY |
| --- | --- | --- |
| fleet-db-backup | success | (no line; not a fleet write) |
| fleet-prismic-drift | success | wrote=15 failed=0 total=15 |
| fleet-security | success | wrote=15 failed=0 total=15 |
| fleet-lighthouse | success | wrote=15 failed=0 total=15; wrote=23 failed=0 total=23 |
| daily-reports | success | 0 drafted (5 already drafted for 2026-10); "No reports ready to send." |
| fleet-smoke | success | wrote=15 failed=0 total=15 |
| fleet-form-e2e | success | wrote=15 failed=0 total=15 |
| release-health | success | — |
| renovate ×2, forms-deadletter-replay ×3 | success | — |

No nightly is pending. No tracking issue was opened or closed since `<since>`. Only #754 and #490 (the Dependency Dashboard) were updated.

**Merged since 12:05Z: 18 PRs**, all by the operator account's sessions except #1183 (the release, `0.105.0`). Code: #1205 (lighthouse names the failing audits) and #1213 (lhci "warn" instead of "pass"). Docs: #1208–#1212, #1215–#1221, #1223, #1224 and #1226.

**Open PRs:** #1214 (release, green), #1222 (Renovate security, green, held by config) and #1225 (operator-session docs, green, not held).
