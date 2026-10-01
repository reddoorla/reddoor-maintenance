# Morning brief — 2026-10-01 (scheduled PM pass, 11:50Z)

> This replaces the 03:36Z edition of this file (#1093), which ran before any
> 10-01 nightly. That edition is in git history; its asks that still hold are
> carried below, and what changed since is marked.

## One-line verdict

**Sonder Testing and 29 Navy are approved and go out with today's `daily-reports` (~16:00Z); today's three nightlies so far are green with `failed=0`, and the Prismic drift run proved both of yesterday's fixes on `main`. Your one new ask is Construction #9 (decision 58).**

This pass started at **11:49Z (04:49 PDT)** [M, `date -u`]. It covers 10-01 03:45Z → 12:00Z.

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28, clean). There is no `awaiting` row.

## Top of stack (yours; ordered by date)

1. **Today, ~16:00Z — two client sends ride `daily-reports`. Nothing to press.**
   - Sonder Testing `report_01M3SGQRB1P4AX68Z20PME512P` and 29 Navy `rec67VEr1fwaZyNtv`: both approved, `sent_at` NULL, `approveBlockers` `[]` [M, live rows 11:55Z].
   - If either should **not** go, press "Don't send" before ~16:00Z. Otherwise check the digest for both.
2. **Today — Sonder Maintenance 2026-10 should draft in the same run, and will need your approve.** _Changed:_ the 03:36Z edition said it was held behind Testing. It is not: an approved row is not "pending approval" (`src/reports/report-row.ts:83-85`), so the queue (`src/reports/queue.ts:71-80`) has no blocker, and drafting runs before the send step (`daily-reports.yml:95` vs `:184`) [I, read from code; the run's log decides]. Approve it tomorrow morning and it sends with the 10-02 run.
3. **New — Construction, decision 58: land williamson-construction-co#9 as it is, or a third review round.** Matching gate Phase 1 for 14 pages; held after two dirty rounds. The round-2 major (controls row over See More at 390) is fixed in `106d06e` and pinned by `slider-content.spec.ts`; head `f25cfb9`, still open [M, `git ls-remote` refs/pull/9/head, ~11:56Z]. _Pick:_ land. (It landed in BACKLOG as a second "55"; renumbered 58 today.)
4. **By 10-05 — Webflow conversions, via Tim (hard date 10-19).** Still open: D0 (Webflow billing: what stops on 10-19), D6 (Construction's form recipient), D7 (the GoDaddy holder). D8 answered. Cutover planned 10-14.
5. **10-05 — Data Dynamiq, Espada, LAHI, Revogen, Vineyard Maintenance.** No rows yet; each one's next due date is 2026-10-05 [M, `nextDueDate` on live rows 11:55Z]. They draft on 10-05. Nothing to do yet.
6. **Undated, still open:**
   - **Roalson 55 (ii):** name the colour to bring back at 20%, and over what (map tint, featured card ground, or the dark strip). (i) is Erik's call.
   - **Construction 52:** answered by the cloud gate run; its merge question is now 58 above.
   - **Privacy 45 and 46** (parked with P1-26, not urgent).

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

- **#worthe-web-maintenance, Tim, 09-17 (14 days).** A slow ease-in at the end of the homepage slideshow photos. No reply and no reaction since.

[M, 11:55Z: 16 channels active in 14 days, 89 candidate mentions, 6 neither replied to nor reacted to. Not asks, as at 03:36Z: Erik's three 09-17 answers (#full-financial, #acacia-landscaping, #alamo-anatomy) and Nicole's two 10-01 00:57Z #roalson-interests lines, whose MarkUp pins the Roalson sessions worked.]

### Changed since the 03:36Z edition

No longer asks:

- **Roalson 53 and 54:** landed on your "land what you can": roalson-interests#242 `5e47eeb`, #243 `195a798` (now `main`'s head [M]).
- **Roalson 55 (iii):** download, landed as #245 `72fa1c0` (fetch-and-save, since `download` is ignored cross-origin).
- **Williamson Homes:** #11 (pinned steps stage) landed as `cf5a8fc`, now `main`'s head [M].

## What landed since the 03:36Z edition (merged on `main`)

| PR | What |
| --- | --- |
| #1093 | The 03:36Z PM pass |
| #1094 | Journal: Williamson Homes' steps stage (williamson-homes#11) |
| #1095 | Construction's matching gate runs from the cloud; #9 held at round 2 |
| #1096 | Roalson MarkUp round: #242, #243, #245 landed; 53–55 answered |

There are **0 open PRs** in this repo [M, 11:55Z].

## Nightlies (scheduled, 10-01 03:45Z → 12:00Z) [M, job logs]

| Nightly | Run (UTC) | Result |
| --- | --- | --- |
| forms-deadletter-replay | 06:35 | green, `DEADLETTER_REPLAY replayed=0 still_failing=0 unmarked=0 unreadable=0` |
| fleet-db-backup | 11:06 | green, `DUMP_VERIFY loaded=true tables=11 rows=1113 mismatches=0` on the plain and the encrypted copy; `FLEET_DB_USAGE … worst=storage_bytes:0.79% verdict=ok` |
| fleet-prismic-drift | 11:18 | green, `FLEET_WRITE_SUMMARY wrote=15 failed=0 total=15`; `11 checked, 0 failed, 4 skipped` |

Today's drift run is the durable proof the 03:36Z edition was waiting for:

- **VLF reads with its token** (#1076, BACKLOG 42): no token warning; `vida-legacy`, 18 models match.
- **Reddoor's `industry` label** (BACKLOG 50): `reddoor-la`, 25 models match, nothing to push.

No "Nightly … failing" issue opened or closed. The open bot-filed issues are still #754 (protection gaps, last bot comment 09-30 11:40Z) and #1007 (config drift).

**Pending at 12:00Z:** fleet-security, fleet-lighthouse, daily-reports (the two sends and Sonder Maintenance's draft), fleet-smoke, fleet-form-e2e, release-health, and the 12:47 and 18:47 forms-deadletter-replay slots. The 00:47 slot did not appear in the run list for 10-01 [M].

## What went wrong, or nearly did

- **Two PM passes in one day.** The Routine's 03:36Z firing (20:36 PDT on 09-30) and this 11:49Z one both target "10-01". The early one ran before every nightly, so it could report none of them; this one replaces its file. Whether the early firing was a catch-up or a second trigger was not read [I].
- **Operator decision numbers collided again.** Construction's #9 landed as a second "55" (#1095), and #1090's item sat as "54" while P1-29 and the 03:36Z report cite "57". Both relabelled today (57, 58), with a note above the 53s; next new item is 59.
- **A backlog guess corrected from code.** "Sonder Maintenance is held behind Testing" (BACKLOG P0-4, 03:40Z) is wrong: an approved report does not hold the queue. Today's `daily-reports` log will show which.
- **A broken table.** A blank line split BACKLOG's P1 table before P1-27, so P1-27 and P1-29 rendered as loose text. Fixed.
- **`list_sessions` / `get_session` are still not available to this Routine** [M, ToolSearch]. Worker state below comes from branches and PRs.

## Live worker sessions (reported, not touched)

- **GOLA** (`claude/practical-ride-kbipzv`): unchanged since 02:25:59Z, 13 commits, no PR [M]. Its `CLAUDE.md` change still needs a PR to take effect.
- **Construction matching gate:** ended with #1095; #9 waits on decision 58.
- **Roalson MarkUp and Williamson Homes #11:** ended with #1096 and #1094.
- **Fresh branches:** none under a day old besides GOLA and this pass's own. The stale merged/superseded `claude/*` branches listed yesterday remain; the proxy refuses deletes.

## Next for agents (from the backlog)

- **P1-29 / #1090 (research):** moved up. The npm registry now says Slice Machine "is replaced by the Prismic CLI and the Type Builder" [M], so the question has a live answer and decision 57 waits on it. Unclaimed.
- **P1-23 / #1056:** `launch` scores the local checkout. Unclaimed; lines re-verified at 11:53Z.
- **P1-24 / #947:** still ready (`template.ts:32` still `"footer"` [M]). Brief as in the 09-30 report.
- **Not ready:** P1-26 (parked), #921 persistence (needs a re-measure). P1-25 and P1-27 rank below these.

### Briefs

```markdown
## Worker brief — P1-29: how Prismic wants models managed now (#1090, research only)

**Item.** P1-29 · #1090 · 🟢 GREEN · effort S
The operator asked on 2026-10-01: "slice machine is deprecated? … might be time
to find the current way Prismic wants us to work with it." Nobody has checked.
williamson-homes showed the gap: two model fields shipped in code and were
missing in Prismic until the operator pushed them from Slice Machine by hand.

**Verify first.** `gh api repos/reddoorla/reddoor-maintenance/issues/1090 --jq .state`
→ `open` with no claim comment [M, 11:53Z]; `npm view slice-machine-ui deprecated`
→ "Slice Machine is replaced by the Prismic CLI and the Type Builder. Existing
projects are still supported." [M, 11:53Z]. That is the first source, not the
answer: find the second.

**Start here.**

- #1090's body — the three routes today and the done-when
- `docs/runbooks/prismic-model-delivery.md` — `prismic-models` + per-site `prismic-ci`
- a site's `package.json` (`slice-machine-ui`, `@slicemachine/adapter-sveltekit`), e.g. williamson-homes
- Prismic's docs and changelog; the npm pages of `slice-machine-ui` and `@slicemachine/*`

**Done when.** A write-up in `docs/` (and a summary comment on #1090) answers
"deprecated or not" with citations, lists Prismic's recommended code-first
route, and lays the options against the three routes we use today. It ends
with a one-line pick under BACKLOG Operator decisions 57. No code changes.

**Checks I will run instead of mutations** (no code; each claim is a test):

1. Every "deprecated" or "recommended" claim cites a page plus a second,
   independent source (npm metadata, changelog, or a GitHub release).
2. A negative control: a package known to be current (`@prismicio/client`)
   reads as not deprecated by the same `npm view` check.
3. Quote dates on every source, so a reader can tell old guidance from new.

**Stop conditions** (beyond AUTONOMY.md's six):

- Choosing a route is the operator's (item 57): write it up and end.
- No model push and no Prismic write from this item.

**Landing.** Docs-only PR: the write-up, P1-29 moved to Done, item 57's pick,
journal entry; `node scripts/land-prs.mjs <pr>`.
```

```markdown
## Worker brief — P1-23: `launch` scores the live site, not the local checkout

**Item.** P1-23 · #1056 · 🟡 YELLOW · effort S–M
A launching site's row is not `maintained`, so `deployedUrl` is unset and the
launch audit falls back to a local checkout's dev server. That score is stored
in `site_health` and mailed in the go-live email. VLF's baseline was stored as
52/100/100/61 against 85/100/100/100 live [M, journal 2026-09-29].

**Verify first.** `sed -n 283,288p src/audits/lighthouse.ts; grep -n 'audit(site)' src/recipes/launch.ts`
Expect: `site.deployedUrl ? deployedLighthouse(...) : checkoutLighthouse(...)`
at 285-287, and `results = await audit(site);` at launch.ts:618 [M, 10-01 11:53Z].

**Start here.**

- `src/recipes/launch.ts:618` — `results = await audit(site)`
- `src/cli/commands/launch.ts:43` — `resolveSites({ site, cwd })`, the checkout-resolved site
- `src/audits/lighthouse.ts:285-287` — the deployed-vs-checkout fallback
- `src/inventory/select.ts` (header comment) — why only `maintained` rows get `deployedUrl`
- `tests/recipes/launch.test.ts` — the existing launch tests to extend

**Done when.** `launch` on a site whose row has a live `url` scores that url
(`deployedLighthouse`), a test goes red if it falls back to the checkout, and
a launch whose url does not answer fails loudly instead of scoring localhost.

**Mutations I will run** (each must turn a test red):

1. Leave `deployedUrl` unset on the launch path (today's behaviour).
2. Set `deployedUrl` from the checkout's dev-server origin instead of the row's `url`.
3. Swallow an unreachable url and fall back to `checkoutLighthouse`.

**Stop conditions** (beyond AUTONOMY.md's six):

- If the row's `url` is not yet the production host at launch time (DNS not cut
  over), which host is "live" is a product call: write it under Operator
  decisions and end.
- Do not change `select.ts`'s rule that only `maintained` rows join `--fleet`
  sweeps; set the url on the launch path only.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Claim on #1056. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), then the
   3-lens review, with the mutations table in the PR body.
4. Move P1-23 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```
