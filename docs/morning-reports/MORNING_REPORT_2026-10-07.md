# Morning brief — 2026-10-07 (scheduled PM pass, Wednesday, 11:51Z)

## One-line verdict

**The five October Maintenance reports are two days past due. Every site now reads best practices 100 live, but four drafts still store 78, and nothing on `main` can re-read a held draft's scores. Answer item 91 (how to re-draft them), and approve LAHI today. Overnight was quiet: every scheduled run green, no branch-only asks, nothing old on Discord.**

This pass started at **11:51Z (04:51 PDT)** [M, `date -u`]. It covers the 10-06 evening pass (00:49Z) → 10-07 11:58Z.

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28). The five `awaiting` rows from 10-05 22:47Z stop the count (ask 2).

## Top of stack (yours; ordered by date)

1. **Due 10-05, two days late: five Maintenance drafts (P0-4, new item 91).** All five are still pending approval, and nothing was sent after 10-05 [M, 11:52Z, a SELECT-only client that refused an `UPDATE` first; 47 sites, 27 reports].
   - **LA Homelessness Initiative** stores best practices 100. Approve on `/s/la-homelessness-initiative`; it sends with the next `daily-reports` run.
   - **Data Dynamiq, Espada, Revogen, Vineyard Custom Homes** store `bestPractices` 78. Live `site_health.bp_score` reads 100 for all of them, and for ERP and MSOT, stamped 10-06 16:19Z by fleet-lighthouse [M]. "Refresh preview" re-renders from the stored scores (`render-from-row.ts:67`), and withdrawing is not a re-draft: a withdrawn draft becomes the base of `nextDueDate` (`src/reports/due.ts:114-126`), which moves the next Maintenance report a cycle later [M, code read].
   - _Ask (item 91):_ (a) a worker adds a path that re-reads `site_health` into an unsent row's stored Lighthouse scores (a `report-rerender` input or a CLI flag), then you refresh and approve; (b) approve the four now with 78; or (c) withdraw them and skip October. _Pick:_ (a). It is small, and a stored 78 sent to a client after the fix shipped misreports the site.
   - `preflightSite` finds nothing for any of the five (control: Espada with recipients and contact blanked → `recipients-missing`) [M]. Nothing else is due before 10-21: the next is ERP Maintenance on 10-25 [M, `nextDueDate` over all 47 rows].
2. **Verdict on the five [TEST] sends of 10-05 22:47Z** (Data Dynamiq, Espada, LAHI, Revogen, Vineyard): `clean`, or what was wrong. You said on 10-06 you were waiting for the best-practices fix; it is live on all five sites [M, `site_health`], so the ask is back.
3. **#1222, `sharp` 0.35.4 → 0.35.5 [security]** (GHSA-wq5f-xc86-pv6w, librsvg on glibc Linux). `build` green on the rebased head `90d26f07` (02:59Z), mergeable, clean [M]. Renovate says "Automerge: Disabled by config"; the rule lives in `reddoorla/.github`'s preset, not read this morning [I]. _Ask:_ merge it.
4. **Release PR #1214, `0.106.0`:** `build` green on `dd30a5e9`, clean [M]. It carries #1205 (`LIGHTHOUSE_FAILURES`) and #1213 (lhci "warn" with no assertions). Yours to merge, as always.
5. **Before cutover Wed 10-14: Williamson Construction (P0-5).** Tim's three facts are still open on `main`: **D0** (Webflow billing on 10-19), **D6** (who receives `/join-the-team`), **D7** (who holds GoDaddy).
6. **This Routine's own prompt.** The prompt this pass fired with still names "04:48 and 17:48", while `pm-pass.md` (#1225) gives the copy with no clock times and the cron `48 4,12 * * 1-4`. Whether the cron itself moved cannot be read from here [I]. _Ask:_ confirm the trigger is `48 4,12`, and paste the `pm-pass.md` prompt into it. Today's 12:48 PT fire is the proof.
7. **Asked earlier, still open [M where noted]:**
   - **Item 81:** Roalson release `asP91BIAAH8K23X-` ("map pin corrections") is still unpublished [M, `list_releases`]. Upload the two Hwy 46 files, then publish.
   - **Item 87:** dead letters alarm after two replay cycles (a), or from the first row (b). Pick: (a).
   - **Item 82:** Roalson aerials: (a) ask Matt for landscape aerials. Pick: (a).
   - **Item 72 follow-up, 🔴:** rotate the-pointe-burbank's `PRISMIC_WRITE_TOKEN`, or say it can stay.
   - **Item 79 leftovers:** tell Erik Our Story and AED Programs are live; delete asset `_t3eeXeDKfYMiE5v` in caltex-landing [I: not re-read].
