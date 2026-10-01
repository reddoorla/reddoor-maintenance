# Morning brief — 2026-10-01 (PM pass, run early)

## One-line verdict

**You approved Sonder's Testing report and 29 Navy's Maintenance report last night. Both are still unsent and go out with today's `daily-reports` run (~16:00Z). Every nightly since the last report is green, 0.103.0 is on npm, and nothing is waiting on an agent.**

This pass ran at **03:36Z (20:36 PDT on 09-30)** [M, `date -u`]. That is about eight hours before the Routine's 04:48 PT slot and eight and a half hours after yesterday's late report. So it covers 09-30 19:00Z → 10-01 03:45Z, and **no 10-01 fleet nightly has fired yet**. They are listed as pending below.

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28, clean). There is no `awaiting` row. Today's two sends are real client sends, not [TEST] sends, so they do not add rows.

## Top of stack (yours; ordered by date)

1. **Today, 10-01, ~16:00Z — two client sends ride `daily-reports`. Nothing to press.**
   - Sonder Testing `report_01M3SGQRB1P4AX68Z20PME512P`: approved 09-30 21:18:16Z (dashboard), `sent_at` NULL, `approveBlockers` `[]` [M, live row 03:40Z].
   - 29 Navy Maintenance `rec67VEr1fwaZyNtv`: approved 09-30 21:20:01Z (dashboard), `sent_at` NULL, `approveBlockers` `[]` [M].
     - Its stored evidence is still from 09-27, and its body still reads "Completed on 09.17.2026". That is the body the clean 09-28 [TEST] send rendered [I].
   - The send step is `report --send-ready` (`.github/workflows/daily-reports.yml:184`).
   - If either should **not** go, press "Don't send" (or un-approve) before ~16:00Z. Otherwise, check the digest for both.
2. **Today, 10-01 — Sonder Maintenance is due.**
   - No row yet [M]. It is held behind the unsent Testing report (`src/reports/queue.ts`, higher tier pending).
   - It drafts in the same run that sends Testing, or the next night's [I, not read from code].
   - It will need your approve.
