# Morning brief — 2026-09-30 (PM pass, run late)

## One-line verdict

**All 13 scheduled nightlies are green with `failed=0` on every sweep, and 0.102.0 is on npm. The one thing blocking today's report is Sonder's first Testing report. #1060 landed at 19:18Z, so a refresh preview can now clear it.**

The scheduled Routine failed at bootstrap this morning, so this pass ran by hand from 18:55Z. By then most of the day had already happened: about 30 PRs landed since yesterday's report, and there are **0 open PRs** [M, 18:56Z].

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28, clean). There is no `awaiting` row.

## Top of stack (yours; ordered by date)

1. **Today, 09-30 — Sonder Testing, the fleet's first Testing report.**
   - Press **refresh preview** on Sonder's Testing draft (`report_01M3SGQRB1P4AX68Z20PME512P`). Approve it if Google Indexed comes back measured.
   - Its one blocker is `Maint: Google Indexed: not yet green (unknown) — Not yet measured` [M, 19:00Z]. The other 12 gating items pass.
   - Your 18:40Z re-render could not clear it: at that point the item was draft-time-only (`retick.ts`).
   - **#1060 (`8ae1bf8c`, 19:18Z, from the Sonder Google Indexed worker)** changes that. A refresh preview on an unsent, unapproved draft of a search-enrolled site now runs the Search Console lookup.
   - Sonder is search-enrolled now: `search_console_property = https://gallerysonder.com/`. After #1060 lands, a lookup that returns `unknown` leaves the stored record as it is.
   - If the refresh still shows `unknown`, the logged send-anyway override naming only that item is the fallback.
   - Unproven [I]: this pass has not seen a post-#1060 refresh run.
2. **Today, 09-30 — Vida Legacy Foundation Maintenance 2026-09 (new).**
   - Today's run drafted it at 16:00:48Z with 0 blockers.
   - Two seconds later it sent VLF's Launch email and flipped VLF to maintained.
   - Approve it now, or leave it and let October be VLF's first Maintenance report. BACKLOG item 41; my pick is to leave it.