8. **Undated, unchanged:** Mantis, Williamson Homes and Williamson Construction below the posture floor (🔴, #754, item 33 (d)); Mantis P4a real submit (71); #1090 phase 5 (57); 57 (a) Vida's token (🔴); Roalson 55 (ii); privacy 45 and 46 parked; 74 and 78 already yours.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None older than two days. [M, 11:54Z: 11 channels active in 14 days, 75 candidate mentions, 4 open, all from 10-06: Erik's "Option 1!" and "go ahead and ask Tucker to implement" in #roalson-interests (built as roalson-interests#270, item 83; its state was not read, the repo is not attached to this session), Erik's thanks in #caltex, and Tim in #rd-marketing. Positive control: a 21-day window finds 20 channels and 7 open, among them Erik's 09-17 line in #full-financial.]

## What landed since the 10-06 evening pass [M, pulls API]

| PR | What |
| --- | --- |
| #1225 | the operator's answers to the 10-06 review: journal as one file per entry, second PM fire at 12:48 PT, P1-33 queued |
| #1227 | the 10-06 evening pass |
| #1226 | Roalson map Option 1 is roalson-interests#270 (item 83) |

**Open PRs** [M, 11:53Z]: #1214 (release, green, clean) and #1222 (Renovate security, green, clean, held by config). None red, none draft.

## Nightlies (scheduled, 10-07 00:49Z → 11:58Z) [M, Actions API and job logs]

| Run | When | Result |
| --- | --- | --- |
| renovate | 02:50Z | green |
| forms-deadletter-replay | 06:33Z | green |
| fleet-db-backup | 11:15Z | `DUMP_VERIFY loaded=true tables=11 rows=1124 blob_bytes=11433275 hashed=11 mismatches=0`, on the dump and on the `.gpg` |
| fleet-prismic-drift | 11:28Z | `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15` |
| fleet-prismic-sync (`workflow_run` after drift) | 11:29Z | `PRISMIC_SYNC_SUMMARY sites=15 … in_sync=11 skipped=4 failed=0`; the four skipped have no Prismic repository |

Rows 1118 → 1124; `blob_bytes` unchanged. No "Nightly … failing" issue opened or closed. `time-travel` is Monday-only; its next scheduled run, 10-12, is the first proof of #1193.

**Pending at 11:58Z (not yet started):** fleet-security, fleet-lighthouse, daily-reports, fleet-smoke, fleet-form-e2e, release-health, and the later renovate and forms-deadletter-replay slots.

## Issues since the last report [M]

None opened or closed. Updated: #754 (posture floor), #490 (Renovate dashboard).

## What went wrong, or nearly did

- **The held drafts have no way forward on `main`.** Item 88's fix shipped and the live scores read 100, but no code path writes them into an unsent row (item 91). Every day without an answer adds a day to four late client reports.
- **The Routine's stored prompt drifted from its copy in `pm-pass.md`** (ask 6). Small, but it is the instrument that fires these passes.

## Live worker sessions (reported, not touched)

No `claude/*` or `fix/*` branch pushed in the last 24 h; the newest is `jolly-keller-9h8tzh` (10-05 01:32Z) [M, `for-each-ref`]. `EVENING_BRANCHES_SUMMARY asks=0 decision_lines=1 stale=3 stale_fresh=0 scanned=3` [M]: no ask only on a branch; the three `older` branches (jolly-keller, pm-0930-answers, practical-ride) are known residue, not asked again.

## Next for agents

P1 holds P1-31 and the new P1-33 (the 10-06 review, one worker per sub-item in order; (a) is next and needs `reddoorla/reddoor-workspace` attached to read its recommendations). #1148 is ready. Item 91 (a) is a brief the moment you pick it.

**Not ready:** item 91 (your pick), item 87 (dead letters).

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
returning `write 0 for "none" in the ${token}` [M, 2026-10-07 11:56Z].

**Start here.**

- `src/audits/util/contrast-unmeasured.ts:86` — `unparseableColourRemedy`
- `tests/audits/a11y.test.ts` — where it is imported and pinned
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
6. Journal entry as a new file in `docs/journal/`, landed before the session ends.
```

```markdown
## Worker brief — #1148: form-e2e waits for hydration before it injects

**Item.** #1148 · 🟢 GREEN · effort S
`fillAll` runs `injectExpr` (and `SYNTHESIZE_REQUIRED_EXPR`) straight after
`goto(…, { waitUntil: "domcontentloaded" })`, before Svelte hydrates. Svelte 5
treats the injected `<input name="testMode">` as a hydration mismatch and
re-mounts the form, 5 of 5 times on Mantis; without the injection, 0 of 19.
So a `refilled` pass cannot tell a site defect from the probe's own.

**Verify first.** `grep -n 'domcontentloaded\|const fillAll\|page.evaluate(injectExpr)\|const refilled\|data-hydrated' src/audits/form-e2e.ts`
Expect: `goto` with `domcontentloaded` at 643, `fillAll` at 928, the inject at
938, `refilled` at 981, and no `data-hydrated` anywhere in the file [M, 2026-10-07 11:56Z].

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

## Cockpit, after the pass

**~12:10Z, the operator answered two asks.**

- **Item 91: (a).** It is queued as P1-34, and the brief is below. The four 78 drafts stay held until a refresh stores their live scores. Each site row already reads 100 [M, 12:08Z, SELECT-only]: Data Dynamiq 100/98/100/100, Espada 100/100/100/100, Revogen 90/99/100/92, Vineyard 100/88/100/92 (performance, accessibility, best practices, SEO). LA Homelessness Initiative stores 100 and can be approved now.
- **The 10-05 [TEST] sends: "they looked good other than bp".** LA Homelessness Initiative is recorded as `clean`. The other four are recorded as "looked good other than the best-practices 78". The streak counts from the bottom row, Vineyard, so it reads **0**.

### Brief

```markdown
## Worker brief — P1-34: "refresh preview" re-reads live Lighthouse scores into an unsent report

**Item.** P1-34 · Operator decisions 91, answered (a) · 🟡 YELLOW (behaviour change → 3-lens review) · effort S
Four October Maintenance drafts (Data Dynamiq, Espada, Revogen, Vineyard; due 10-05, held) store
`lighthouse.bestPractices` 78. Their site rows read 100 since fleet-lighthouse 10-06 16:19Z.
`rerenderReport` re-ticks the checklist evidence from the live site, but it renders the
row's stored `lighthouse` (`render-from-row.ts:67`, `requireLighthouse(report)`), so a refresh never fixes a score.

**Verify first.** `grep -n 'retickEvidence\|lighthouse\|bpScore' src/reports/send/rerender.ts`
Expect: `retickEvidence` at 4 and 98, and no `lighthouse` or `bpScore` [M, 2026-10-07 12:08Z].
Then, with a SELECT-only client: the four rows `report_01M46NNZ…`, `report_01M46NPA…`, `report_01M46NQ1…` and `report_01M46NQF…`
store `bestPractices` 78, `approvedToSend` false, `sentAt` null.

**Start here.**

- `src/reports/send/rerender.ts:72` — `rerenderReport`; the evidence re-tick at 98–118 is the pattern to follow
- `src/reports/draft.ts:161` — `scoresFromWebsite`, the draft's own read of the site row's four scores (export it, do not copy it)
- `src/reports/send/render-from-row.ts:67` — where the stored scores are rendered
- `tests/reports/send/rerender.test.ts`

**Done when.** A refresh of an unsent, unapproved report writes the site row's current four
scores to the report row and renders with them. The result names the change (for example `scores: 78→100 bp`).
An approved or sent report keeps its stored scores, and a site row with a null score leaves
the stored ones alone and says so. All three are pinned by tests. After landing (and the
release, if the dashboard's dispatch runs the published CLI; check which `report-rerender`
builds), the operator presses "refresh preview" on the four `/s/<slug>` pages and sees 100.

**Mutations I will run** (each must turn a test red):

1. Skip the score re-read (today's behaviour).
2. Re-read for an approved row too.
3. Overwrite with nulls when the site row has a missing score.
4. Re-read the scores but render the old ones (drop them from `current`).

**Stop conditions** (beyond AUTONOMY.md's six):

- If a refreshed report should not take today's scores for a reason in the code (for example, the period's scores are meant to be frozen at draft), stop and ask under Operator decisions.
- Do not write to the four live rows yourself; the operator refreshes them.
- Two dirty review rounds → "Operator decisions", landed on `main` as a docs-only PR, not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` → Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim an issue. Worktree from `origin/main`. Red test first.
3. `pnpm lint`, `pnpm typecheck`, the changed tests, a changeset, the 3-lens review, the mutations table in the PR body.
4. Move P1-34 to BACKLOG's Done section in the same PR, and say in item 91 what the operator presses next.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry as a new file in `docs/journal/`, landed before the session ends.
```

## Evening

**Headline: four October Maintenance drafts are still pending approval, two days past due, and three of them (Data Dynamiq, Espada, Revogen) still store best practices 78. P1-34 landed at 16:24Z, so press "refresh preview" on those three, check for 100, then approve all four. Vineyard sent at 78 in today's run, as you chose. #1244's CI build has been running for 1 h 30 min. Every scheduled run is green, and no ask sits only on a branch.**

Evening pass, 2026-10-07 12:49 PDT (19:49Z) [M, `date -u`]. `<since>` = #1228 merged_at, 2026-10-07T12:04:39Z. The Routine fired at 12:48 PT, so its trigger now runs `48 4,12`. That answers this morning's ask 6, except whether the prompt text was pasted too [I].

### Asks (ordered by date)

1. **Due 10-05: four Maintenance drafts pending approval** [M, Turso SELECT at ~19:52Z: `draft_ready=1`, not approved, not sent, not withdrawn]. `daily-reports` 16:41Z skipped all five as "already drafted 2026-10", sent Vineyard Custom Homes (approved 15:21Z, at 78, item 91) and skipped the digest ("unchanged since 2026-10-05").
   - **Data Dynamiq** (`report_01M46NNZ…`, bp 78), **Espada** (`report_01M46NPA…`, bp 78), **Revogen** (`report_01M46NQ1…`, bp 78): press "refresh preview" on `/s/data-dynamiq`, `/s/espada` and `/s/revogen`. After about two minutes, "draft preview ▸" should show best practices 100, and the report-rerender log names the change (`bp:78→100`). Then approve; each sends with tomorrow's 09:23Z run.
   - **LA Homelessness Initiative** (`report_01M46NPK…`, bp 100): approve on `/s/la-homelessness-initiative`; it sends with tomorrow's run.
   - The `reports` table has no preflight column, and this pass did not re-run `preflightSite`. This morning it found nothing for any of the five [M, morning report].
2. **#1244 (P1-35, `scripts/pm-cockpit.mts`), item 94 answered (a):** the head is `0d93f295`, a merge of `main` at 18:21Z. Its `build` and `ci` show `in_progress` from 18:21:41Z to 19:51Z [M, check-runs, clock 19:51:39Z]. That merge predates #1250 (19:33Z, which bounds the browser install and skips the stalling apt mirror). _Ask:_ if that worker session is still yours, have it merge `main` into #1244 and land it. If it has ended, say so, and tomorrow's morning pass queues the finish.
3. **#1222, `sharp` 0.35.4 → 0.35.5 [security]** (GHSA-wq5f-xc86-pv6w): `build` and `ci` are green on `721e5c57` (15:20Z) [M]. "Automerge: Disabled by config" (the fleet preset) [M, PR body]. _Ask (this morning's 3):_ merge it.
4. **Release PR #1214** (`chore(release): version packages`, open since 10-06 14:35Z): it was rebased at 19:49Z, and `build`/`ci` were in progress at 19:51Z [M]. It now also carries today's code: #1235, #1238 and #1243. Yours to merge once green.
5. **New on `main`, item 97 (#1249): eight operator-only chores**, from org secret scanning (97a) to the Rick Garcia thread (97h). Nothing tonight: the Mon 10-12 pass lists all eight under "Do, date or drop".

Still open from this morning and not asked again tonight: the verdict on the 10-05 [TEST] sends (ask 2), Williamson Construction D0/D6/D7 before the 10-14 cutover, and items 81, 87, 82, 72's token, 79's leftovers. Settled today: 91 (P1-34 landed, #1243), 92 (#1232 landed after round 6, answer (a)), 93 (Data Dynamiq Search Console verified, 19:08Z, #1252), 95 (#1235 landed) and 96 (#1238 landed).

### Evidence

`EVENING_BRANCHES_SUMMARY main_decision_lines=321 asks=0 decision_lines=2 stale=3 stale_fresh=0 scanned=4 older_skipped=35 now=2026-10-07T19:49:39.028Z` [M]. Four branches were scanned, so the check ran. The 321 decision lines added on `main` are items 91–97 and their answers. Every `_Ask:_` among them is answered or resolved, except 94's finish (ask 2) and 97's chores (ask 5). The two branch-only decision lines are on `claude/stoic-cerf-g7f0du`, which is #1244 (open), and `main` already names it as item 94. No `NEW` unprotected branch. Three `older` branches are known residue: `jolly-keller-9h8tzh`, `pm-0930-answers` and `practical-ride-kbipzv`.

**Nightlies: scheduled runs created ≥ 10-06 19:49Z, 12 runs** [M, Actions API and job logs]:

| Run | Result | FLEET_WRITE_SUMMARY |
| --- | --- | --- |
| fleet-db-backup | success | (no line; not a fleet write) |
| fleet-prismic-drift | success | wrote=15 failed=0 total=15 |
| fleet-security | success | wrote=15 failed=0 total=15 |
| fleet-lighthouse | success | wrote=15 failed=0 total=15 |
| daily-reports | success | 0 drafted (5 already drafted); sent Vineyard; digest skipped |
| fleet-smoke | success | wrote=15 failed=0 total=15 |
| fleet-form-e2e | success | wrote=15 failed=0 total=15 |
| renovate ×2, forms-deadletter-replay ×3 | success | — |

**Pending:** `release-health` (cron 14:30Z, with no run created yet at 19:50Z) and the 18:47Z `forms-deadletter-replay` slot (not yet created). `pm-pass-watch` landed at 16:40Z, and its first scheduled slot is 22:41Z. This PR has to reach `main` before that slot, or the slot reads this pass as missed. No tracking issue was opened since `<since>`. Work issues #1236 (P1-34) and #1246 (P1-33b) closed; #1241 (P1-35) opened and is still open.

**Merged since 12:04Z: 19 PRs**, all from the operator account's sessions. Code: #1243 (P1-34, refresh preview re-reads live scores), #1235 (pm-pass-watch), #1238 (digest subject), #1232 (directive-citation check) and #1250 (CI browser install bounded). Docs: #1228, #1229, #1233, #1234, #1237, #1239, #1240, #1242, #1245, #1247, #1248, #1249, #1251 and #1252.

**Open PRs:** #1244 (worker, build running 1 h 30 min), #1222 (Renovate security, green, held by the preset's automerge rule) and #1214 (release, CI running). None is a draft.