3. **By 10-05 — Webflow conversions, via Tim (hard date 10-19).**
   - Still open: D0 (Webflow billing: what actually stops on 10-19), D6 (Construction's form recipient; its row stays `building` until then), D7 (the GoDaddy holder).
   - D8 is answered (kit `noj4tji`).
   - Both Williamson sites serve on Netlify, and both fidelity passes have landed (Construction #8 `205608d`, Homes #10 `5ec2ddd`). Cutover is planned for 10-14.
4. **10-05 — Data Dynamiq, Espada, LAHI, Revogen, Vineyard Maintenance.**
   - No rows yet, and each one's next due date is 2026-10-05 [M, `nextDueDates` on live rows].
   - They draft on 10-05 from 10-04's evidence. Nothing to do yet.
5. **Undated, new since yesterday's report:**
   - **Roalson, BACKLOG 53:** land roalson-interests#242 (Improved tab matches Land, `48e1c11`, CI green) without a third round, or ask for one. _Pick:_ land.
   - **Roalson, BACKLOG 54:** land roalson-interests#243 (the map flies straight to the pressed listing; it reopens #136), or keep the three flights. _Pick:_ land.
   - **Roalson, BACKLOG 55:** three pin questions.
     - (i) Keep the PROPERTIES button on the homepage? _Pick:_ keep it.
     - (ii) Ask Nicole which "drop down" she means. Her map never drew tiles.
     - (iii) Download glyph for the property package?
   - **Construction, BACKLOG 52, still open:** run the matching gate's Phase 1 from the laptop, or drop that done-when for P2b. _Pick:_ drop it.
   - **Privacy, BACKLOG 45 and 46** (parked with P1-26, so not urgent):
     - 45: one legal review of the template.
     - 46: California analytics consent: (a) keep D3, (b) a light gate, or (c) cookieless.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

- **#worthe-web-maintenance, Tim, 09-17 (14 days).** He asks for a slow ease-in at the end of the homepage slideshow photos. There has been no reply and no reaction since.

[M: 16 channels active in 14 days, 89 candidate mentions. Not counted as asks: Erik's three 09-17 answers to your questions (#full-financial "Archive", #acacia-landscaping "yes", #alamo-anatomy "you can archive"), and Nicole's 10-01 00:57Z #roalson-interests note that her MarkUp comments are in. Those comments were worked by the 10-01 Roalson session (#1092 → BACKLOG 53–55).]

### Changed since yesterday's list

These are no longer asks:

- **Sonder Testing and 29 Navy:** approved (above).
- **VLF 2026-09:** withdrawn 10-01 01:03:47Z through #1078's "Don't send". VLF is Quarterly, so its first Maintenance report is **12-30** (BACKLOG 41).
- **`PRISMIC_TOKEN_VIDA_LEGACY`:** set 09-30 21:27:56Z (#1076).
- **the-pointe-burbank url:** set 09-30 19:33Z (BACKLOG 21).
- **Construction's three launch calls:** answered (BACKLOG 40).
- **williamson-homes#9 and #10:** both merged (BACKLOG 47, 53-Homes). Both slice models are pushed, and about-us's steps render tall on the live site [M at 02:28Z by that session].
- **Beachfront's Netlify ID:** written.
- **GA4 for the cockpit's four sites (BACKLOG 48–50):**
  - Three properties are recorded (1836dig, 29 Navy, Data Dynamiq), and their web streams exist.
  - Youth is `no analytics`.
  - Reddoor's `industry` label is pushed.
- **Releases:** you merged #1074 (0.102.1, 22:18Z) and #1085 (0.103.0, 01:42Z). npm shows 0.103.0 at 02:03:23Z [M, `npm view … time`].

## What landed since the 09-30 report (merged on `main`, 19:00Z → 03:11Z)

| PR | What |
| --- | --- |
| #1060, #1063 | Refresh preview re-measures Google Indexed; Sonder Testing reaches 13/13 |
| #1078 | P1-28: "Don't send" withdraws a draft (migrations 0038–0039) |
| #1066 | prismic-ci reads a pnpm 12 two-document lockfile |
| #1070, #1081 | header-image: catch late consent banners, and refuse a shot whose stylesheets failed |
| #1076 | prismic-drift passes `PRISMIC_TOKEN_VIDA_LEGACY` |
| #1074, #1085 | Releases 0.102.1 and 0.103.0 (you) |
| #1059, #1062, #1064, #1065, #1067–#1069, #1071–#1073, #1075, #1077, #1079, #1080, #1082–#1084, #1086–#1089, #1091, #1092 | Docs: answers to BACKLOG 21 and 37–53, P1-25/26/27, the privacy plan (parked), Roalson MarkUp 53–55 |

Client repos (from those PRs' records):

- williamson-homes#9 (`b9cc06c`) and #10 (`5ec2ddd`).
- williamson-construction-co#8 (`205608d`).
- reddoor-website#234.
- roalson-interests#240 and #241.

There are **0 open PRs** in this repo [M, 03:45Z].

## Nightlies (scheduled, 09-30 19:00Z → 10-01 03:45Z) [M, job logs]

| Nightly | Run (UTC) | Result |
| --- | --- | --- |
| release-health | 09-30 19:34 | green |
| forms-deadletter-replay | 09-30 22:38 | green, `DEADLETTER_REPLAY replayed=0 still_failing=0 unmarked=0 unreadable=0` |
| renovate | 10-01 02:36 | green |

No fleet sweep ran in this window, so no `FLEET_WRITE_SUMMARY` line exists to read. No "Nightly … failing" issue opened or closed. The open bot-filed issues are still #754 (protection gaps) and #1007 (config drift).

**Pending (10-01 slots not yet fired at 03:45Z):**

- fleet-db-backup, fleet-prismic-drift, fleet-security, fleet-lighthouse, daily-reports, fleet-smoke, fleet-form-e2e, release-health.
- The 06:47, 12:47 and 18:47 forms-deadletter-replay slots.
- The 00:47 slot had not appeared either; schedules fire hours late [M, every slot this week].

Today's prismic-drift run is the durable proof for two fixes:

- VLF read with a token (#1076).
- Reddoor's `industry` label (BACKLOG 50).

## What went wrong, or nearly did

- **The PM Routine fired at the wrong hour.** It fired at 20:36 PDT, not 04:48 PT. Yesterday it failed at bootstrap. A morning report written before the nightlies run cannot report them, so tomorrow's pass inherits today's sweep results unread. That is worth a look at the Routine's schedule [I: whether the trigger is set to UTC 03:36, or fired as a catch-up, was not read].
- **Two Operator decisions share the number 53.** Roalson #242 (#1092) and Homes #10 (#1087, #1089, #1091) both landed as "53". Each PR title cites its own 53, so neither was renumbered. The second now carries a note, and new items continue from 57.
- **Approval did not record a refresh for 29 Navy** [M]. Its evidence rows are still 09-27 and its body is the 09-17 render. The gate is clear (`approveBlockers` `[]`), and the body matches the clean 09-28 [TEST] send. It is noted here so a later reader does not assume it was refreshed.
- **`list_sessions` and `get_session` are not available to this Routine** (no matching tool) [M]. Worker state below comes from branches and PRs, not session reads.

## Live worker sessions (reported, not touched)

- **GOLA** (operator's desktop session):
  - Branch `claude/practical-ride-kbipzv` has 13 commits, last at 02:25:59Z, and no PR.
  - It adds 66 journal lines and 13 lines to `CLAUDE.md` ("research agents run on Sonnet, writing and review on the session model").
  - The `CLAUDE.md` change will need a PR to take effect.
- **Roalson MarkUp:** ended with #1092 (7 of 12 pins fixed; #242, #243 and the pins held for you).
- **Williamson Homes and Construction:** both ended with their fidelity passes landed.
- **Stale branches.** Merged or superseded `claude/*` branches remain; the proxy refuses deletes:
  - `pm-0930-answers`, `admiring-goodall-llh7pb`, `sonder-header-docs` and `park-privacy-gola` (squash-merged).
  - Yesterday's five.

## Next for agents (from the backlog)

- **P1-23 / #1056:** `launch` scores the local checkout, not the live site. Unclaimed; nothing has changed since yesterday. Its lines re-verified this morning: `lighthouse.ts:285-287`, `launch.ts:618`.
- **P1-29 / #1090 (new):** research only. Is Slice Machine deprecated, and what does Prismic recommend for code-first model management? The decision after it is yours (BACKLOG 57).
- **P1-24 / #947:** still ready (`template.ts:32` is still `"footer"`). Brief as in yesterday's report, unchanged.
- **Not ready:**
  - P1-26 (parked by you).
  - #921 persistence (needs a re-measure).
  - P1-25 and P1-27 are ready but rank below these.

### Briefs

```markdown
## Worker brief — P1-23: `launch` scores the live site, not the local checkout

**Item.** P1-23 · #1056 · 🟡 YELLOW · effort S–M
A launching site's row is not `maintained`, so `deployedUrl` is unset and the
launch audit falls back to a local checkout's dev server. That score is stored
in `site_health` and mailed in the go-live email. VLF's baseline was stored as
52/100/100/61 against 85/100/100/100 live [M, journal 2026-09-29].

**Verify first.** `sed -n 283,288p src/audits/lighthouse.ts; grep -n 'audit(site)' src/recipes/launch.ts`
Expect: `site.deployedUrl ? deployedLighthouse(...) : checkoutLighthouse(...)`
at 285-287, and `results = await audit(site);` at launch.ts:618 [M, 10-01 03:50Z].

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

```markdown
## Worker brief — P1-29: how Prismic wants models managed now (#1090, research only)

**Item.** P1-29 · #1090 · 🟢 GREEN · effort S
The operator asked on 2026-10-01: "slice machine is deprecated? … might be time
to find the current way Prismic wants us to work with it." Nobody has checked.
williamson-homes showed the gap: two model fields shipped in code and were
missing in Prismic until the operator pushed them from Slice Machine by hand.

**Verify first.** `gh api repos/reddoorla/reddoor-maintenance/issues/1090 --jq .state`
→ `open` with no claim comment; `npm view slice-machine-ui deprecated time.modified`.

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
