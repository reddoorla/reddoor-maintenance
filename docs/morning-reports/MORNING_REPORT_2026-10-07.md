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