3. **By 10-05 — Webflow conversions (hard date 10-19).**
   - Via Tim: D0 (Webflow billing), D6 (Construction form recipient), D7 (GoDaddy holder), D8 (Adobe Fonts kit owner).
   - Construction: you published release `ar0oXBIAAC0ARR2n` at 18:50Z, and the site serves on Netlify (#1062). Three launch calls are open in BACKLOG 40:
     - (a) About's CTA is live as "Contact". Change it to "Hire Us" in the dashboard.
     - (b) Remove the site-side Turnstile refusal, or keep it.
     - (c) Whether to add the preview host to the Turnstile widget.
   - Homes: nothing is waiting on you. williamson-homes#7 merged as `ca6027f` on your "continue" (BACKLOG 37). `williamson-homes.netlify.app` serves it: all 10 reference paths answer 200 [#1059].
4. **10-05 — Data Dynamiq, Espada, LAHI, Revogen, Vineyard Maintenance.** Nothing to do yet. There are no draft rows. Preflight is clean on all five, and function health was stamped 09-30 between 14:50Z and 15:04Z [M]. Data Dynamiq will draw no analytics section: it has no GA4 and no search enrolment.
5. **Undated:**
   - **29 Navy.** Press refresh preview on `/s/29-navy`, then approve. The draft has had 0 blockers since 09-17, and it re-verified today as this pass's positive control.
   - **the-pointe-burbank.** Set its url to `https://the-pointe-burbank-rd.netlify.app`. The nightly stored the `fail` it was waiting for (BACKLOG 21).
   - **`PRISMIC_TOKEN_VIDA_LEGACY`.** Mint it and set it; now that VLF is maintained, the drift sweep reads it without a token (BACKLOG 42, 🔴).

### Waiting on you (Discord)

- **#worthe-web-maintenance, Tim, 09-17 (13 days).** He asks for a slow ease-in at the end of the homepage slideshow photos. There has been no reply and no reaction since. [M: 17 channels scanned, 80 candidate mentions, 1 open.]

### Changed since yesterday's list

These asks are gone:
- **Revogen GA4 is set.** The row has `ga4_property_id = 545817747` [M].
- **LAHI no longer needs a refresh.** There is no LAHI draft yet, so its draft will carry #957's evidence.
- **Release PR #988 (0.102.0)** was merged by you at 14:35Z. It was on npm at 15:01Z.

## What landed since the 09-29 report (merged on `main`)

| PR | What |
| --- | --- |
| #975, #990, #992, #985, #986, #1004, #995, #1005 | The P1 queue from yesterday: P1-20 digest, P1-19, P1-16, P1-17, P1-3 (both PRs), P1-12, P1-7 |
| #916, #918, #920, #989, #1014/#1035, #1003, #1016, #1017, #1034 | a11y contrast, the GA4 tag and recipe, the spawn reap, the blend-mode crash, a11y under CSP, Search Console evidence, form-e2e widening, title length as a warning |
| #1039 (+ reddoor-starter#163, 25 guard PRs) | #948: the axe scan runs on the gate's own production build |
| #1032 | Webflow capture tools. OD7-P0 captures are complete, and Domaru is archived |
| #988 | Release 0.102.0 (by you) |
| #1041–#1058 | Docs: the connector-first rule, Williamson secrets and progress, BACKLOG 26–39 answered |

Also done:
- **gallerysonder#105** made Sonder's forms real, and form-e2e now passes on Sonder.
- **williamson-homes#5 and #6** merged.
- **williamson-construction-co#2, #3, #5 and #6** merged. #3 landed as `eec070be`.

## Nightlies (scheduled, 09-29 17:00Z → 09-30 19:00Z) [M, job logs]

Every run started 4.5 to 6.5 hours after its cron minute.

| Nightly | Run (UTC) | Result |
| --- | --- | --- |
| fleet-db-backup | 10:39 | green, `DUMP_VERIFY rows=1094 mismatches=0`, quota `verdict=ok` |
| fleet-prismic-drift | 10:51 | green, `wrote=15 failed=0`. Warns that VLF has no write token (item 41) |
| fleet-security | 11:37 | green, `wrote=15 failed=0`. **`RULESET_BYPASS unread=0 read=28` closes P1-22.** `PROTECTION_AUDIT gaps=15 covered=14`; #754 was rewritten |
| fleet-lighthouse | 14:43–15:06 | green, `wrote=15 failed=0`. Signals `wrote=20 failed=0`. `ROSTER_URL_SUMMARY checked=34 pass=31 fail=1 no_url=2` (the-pointe-burbank) |
| daily-reports | 15:59–16:01 | green. Drafted Sonder Testing and VLF Maintenance, sent VLF Launch, and sent the digest (`decision=first`) |
| fleet-smoke | 16:12–16:39 | green, `wrote=15 failed=0`, `FLEET_SMOKE_UNMEASURED count=0` |
| fleet-form-e2e | 16:25–16:31 | green, `FORM_E2E_CONTROL passed=22`, `wrote=15 failed=0`. Uncovered: 29-navy, caltex, data-dynamiq, erp-industrials, la-homelessness-initiative, la-homelessness-youth, revogen |
| forms-deadletter-replay ×3, renovate ×2, release-health | — | all green, `replayed=0 still_failing=0` |

The fleet grew from 14 to 15 swept sites because VLF went maintained.

No "Nightly … failing" issue opened or closed. The only open bot-filed issues are #754 (protection gaps) and #1007 (config drift, 15 of 15 drifted, filed by the first dispatched sweep 09-29 22:12Z).

**Pending at 19:00Z:** release-health (yesterday's ran at 19:34Z) and the 18:47 forms-deadletter-replay slot.

## What went wrong, or nearly did

- **The PM Routine failed at bootstrap.** This pass ran by hand 14 hours late. It reports a day that is mostly over, which is the opposite of what a morning report is for.
- **A re-render ran before the fix it needed had landed.** The 18:40Z re-render of Sonder's Testing draft could not clear Google Indexed, which was draft-time-only then (`retick.ts`).
  - The backlog's 15:45Z line said "the draft it creates will carry this evidence without a refresh". That held for Forms and Titles. It did not hold for Google Indexed, whose lookup had never run.
  - The live worker's #1060 (19:18Z) closes this gap.
  - This pass's first draft of the report called the blocker un-refreshable. That was true at 19:00Z and wrong by 19:18Z, and it was corrected before landing.
- **Collision seen and handled.** A second worker took over williamson-construction-co#3 mid-flight (BACKLOG 38). You answered "re-dispatch", and #3 landed. The journal records the fresh-branch check that session skipped.
- **Stale branches.** Five `claude/*` branches are live with no PR:
  - `a11y-browser-missing-csp-r3`, `a11y-blend-mode-unmeasured` and `digest-send-exact-rule` are superseded by merged PRs [I].
  - `nifty-dirac-2zmegy` and `blissful-feynman-xxghob` are small docs orphans.
  - A cloud session cannot delete branches (the proxy refuses it). They are listed here for the laptop.

## Live worker sessions (reported, not touched)

- **Sonder Google Indexed:** owns top-of-stack item 1.
- **Williamson Homes:** #7 merged as `ca6027f` and serves on Netlify (#1059).
- **Williamson Construction:** #3, #5 (intake) and #6 (wiring) have landed, and the site serves on Netlify (#1062). Three launch calls are open at BACKLOG 40.
- **#674 rules:** the second pass landed in #1050. It is waiting on your accept or cut of 34 candidates.

## Next for agents (from the backlog)

- **P1-23 / #1056:** `launch` scores the local checkout, not the live site, and mails that score. It is dated in effect, because roalson-interests launches next [I].
- **P1-24 / #947 + #948's residual race:** the hydration marker in the starter and the smoke recipe. The fleet rollout stays per-repo PRs.
- Not ready:
  - #921 persistence (unblocked, but #921's table needs a re-measure).
  - #1055 (product call, BACKLOG 43).

### Briefs

```markdown
## Worker brief — P1-23: `launch` scores the live site, not the local checkout

**Item.** P1-23 · #1056 · 🟡 YELLOW · effort S–M
A launching site's row is not `maintained`, so `deployedUrl` is unset and the
launch audit falls back to a local checkout's dev server. That score is stored
in `site_health` and mailed in the go-live email. VLF's baseline was stored as
52/100/100/61 against 85/100/100/100 live [M, journal 2026-09-29].

**Verify first.** `sed -n 283,288p src/audits/lighthouse.ts; grep -n 'audit(site)' src/recipes/launch.ts`
Expect: `site.deployedUrl ? deployedLighthouse(...) : checkoutLighthouse(...)`,
and `results = await audit(site);` at launch.ts:618 with no `deployedUrl` set
on the launch path.

**Start here.**

- `src/recipes/launch.ts:618` — `results = await audit(site)`
- `src/cli/commands/launch.ts:43` — `resolveSites({ site, cwd })`, the checkout-resolved site
- `src/audits/lighthouse.ts:285-287` — the deployed-vs-checkout fallback
- `src/inventory/select.ts` (header comment, ~8-22) — why only `maintained` rows get `deployedUrl`
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
## Worker brief — P1-24: a bundle-only hydration marker in the starter and the smoke recipe

**Item.** P1-24 · #947 (recipe half), #948 residual · 🟡 YELLOW · effort M
The smoke recipe scaffolds `hydrationMarker: "footer"`, which is in the
prerendered HTML and so cannot prove hydration. On roalson, preview alone gave
208 in 12 of 14 cold runs; preview plus a wait on a bundle-only marker gave 208
in 10 of 10 [M, BACKLOG "Blocked behind another PR"]. The 25 guard PRs it
waited on merged 2026-09-30.

**Verify first.** `sed -n 30,34p src/recipes/smoke-suite/template.ts`
Expect: `hydrationMarker: "footer"` at line 32.

**Start here.**

- `src/recipes/smoke-suite/template.ts:32` — the scaffolded marker
- roalson-interests #57 — `html[data-hydrated]` set in the root layout's onMount
- `reddoorla/reddoor-starter` root layout (`src/routes/+layout.svelte`) — attach with `add_repo` first
- the a11y spec's reveal pass that should wait on the marker (#948's residual race)

**Done when.** reddoor-starter sets `html[data-hydrated]` only from the client
bundle, the recipe scaffolds that marker, and a test fails if the marker would
be present in prerendered HTML.

**Mutations I will run** (each must turn a test red):

1. Scaffold `"footer"` again.
2. Set `data-hydrated` in `app.html` (present before JS).
3. Drop the a11y spec's wait on the marker.

**Stop conditions** (beyond AUTONOMY.md's six):

- Rolling the marker into client site repos is a fleet-wide mutation: per-repo
  PRs for review only, and not in this item. Stop after the starter and central.
- `reddoor-starter-blux`: cherry-pick only, never merge; if it needs the
  change, write it up rather than doing it.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template (claim on #947; starter PR first, then
central; move P1-24 to Done; `node scripts/land-prs.mjs <pr>`; journal).
```
