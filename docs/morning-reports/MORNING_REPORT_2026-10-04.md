# Morning brief — 2026-10-04 (scheduled PM pass, Sunday, 15:59Z)

> Superseded in part by 2026-10-05 — Monday PM pass ("so all five now carry an analytics section": Data Dynamiq's GA4 tag is not installed yet, BACKLOG 49).

## One-line verdict

**A quiet weekend: every scheduled nightly from 10-01 to 10-04 is green with `failed=0`, nothing landed on `main` after 10-01 19:20Z, and tomorrow's five Maintenance drafts preflight clean. Your one new ask is Mantis P2a, decision 64, which landed on `main` during this pass (#1118).**

This pass started at **15:59Z (08:59 PDT, Sunday)** [M, `date -u`]. The Routine is meant to run Monday to Thursday at 04:48 PT, so this firing is off-schedule; whether it was a manual trigger was not read [I]. It covers 10-01 12:00Z → 10-04 16:05Z, the weekend included.

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28, clean). There is no `awaiting` row.

## Top of stack (yours; ordered by date)

1. **Mon 10-05, after ~15:00Z: approve five Maintenance drafts.** Data Dynamiq, Espada, LAHI, Revogen and Vineyard Custom Homes draft in Monday's `daily-reports` run. Approve each on its `/s/<slug>` page, and it sends with Tuesday's run.
   - All five read `nextDueDate` 2026-10-05, and `preflightSite` returns no finding for any of them [M, live Turso 16:03Z, SELECT-only client].
   - The gate was proven first: Espada with recipients and contact blanked returns `recipients-missing`.
   - Fleet-lighthouse re-stamped the evidence today at 13:48Z (`wrote=21 failed=0`) [M].
   - **Corrected:** Data Dynamiq now has a GA4 property (`556916505`) [M]. BACKLOG said it had none, so all five now carry an analytics section.
   - LAHI is the first send since #957: CMS Checked should read `n/a` and drop out of the email.
2. **Mon 10-05: Webflow, via Tim (hard date 10-19).** D0 (Webflow billing: what stops on 10-19), D6 (Construction's form recipient) and D7 (the GoDaddy holder) were due 10-05 and are still open. Cutover is planned for 10-14. Nothing about them has changed since 10-01 [M, BACKLOG item 7].
3. **New: Mantis P2a, decision 64.** mantis-landscaping#3 (model, seven slices, `/projects/[uid]`, 301s) is held after two dirty review rounds. Your options: (a) a third round limited to the round-2 list, then land; (b) take it over by hand; (c) re-scope, for example a static grid in place of the scrolling photo strip. _Worker's pick:_ (a). Every round-2 finding is local to one file, and nothing is pushed to Prismic yet.
   - The item is BACKLOG Operator decisions 64, landed in #1118 (`9664ef0a`, 16:17Z) [M].
   - P2b, P4 and P5 wait behind it.
4. **New, 🔴: secret scanning, push protection and a ruleset on `mantis-landscaping`.** The 10-04 protection sweep (#754) lists it with no ruleset and both scanning settings off [M]. Its first Netlify build already failed on a vendored Blux key (mantis-landscaping#2), which push protection would have stopped at the push. The two Williamson repos are still in the same state; that is the open half of BACKLOG 33 (d).
5. **Undated, still open:**
   - **Release PR #1100, `0.104.0`**, open since 10-01 and CI green. It carries #1099 (Testing pushes Maintenance), #1105 (`launch` audits the live url) and #1106 (`roster-urls` retry). The nightlies already run this code from `main`; only the fleet's npm consumers wait on it.
   - **#1090 phase 1:** mint and set `PRISMIC_WRITE_TOKEN` for the-tower-burbank and vida-legacy-foundation (item 57 (a)). Since #1117 landed (16:04Z), the `prismic-ci` run that follows can come from a cloud session.
   - **Roalson 55 (ii):** name the colour to bring back at 20%, and what it goes over.
   - **Privacy 45 and 46:** parked with P1-26.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None. **Closed since 10-01:** Tim's 09-17 #worthe-web-maintenance ask (a slow ease-in at the end of the homepage slideshow) now carries your 👍, and the reaction API lists `tucksravin` as the reactor [M]. By the 09-29 rule a reaction closes it.

[M, 16:03Z: 8 channels active in 14 days, 66 candidate mentions, 1 neither replied to, and that one carries your reaction. Positive control: a 20-day window finds the three 09-17 Erik lines the 10-01 pass listed as answers rather than asks, so the scan still sees unanswered mentions. Tim's ask did not appear even at 20 days, because of the reaction, which was confirmed by a direct read.]

## What landed since the 10-01 report (merged on `main`)

| PR | What |
| --- | --- |
| #1098 | Decision 58 answered: you landed williamson-construction-co#9 |
| #1099 | A Testing report within a month pushes Maintenance back one cycle |
| #1101 | Both approved reports sent (Sonder Testing, 29 Navy); BACKLOG and journal |
| #1102, #1104, #1109 | P1-29: Slice Machine is deprecated; the migration plan; your decisions |
| #1105 | P1-23: `launch` audits the row's live url |
| #1106 | `roster-urls` retries a transport error once (#1103) |
| #1108, #1111 | Mantis Landscaping plan, your answers, the Turso row, P0 |
| #1110 | Roalson MarkUp round closed, 12 of 12 pins |
| #1112 | Video hosting answered; hand-off brief |
| #1114, #1115 | #1090 phase 1 on four sites; Mantis build hook |

Nothing merged between `a1424bdf` (10-01 19:20:52Z) and this pass. During it, two did: #1117 (`2c5d9f1c`, 16:04Z, `prismic-ci` from a cloud session) and #1118 (`9664ef0a`, 16:17Z, decision 64) [M].

**Open PRs** [M, 16:00Z; #1117 has merged since]:

- **#1100**, the release PR: clean and green. It is yours.
- **#1116** (`video`, 10-01): review round 1 was folded in at 15:59Z, and CI was running at 16:00Z.
- **#1117** (`prismic-ci` from the cloud): merged at 16:04Z.

#1116 belongs to a live session.

## Nightlies (scheduled, 10-01 12:00Z → 10-04 16:05Z) [M, job logs]

Every scheduled run since the last report concluded `success`: 48 runs since 12:00Z, all on `main` [M, Actions API, `event=schedule`].

| Nightly | 10-02 | 10-03 | 10-04 |
| --- | --- | --- | --- |
| fleet-db-backup | `DUMP_VERIFY rows=1106 mismatches=0` | `rows=1100 mismatches=0` | `rows=1099 mismatches=0` |
| fleet-prismic-drift | `wrote=15 failed=0`; 11 checked, 0 failed | same | same |
| fleet-security | `wrote=15 failed=0` | same | same |
| fleet-lighthouse | `wrote=15`/`21 failed=0`; `ROSTER_URL_SUMMARY checked=35 pass=33 fail=0 retried=0` | same, `retried=1` | same, `retried=0` |
| daily-reports | No reports due; digest sent | No reports due; digest skipped (unchanged since 10-02) | same as 10-03 |
| fleet-smoke | `wrote=15 failed=0` | same | same |
| fleet-form-e2e | `wrote=15 failed=0` | same | same |
| release-health | green | green | pending |

The rest of the schedule since the last report:

- **10-01's later runs:** security, lighthouse (`fail=1`, the-pointe-burbank, before its url fix was re-probed), daily-reports (the two sends), smoke, form-e2e and release-health, all green.
- **forms-deadletter-replay:** every slot green.
- **renovate:** green twice a day.
- **fleet-config-drift (weekly, 10-04 13:18Z):** `SYNC_CONFIGS_DRIFT drifted=15 clean=0 skipped=0 total=15`. #1007 was rewritten and commented, the same picture as its first run.

Details from the logs:

- **The roster url fix holds:** `fail` went from 1 on 10-01 to 0 from 10-02 on. #1106's retry fired once (10-03) and the url passed.
- **Form e2e still covers 8 of 15 sites.** `FLEET_FORM_E2E_UNCOVERED sites=29-navy,caltex,data-dynamiq,erp-industrials,la-homelessness-initiative,la-homelessness-youth,revogen`, unchanged; these wait on client deploys (item 31).
- **fleet-security warns** `reddoorla/erp-industrial — no feature update has LANDED in 52d` on 10-04 (49d on 10-01). It is a warning, not a failure.
- **The backup's row count fell by 14** over three days (1113 → 1099) with `mismatches=0` each time. The likely cause is `fleet_events` retention (`pruneFleetEvents`) [I]. It was not traced to a table.

No "Nightly … failing" issue opened or closed. Bot-filed issues still open: #754 (protection gaps; see top of stack 4) and #1007 (config drift).

**Pending at 16:05Z:** release-health (10-04), the later forms-deadletter-replay slots and renovate.

## What went wrong, or nearly did

- **The Routine fired on a Sunday, at 08:59 PDT.** Its stated schedule is Monday to Thursday at 04:48. Monday's pass should still run as the heavier one; this file does not stand in for it.
- **A BACKLOG fact went stale without anyone noticing.** "Data Dynamiq has no GA4" (P0-4) was false on today's row. Whoever set the property did not record it, so the backlog had no way to know. Corrected in P0-4.
- **Decision numbers again.** Decision 64 was on an unmerged branch when this pass began, and landed (#1118) while it ran, which conflicted this PR's journal. BACKLOG now says the next new item is 65.
- **`list_sessions` / `get_session` are still not available to this Routine** [M, ToolSearch: no match]. The worker state below comes from branches and PRs.

## Live worker sessions (reported, not touched)

- **Mantis P2a:** ended at decision 64, landed in #1118 [M].
- **prismic-ci cloud:** landed in #1117 at 16:04Z.
- **video encode** (#1116, `claude/video-encode-command`, 15:59Z): live; review round 1 is done.
- **GOLA** (`claude/practical-ride-kbipzv`): idle since 10-01 02:25:59Z, 13 commits, no PR [M]. Its `CLAUDE.md` change still takes effect only through a PR.
- **No other fresh branch.** `claude/youthful-turing-o7qpdl` is this pass's.

## Next for agents (from the backlog)

Nothing ranked P1 is claimed, and no fresh branch touches these files [M].

- **P1-27, the port-picker race:** recommended. It is small, GREEN, and it cost a red `build` on 09-30. `src/util/free-port.ts` still has no retry; `withFreePort` only rewrites a url [M].
- **P1-24, the hydration marker (#947/#948):** recommended. `template.ts:32` still reads `hydrationMarker: "footer"` [M]. It needs `reddoor-starter` attached to the session.
- **P1-25, Prismic toolbar under the CSP baseline:** ready, ranked third. `BASELINE_CSP` is at `src/configs/svelte.ts:103`, and `frame-src` at `:117` is still `self` plus Vimeo [M].
- **Not ready:** P1-26 (parked); #921 persistence (needs a re-measure); P1-30 (Mantis, behind decision 64).

### Briefs

```markdown
## Worker brief — P1-27: retry an audit's server on EADDRINUSE

**Item.** P1-27 · no issue yet (open one) · 🟢 GREEN · effort S
`findFreePort` binds :0, closes, and hands the port to a server that binds it
later. On 2026-09-30 #1066's `build` failed 7 tests in
`tests/audits/a11y-live-spec.test.ts` with `EADDRINUSE … port: 40937` on a head
that differed from a green one only in docs [M, BACKLOG P1-27]. Nothing retries.

**Verify first.** `grep -n EADDRINUSE src/util/free-port.ts src/audits/a11y.ts src/audits/lighthouse.ts src/audits/smoke.ts`
Expect: no match [M, 2026-10-04 16:08Z].

**Start here.**

- `src/util/free-port.ts:24` — `findFreePort` (the TOCTOU note above it)
- `src/audits/a11y.ts:407-415` — the second-port helper, and `:1272`, the preview port
- `src/audits/lighthouse.ts:164` — the port for the lhci server
- `src/audits/smoke.ts:240` — the smoke server's port
- `tests/util/free-port.test.ts`, `tests/audits/a11y-live-spec.test.ts` — tests to extend

**Done when.** A test that squats the first port picked still gets an audit
result from each of a11y, lighthouse and smoke (up to 3 tries with a fresh
port), a server that fails for any other reason fails at once without a
retry, and each of those tests goes red with the retry removed.

**Mutations I will run** (each must turn a test red):

1. Remove the retry (today's behaviour).
2. Retry on every spawn error, not only EADDRINUSE.
3. Retry with the same port instead of a fresh one.
4. Allow unlimited tries.

**Stop conditions** (beyond AUTONOMY.md's six):

- If the server's EADDRINUSE cannot be told apart from other failures without
  parsing localized output, write the options under Operator decisions and end.
- Do not change `--strictPort`: auditing the wrong server is worse than failing.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim the issue. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), then a
   review, with the mutations table in the PR body.
4. Move P1-27 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```

```markdown
## Worker brief — P1-24: a bundle-only hydration marker in the starter and the smoke recipe

**Item.** P1-24 · #947 (starter and recipe half) + #948's residual race · 🟡 YELLOW · effort M
The smoke recipe scaffolds `hydrationMarker: "footer"`, which is in the
server HTML and cannot prove hydration. Measured on roalson: preview alone
returned 208 in 12 of 14 cold runs, and preview plus a wait on
`html[data-hydrated]` returned 208 in 10 of 10 [M, BACKLOG #947 note].

**Verify first.** `sed -n 30,33p src/recipes/smoke-suite/template.ts`
Expect: `{ path: "/", name: "home", hydrationMarker: "footer" },` at line 32
[M, 2026-10-04 16:08Z]. Then, in `reddoorla/reddoor-starter` (attach it with
`add_repo`): `grep -rn 'data-hydrated' src/routes/+layout.svelte` → no match.

**Start here.**

- `src/recipes/smoke-suite/template.ts:32` — the scaffolded marker
- roalson-interests #57 — the root layout `onMount` that sets `html[data-hydrated]`
- `reddoor-starter` `src/routes/+layout.svelte` — where the marker goes [I: path not read this morning]
- `tests/recipes/smoke-suite.test.ts` — the recipe's tests

**Done when.** The starter PR sets `document.documentElement.dataset.hydrated`
in the root layout's `onMount` and lands; the recipe scaffolds
`hydrationMarker: "html[data-hydrated]"`, and a recipe test pins it. The fleet
rollout is separate per-repo PRs, not this item.

**Mutations I will run** (each must turn a test red):

1. Scaffold `"footer"` again.
2. Set the marker at module top level instead of in `onMount` (present before hydration).
3. Scaffold the selector without the attribute (`html`).

**Stop conditions** (beyond AUTONOMY.md's six):

- No fleet sweep: one PR in `reddoor-starter` and one here, nothing else.
- `reddoor-starter-blux` is cherry-pick only (`CLAUDE.md`); leave it for a follow-up line.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Claim on #947. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), then the
   3-lens review, with the mutations table in the PR body.
4. Move P1-24 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`
   (starter PR first).
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```
