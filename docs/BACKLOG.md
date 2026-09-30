# Backlog — what to work on next, in order

**Last full re-rank: 2026-09-29 ~06:00Z; state updated ~17:30Z** (cloud PM session, `claude/lucid-wozniak-wj8gaj`).
Built from five read-only surveys of that morning: the nightlies' job logs, every
open PR, every open issue, the live Turso fleet state (SELECT-only), and a
reconciliation of `docs/meta-week/06–14` against `git log` since 2026-09-12.
Tags: **[M]** measured that morning (query, probe, log line or file:line),
**[I]** inferred.

## How to use this file (agents: read this section first)

1. **This file is a derived view, not the state** (#711). GitHub issues, PR
   state, Actions runs and Turso are the state. Before you start an item,
   re-run its _Verify_ line. If the world has moved, trust the world and fix
   this file in the same PR.
2. **Claim before you start.** Comment on the item's issue ("Claimed by
   session `<branch>`") and check for fresh `claude/*` / `fix/*` branches and
   open PRs touching the same files (`CLAUDE.md` → Concurrent sessions). If an
   item has no issue, open one and put its number here.
3. **Keep the tiers.** Every item is tagged 🟢 GREEN (agent may do and merge),
   🟡 YELLOW (agent may do; feat → 3-lens review before merge), or 🔴 RED
   (human only). The tiers are `AUTONOMY.md`'s; this file never widens them.
4. **When you finish an item**, move it to _Done_ at the bottom with its PR
   number, in the PR that finishes it. Do not delete items; the history of what
   was ranked where is the point.
5. **Re-rank** when a hard date passes, a P0 lands, or the operator answers an
   _Operator decisions_ item. Say so in the header line above.
6. **[H] means the operator builds it by hand.** The operator tags an item
   **[H]** (after its ID) when they want to write that code themselves. It is
   ranked like any other item, but the PM pass lists it separately, never
   recommends a worker for it and never writes a brief for it, and no agent
   starts it. Only the operator adds or removes the tag.
7. **Workers never ask mid-flight.** A worker that reaches a stop condition
   adds one line under _Operator decisions_ (the exact ask, its own pick, the
   branch or PR) and ends; see `CLAUDE.md` → "Worker sessions never ask
   mid-flight". Briefs for starting a worker are in `docs/worker-brief.md`.

Ranking is (client impact × confidence) ÷ effort, with two overrides: an
**external date** the fleet does not control, and **alarm integrity** (an alarm
that cannot fire makes every other item invisible when it breaks).

---

## P0 — today and this week (dated, or the alarm itself)

### P0-1 · Confirm the first post-Airtable nightlies go green 🟢

- **Why.** Every fleet nightly on 09-27/28 hung in the Airtable write-back
  (Free-plan quota, SDK retrying 429 forever) and was killed by its step timeout
  [M, job logs of runs 36461516713, 36463310191, 36421699863, 36415353162,
  36451921171, 36460182073]. #933 and #937 removed Airtable entirely. No
  scheduled run has exercised `audit --write-back`, `github-signals` or the
  digest on post-deletion `main` yet, so "fixed" is [I] until they pass.
- **Dated.** Every maintained site's function-health stamp is from 2026-09-27
  13:39–13:58Z [M]. The pre-send gate treats evidence older than 3 days as
  unknown (`src/reports/auto-tick.ts:13-18`), so if `fleet-lighthouse` is not
  green by **2026-09-30 ~13:40Z**, Sonder's Testing (09-30) and Maintenance
  (10-01) reports and the five 10-05 reports draft blocked.
- **Verify.** Actions → scheduled runs dated today; each prints
  `FLEET_WRITE_SUMMARY wrote=N failed=0`. Tracking issues #924 (smoke), #927
  (security), #931 (daily-reports) auto-close on green. Schedules fire 3–8 h
  after their cron minute [M], so expect results 10:00–18:00Z.
- **Done when** smoke, form-e2e, security, lighthouse, prismic-drift and
  daily-reports are all green on today's `main`, and the three issues are closed.
- **Do not** dispatch `daily-reports` by hand: `--send-ready` emails clients for
  any approved, unsent report. Dispatching `fleet-security` fires
  `renovate-dispatch` in client repos. `fleet-smoke` is safe to dispatch
  (localhost only, Turso writes).

- **Status (06:45Z).** fleet-smoke, dispatched on post-deletion `main`, went
  green in 17 min with `FLEET_WRITE_SUMMARY wrote=14 failed=0 total=14
mirrored=14 mirror_failed=0` and closed #924 [M, run 36527553082]. The
  write-back path is proven; the other nightlies still have to run on their
  own schedules.
- **Done (2026-09-29).** All seven scheduled nightlies went green on their own
  schedules: db-backup, prismic-drift, security (closed #927), lighthouse
  (`wrote=14`, evidence renewed about 15:00Z), daily-reports (closed #931),
  smoke and form-e2e (each `wrote=14 failed=0`) [M, run logs].

### P0-2 · Alarms fire on a cancelled or hung run, and only for `main` 🟢

- **Why.** `fleet-lighthouse` on 09-28 hung through its 75-min step timeout and
  then through `Sweep GitHub signals to Turso` (`if: always()`, no timeout) until
  GitHub's 6-hour job limit. It ended **cancelled**, and every tracking-issue
  step in the repo is `if: failure()`, which is false on cancel, so **no issue
  was filed** [M]. Separately, a `workflow_dispatch` from a PR branch closed
  #895 while `main` was still broken: the close steps have no ref guard [M].
- **Done when** every open step also fires on cancellation, open and close
  steps act only for runs of the default branch, every `if: always()` network
  step in a scheduled workflow has a `timeout-minutes`, and a test derived from
  `.github/workflows/*.yml` asserts all three.
- **Status.** Done in #956 (`37afc4b`). What is still open: a `cancelled()` open step has not yet been seen firing after a real job timeout (the runner source and run 32233689560 say it will), and P1-14/P1-15 below.

### P0-3 · #911 — a site with no CMS reports CMS Checked as `n/a`, so LAHI's 10-05 report can send 🟡

- **Why.** LAHI's `cms_reachable` is NULL [M] and its Maintenance report is due
  **2026-10-05** [M]. `functionHealthResultFromAudit` flattens
  `prismic:"skipped"` to null (`src/audits/function-health-fields.ts:31-32`), so
  `cmsEvidence` says `unknown`, and the gate blocks.
- **Corrections to the issue body [M].** Returning `null`, as proposed, would
  still block: the gate passes only `pass`/`n/a`
  (`src/reports/checklist.ts:88-106`, `src/reports/preflight.ts:401-420`). The
  fix must yield `n/a`, as `formsEvidence` (`auto-tick.ts:~345`) and
  `updatesEvidence` (`:~372`) already do. "Tick the box by hand" does not work
  either, because the gate reads evidence, never ticks. The manual escape is the
  logged send-anyway override.
- **Deadline.** It must be on `main` before the **10-04** fleet-lighthouse run
  re-stamps LAHI. 1836dig (due 10-31) is likely the same case [I].
- **Status.** Done in #957 (`e563f6e`), before the 10-04 deadline. Still the operator's: if a LAHI draft for this cycle already exists, press "refresh preview" before approving (its stored evidence predates the fix), and see the ✓-copy item under Operator decisions.

### P0-4 · Reports due in the next 14 days — operator actions 🔴

These come from `nextDueDate` and `approveBlockers` run on live rows [M]:

| Due   | Site                                          | Report                                         | State                                                                                                                                 |
| ----- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| now   | 29 Navy                                       | Maintenance 2026-09                            | Draft ready, 0 blockers, pending since ~09-18. Set `Report recipients (To)` first (null; the send falls back to MatthewB@worthe.com). |
| 09-30 | Sonder                                        | Testing (the fleet's **first** Testing report) | Blocked today: Titles & Meta fails, Form Functionality never measured                                                                 |
| 10-01 | Sonder                                        | Maintenance                                    | Needs fresh evidence (P0-1)                                                                                                           |
| 10-05 | Data Dynamiq, Espada, Revogen, Vineyard, LAHI | Maintenance                                    | LAHI blocked by #911 (P0-3). Revogen will draw no analytics: `ga4_property_id` NULL (#921).                                           |

Also from the continuity runbook: MSOT's and Revogen's recipients both resolve
to `accounting@revogenbiologics.com`. Fix those cells before approving either.

---

## P1 — next, agent-ready, no operator decision needed

| #     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tier | Effort | Start here                                                                                           | Done when                                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1-3  | **#912**: PR 1 (#986) stores the verdict nightly (`roster-urls` → `site_health.url_resolves`/`url_status`/`url_checked_at`); remains: the surface (PR 2; #975 merged, so it can start). #889 (blank repo / Netlify ID) is done in #962                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🟡   | M      | see "P1-3 start here" below this table                                                               | PR 2: a `fail` row reaches the digest, a stale `url_checked_at` is caught, an accept key mutes only `fail` |
| P1-7  | **#910**: store the a11y route counts, not only the violation count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🟢   | S–M    | `src/audits/a11y-fields.ts`, `src/db/migrations.ts`, `field-map.ts`, `site-row.ts`, `fleet-state.ts` | A 1-of-2-routes run reads differently from a 2-of-2 run, round-tripped through Turso                       |
| P1-12 | `scripts/` drift: schedule `sync-configs --dry` as a weekly drift report (no workflow runs it [M])                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 🟢   | S–M    | `.github/workflows/`                                                                                 | A weekly run posts drift to a tracking issue, with a positive control                                      |
| P1-22 | Read `RULESET_BYPASS` from the first scheduled fleet-security run after #985, and settle P1-17's measurement fork. `unread` > 0 means the reddoor-renovate App token gets no `bypass_actors`, so the default-branch floor (`src/github/rulesets.ts:148`) has been reading "no bypass actors" every night: write an Operator decisions line with the run URL and both numbers, asking which credential lets `protection-audit` see bypass lists — (a) Administration read/write on reddoor-renovate, (b) a dedicated audit-only App or token, (c) accept "unverified" fleet-wide (all 🔴). `unread=0` closes the fork. Do NOT dispatch `fleet-security.yml` to get the number (P0-1) | 🟢   | S      | the `RULESET_BYPASS unread=N read=M` line in the protection-audit step of the scheduled run          | An Operator decisions line with the run URL and numbers, or a Done line saying `unread=0`                  |

### P1-3 start here (#912)

Tier corrected to 🟡 on 2026-09-29: PR 1 added three migrations, a CLI command
and a nightly Turso write, which `AUTONOMY.md` puts behind the 3-lens review.

**PR 1 (#986) is the store.** `reddoor-maint roster-urls --fleet --write-back`
GETs every non-archived roster `url` (every status, including `building`,
`external` and `hosted-only`) and writes `url_resolves` (`pass` = final 2xx,
`fail`, NULL for a blank url), `url_status` (the code, `404
netlify-site-not-found`, `error: <code>`, `not an http(s) url`, `no url`) and
`url_checked_at` (every outcome) through migrations 0030–0032. Two run-level
controls (`no-such-site-zz9q.netlify.app` must read site-not-found,
`the-tower-burbank-rd.netlify.app` must pass) gate every write. The nightly
`fleet-lighthouse` runs it after the GitHub-signals sweep.

It is a standalone command, not the `--only` audit this section used to
suggest: every `audit --fleet turso` visits `selectFleetSites`, which is
`maintained` rows only, so an audit would never see a `building` row like
the-pointe-burbank; and a new audit name edits `src/types.ts` and
`src/audits/index.ts`, which #918 owns.

**PR 2, the surface** (needs `src/alerts/digest-collectors.ts`; #975, which
owned it, merged 2026-09-29, so PR 2 can start):

1. A digest collector over every non-archived row with `url_resolves = 'fail'`.
   Building sites get no cockpit card (`isDashboardVisible`), so the digest is
   where they surface.
2. A freshness gate on `url_checked_at`: a control that misreads writes nothing
   and the step is `continue-on-error`, so a stale stamp is the only trace.
3. An `Accepted Watch Conditions` key (e.g. `url not deployed`) that mutes only
   `fail`, so the check stays two-sided.
4. Optionally, a cockpit watch candidate in `assignTier` for `maintained` rows.

### Blocked behind another PR (do not start early)

- **#905, #949** (a11y spec: missing-browser message, `addStyleTag` under strict
  CSP): **unblocked**. #950 (another session) merged 2026-09-29 12:39Z and
  rewrote the spec both edit, so start from `main` after it, not from either
  issue's line numbers. Claim on the issue first; the session that filed #949
  may pick it up.
- **#947 (recipe half)**: `src/recipes/smoke-suite/template.ts:32` scaffolds
  `hydrationMarker: "footer"`, which cannot prove hydration. It is agent-ready,
  but pairs with #948's hydration-signal decision.
- **#921 persistence**: do it the #910 way once #918 merges.

### Watching (owned elsewhere, or parked)

- **#960, the part #972 did not take**: counting a zombie as dead via `ps` in
  the `spawn.test` reap test. Parked, not owned: needed only if a reaper ever
  holds zombies past ~4 s (the test then fails its assertion cleanly). The flake
  itself is fixed; see _Done_.

---

## Operator decisions (🔴 or product calls — agents prepare, never do)

Ordered by what unblocks the most. Each line is the exact ask.

1. **LAHI 10-05** — #957 is merged (a no-CMS site reads CMS Checked as `n/a`).
   Before approving, press "refresh preview" if a draft for this cycle already
   exists, since its stored evidence predates the fix. If you disagree with the
   semantics (e.g. a maintained site on the placeholder Prismic sentinel), say so
   and it gets revisited; the logged send-anyway override still works either way.
2. **29 Navy** — set `Report recipients (To)`, press "refresh preview" on
   `/s/29-navy`, then approve.
3. **MSOT / Revogen recipients** — fix the cells before approving either report.
4. **Revogen GA4** — look up the numeric property ID in GA and set
   `ga4_property_id` (site editor), so its 10-05 report carries analytics (#921).
5. **Release PR #952** — merged by the operator 2026-09-29 16:45Z; 0.101.0 on npm 17:01Z.
6. **Operating-model review — answered 2026-09-29** (`docs/operating-model-review-2026-09-29.md` §7):
   (a) zero-blocker Maintenance reports **keep the click**; revisit only after
   several consecutive [TEST] sends with nothing wrong (every test send so far
   has found something); (b) PM-pass model: recommendation is Opus, waiting on
   the operator's go-ahead to pin it; (c) evening-review is retired (the PM pass
   replaces it); `new-site` and `markup-review` go to cloud sessions as account
   skills; (d) the three cloud secrets: walkthrough given, the operator adds
   them; (e) **any reaction from the operator on a Discord message closes it**.
7. **Webflow, hard date 2026-10-19** [M, Discord #website-maintenance 09-17]:
   two sites still to convert before the license renews; Domaru must stay up
   to 11-01 on Tim's word while Reddoor's Webflow cancels 10-19.

8. **Airtable residue** — PR #954 (another session, at your request, opened
   2026-09-29 05:52Z) removes the `settings.json` pre-approval and network allow
   and AUTONOMY.md's Airtable tiers, and keeps `AIRTABLE_PAT` by your choice.
   Not in #954: AUTONOMY.md still calls `settings.json` "local, gitignored"
   (false since #788), and its working loop names `docs/autonomy-journal.md`,
   which has had no row since 2026-09-09.
9. **Changesets v3** — done: #901 (merged by the operator 17:07Z) carries
   both halves, and its first release run was a clean no-op. The version-only
   path is proven by the first changeset that lands after it. #897 closes itself
   on Renovate's next run.
10. **#918 / #920** — in a fix round after a four-lens independent review
    (2026-09-29): nine majors, the sixth round with majors. They ship in 0.102.0
    if that round is clean. If it is not, they come back here as a design
    decision rather than a seventh round.
11. **#916** — decided 2026-09-29: #950 shipped in 0.101.0, and #916 is merged
    over it for 0.102.0, with the `reddoor-starter` palette fix staged beside
    it. The same fix for `reddoor-starter-blux`, whose Hero also goes red, is
    to follow. Moved to _Done_.
12. **Cloud environment** — add `GA_SUBJECT`, `GA_SA_KEY_B64` and
    `PERPLEXITY_API_KEY`. Without them, cloud-drafted reports silently lack
    analytics [M].
13. **Google Maps keys (#754)** — add referrer and API restrictions to the three
    keys in GCP, then close the four alerts.
14. **Promotion authority (#623 → #545)** — pick identity A/B/C, apply the
    prepared staging ruleset, and promote reddoor-website `staging` → `main`.
15. **Renovate delivery (#898)** — pick among `prCreation: "immediate"`, a
    priority on the grouped rule, wider or staggered windows, and a separate App
    identity for `release.yml`. `renovate/pnpm-12.x` is rate-limited on #490 now.
16. **#779** — go-ahead for the form-e2e central widening. Seven maintained
    sites have no form end-to-end check [M].
17. **Client email copy (#957 follow-up).** The Maintenance email draws a green
    ✓ beside every checklist row whatever the evidence says
    (`maintenance-email/template.ts` → `email-sections.ts`). With #957, LAHI's
    email will say "CMS Checked ✓" for a site with no CMS, as Form Functionality
    already does for sites without a form. Decide whether `n/a` rows render
    differently or drop out.
18. **Standing product calls** — #943 (what "Search Console set up" means),
    #948 (hydration signal), #690 (pnpm pin questions), #672 (cockpit design),
    #674 (design-review tool), #711 (close into CLAUDE.md or scope one lint),
    #728 (beachfront `matching/`), #776 (confirm closed), and on the laptop,
    #773 (local-only git objects).
19. **P1-20, the digest (#975)** — answered 2026-09-29: "go" on the round-2
    rule, then, after two sessions built it in parallel (`f6d5ee8c` on #975,
    `7925133d` on `claude/digest-send-exact-rule`), "do yours": #975 lands
    `784c2bda`. It forgets a warning after two absent runs and a critical item
    at once, raises a baseline only on a send, needs a Lighthouse score to be
    more than 5 points worse than what was last mailed, and compares health
    asks by field.
20. **P1-3 post-merge production run (#986, `e86abd72`)**: this cloud
    session's permission classifier refused the one sanctioned production run
    of `roster-urls --fleet --write-back` from `origin/main` ("Production
    Deploy"). The ask: either let tonight's `fleet-lighthouse` nightly do the
    write (its new "Probe roster urls to Turso" step is the same command), or
    run `node dist/cli/bin.js roster-urls --fleet --write-back` once yourself
    from a build of `main`. Then check with a SELECT: `the-pointe-burbank` should be
    `fail` / `404 netlify-site-not-found`, the tower and vida `-rd` rows `pass`,
    `summittrek` and `young-life-connect-compliance-site` NULL / `no url`, and
    `url_checked_at` set on the 34 non-archived rows and on no archived row. My
    pick is the nightly, since it is the same code with no new permission.
    **Answered 2026-09-29 ~20:50Z: tonight's nightly.**
21. **the-pointe-burbank url**: set its url to
    `https://the-pointe-burbank-rd.netlify.app` on `/s/the-pointe-burbank`.
    The probe named it on 2026-09-29 (`404 netlify-site-not-found`, and the
    `-rd` host 200) in #986's pre-merge run. Wait until item 20's run has
    stored the `fail`, since that row is the live positive case.
22. **P1-17, bypass actors on a Renovate base branch (#981, PR #985)** — two
    review rounds each found a real defect, so #985 is held for your call, not a
    third round. Both defects were missing TESTS, and both are now fixed on the
    branch; no verdict bug was found. Round 1 (on `1c5810eb`): nothing pinned
    that a failed ruleset read is left out of `RULESET_BYPASS`, or that acked
    rows carry their count. Fixed in `e20b7041`, which also makes a probe-failed
    row wait for its sibling reads. Round 2 (on `e20b7041`): nothing pinned that
    a bypass-free ruleset wins over an unknown one. Fixed in `280ef2e2`. Every mutation that changes behaviour, from the brief and both rounds, now turns a test red; the two that survive (`isSafeInteger` → `!isNaN`, a Set of ids → an array) are equivalent on real GitHub data. The full suite, lint, typecheck and build pass at `e20b7041`. The only merge
    conflict with `main` is `docs/BACKLOG.md`. The ask: land #985 as it is
    (my pick, because the code has not changed since round 1 except the
    allSettled count fix, which round 2 cleared), or run a third review round
    first. Landing it is `git merge origin/main` (keep both sides of BACKLOG),
    CI green, then `node scripts/land-prs.mjs 985`.
    **Answered 2026-09-29 ~20:50Z: land as is.** Landed by the PM session.
23. **0.102.0 release gate: these palette PRs to merge first** — measured
    2026-09-29 with #916's build on all 15 maintained sites plus
    `reddoor-starter-blux` (table: `docs/palette-rollout-2026-09-29.md`).
    The palette PRs are done: [29-navy#58](https://github.com/reddoorla/29-navy/pull/58)
    and [reddoor-starter-blux#36](https://github.com/reddoorla/reddoor-starter-blux/pull/36)
    (13 lines in `@theme`, render byte-identical, gate green on #916), merged
    by the PM session at ~20:50Z on the operator's go, after green CI. The
    `reddoor-starter` fix merged as reddoor-starter#162. 13 sites already pass on #916. **Vida
    stays red after the palette** and needs your call. axe throws on
    `mix-blend-plus-lighter` on `/` and `/es`: do we exempt it in the gate, or
    change the design? Measured, its fixtures' `text-red-600` form errors fail
    contrast. No vida PR is open. My pick: ship 0.102.0 and let vida's Renovate
    PR sit red until that is decided, since nothing reaches vida's `main`
    unreviewed.
    **Answered 2026-09-29 ~20:50Z: ship 0.102.0; vida's call (exempt the
    blend-mode crash, or change the design) stays open.**

24. **P1-12, weekly config-drift report (#983, PR #995)**: two review rounds
    each found real defects, so #995 is held for your call instead of going to a
    third round. The one code defect was that `--only` without gitignore
    skipped the fleet-mode git guard, fixed in `a304bc72`. Everything else was
    a missing test: round 1 six (exact-title and exact-repo matching, control
    guards, one record per line), round 2 five (drift paths checked only
    against the dry plan itself, the open step's `drifted == 'yes'` gate,
    three control checks, the tracked leg, the skip warning), plus the
    runbook rows. All are fixed on the branch at `4b195009`. 37 mutation runs (the
    brief's 8 as 11 runs, plus 26 from me and both rounds) all turn a test red. Round 2's
    correctness lens found nothing. One design point is kept as the brief set
    it: the finding issue closes only when every repo named in its body comes
    back CLEAN, so a repo that leaves the roster keeps it open until closed by
    hand, and the close step says so in a `::warning::`. The ask: land #995 as
    it is (my pick, since the round-2 changes are tests, docs and one stricter
    control check), or run a third round first. Landing it is
    `git merge origin/main` (keep both sides of BACKLOG), CI green,
    `node scripts/land-prs.mjs 995`, then dispatch `fleet-config-drift.yml` once
    on `main` (the brief's live proof: control passes, summary total = roster
    size, issue filed to match).
25. **#969, a timed-out spawn orphans Playwright's webServer (PR #989)** —
    answered 2026-09-29: land as it is, no third round; #989 lands with this line. Two
    review rounds each found a real defect, so #989 is held for your call, not a
    third round. Round 1 (on `ce4cb9db`) found a behaviour defect: the walk
    trusted `child.pid` after an early-exiting wrapper could have been reaped,
    so a reused pid could be walked. It also found the per-group SIGKILL
    re-check tested with one group only. Both are fixed in `81aa0afc`. Round 2
    (on `3434e9cb`) found no behaviour defect, and the full suite passed (7648
    tests). Its one confirmed gap was a missing TEST: nothing pinned
    `killOther`'s ESRCH guard, or the `signalCode` half of the exited-wrapper
    guard. Both are pinned in `6fce94e2`, and each goes red on its mutation.
    All 18 mutations from the brief and both rounds turn a test red; the
    visited-set one does so by hanging the run. The Verify probe went from
    `Sl; accepting=true` to `gone; accepting=false`. Head `8b2ab564` is
    merged with `main` as of 20:40Z. The ask: land #989 as it is (my pick:
    `spawn.ts` has not changed since round 2 cleared the round-1 fixes; only
    tests were added), or run a third review round first. Landing it is
    `git merge origin/main` (keep both sides of BACKLOG and the journal), CI
    green, then `node scripts/land-prs.mjs 989`.

---

## Clean-send streak ([TEST] report sends, operator's verdict)

The operator keeps the click on zero-blocker Maintenance reports until they have
seen several [TEST] sends in a row with nothing wrong (review §7.1). Every test
send before 2026-09-29 had a problem. This table is the record; the operator's
verdict is its only input, because no client and no check sees the email.

- **Adding a row.** Any session that sends a [TEST] report email to the
  operator adds a row in the same PR or session, with the verdict
  `awaiting`. No code on `main` produces a "[TEST]" subject today: the
  2026-09-28 one rendered the real 09-17 draft ("Completed on 09.17.2026"),
  so it came from a session's ad-hoc render [I]; `selftest email <site>
--type maintenance` builds from the roster with today's date and has no
  prefix.
- **The verdict** is `clean`, or one line saying what was wrong. The operator
  writes it into the row (the GitHub web editor works from a phone) or says it
  to any session, which writes it.
- **The streak** is the number of `clean` rows counted up from the bottom,
  stopping at the first row that is not `clean`. An `awaiting` row stops it
  too, and becomes an ask in the morning report.

| Sent (UTC)       | Site    | Report                 | Verdict |
| ---------------- | ------- | ---------------------- | ------- |
| 2026-09-28 22:54 | 29 Navy | Maintenance, Sept 2026 | clean   |

## Fleet snapshot (2026-09-29 05:36Z, live Turso, SELECT-only) [M]

- 46 site rows: 14 maintained, 2 launching, 7 building, 9 external, 2
  hosted-only, 12 archived.
- Cockpit: 1 attention, 13 watch, **0 healthy**, 2 pre-launch.
  - Attention: Reddoor (destructive Prismic drift, acknowledgement expired
    08-30).
  - Watch: every other maintained site has "Search Console property not
    recorded" (#939, a day old). For 8 of them it is the only reason. Five also
    lack GA4: 1836dig, 29 Navy, Data Dynamiq, LAHI and Revogen.
- No vulnerabilities, no Lighthouse scores below the floor, no CI red on sites,
  no delivery failures, 0 dead letters.
- Staleness: the newest smoke and form-e2e results are from 09-26 (63 h). The
  newest Lighthouse, security and function-health results are from 09-27. There
  was no sweep at all on 09-28. a11y has data for 1 of 16 sites.
- Forms: 554 submissions (43 in the last 7 days).
  - **327 unread**. The cockpit caps its list at 200, so it shows 200. Sonder
    alone has 245 unread, back to 06-15.
  - 3 notification bounces not acknowledged (Espada ×2, ERP ×1).
- `digest_state.cockpit_rollup` is dated 2026-09-17 09:00Z. That is a test's
  fixed clock, written by a cloud test run before #933 stripped credentials from
  the suite. The next completed digest rewrites it.
- Certificates as of 09-27: Sonder 30 days, 1836dig 32, Espada 38, Beachfront
  39, ERP 40. These should auto-renew [I]; re-check after the next sweep.
- Oddities: `links_ok=0` alongside `broken_links=0` on four sites; Sonder
  `titles_meta_ok=fail`; `reddoorla/composition-hospitality` is active but the
  roster lists it as external with no repo.

## Done (move items here when they land)

- 2026-09-29 — #969: a timed-out spawn reaps the process groups its
  descendants detached into (Playwright's webServer, Chrome under
  chrome-launcher), found from a `ps -A -o pid=,ppid=,pgid=` snapshot taken
  before the first SIGTERM (#989). The Verify probe went from
  `Sl; accepting=true` 7 s after the timeout to `gone; accepting=false`.

- 2026-09-29 — P1-17 / #981: `protection-audit` joins each
  `required_status_checks` rule on a non-default Renovate base branch to its
  ruleset's `bypass_actors`; a branch every one of whose gating rulesets can be
  bypassed is a gap, and a ruleset read without the field is unverified (#985).
  The new `RULESET_BYPASS` line's first live number is P1-22.

- 2026-09-29 — P1-16 / #980: a prospect audit that throws after a paid stage
  (or in its render) marks its row `failed`, re-stamped to the failure, which
  counts toward the cap for the full 24 h; a pre-spend throw still releases
  (#992). Readers take the no-report statuses from one deny-list,
  `NO_REPORT_STATUSES`. Measured before: 0 at failure +3 h; after: 1 at +3 h
  and +23 h 59 m, 0 at +24 h 01 m.

- 2026-09-29 — Operator decision 11 / #888: #916 lands over #950. main was merged
  in, not rebased, because a text-only resolution put the detection after the
  axe loop's `finally`. Every unit test and tsc passed on that, and every real
  audit died on `results is not defined`. #916's findings go through #950's
  cross-origin frame split. The "9 of 12 sampled sites red" figure came from a
  static grep for `none`-hued tokens. Nobody measured it against the gate. Both
  of axe's shapes occur. The whole-rule throw (`rule-errored`) that the issue
  reported, and that the correction posted on it called impossible, is what the
  starter's `Hero` produces: a white CTA over `bg-neutral-900`. It ships in
  0.102.0, together with the reddoor-starter `@theme` fix that keeps the
  starter's own gate green. reddoor-starter-blux has the same Hero and needs
  the same 13-token block (measured: FAIL on the #916 build, then PASS with
  66 contrast nodes). That fix is to follow.

- 2026-09-29 — P1-19 / #982: a report whose site matched no Search Console
  property stores `search_found_page1` NULL, not 0, on the draft create path and
  the announce create and reuse paths (#990). A property-found miss still
  stores 0; soft-fail keeps the last value. No reader renders the two differently.
- 2026-09-29 — P1-20: the digest sends only when an item or ask part the
  record does not hold appears, a metric beats its high-water baseline (a
  Lighthouse score by more than 5 points), or weekly; what is gone two runs is
  forgotten so a recurrence re-sends. Repeated items carry their age and a
  blocked draft carries the exact ask with its `/s/<slug>` path (#975).

- 2026-09-29 — #960's flake: the `spawn.test` grandchild-reap test polls to a
  4 s deadline (under `defaultSpawn`'s 5 s SIGKILL grace), probes after its
  final wait, counts only ESRCH as reaped, and its cleanup kill ignores `ESRCH`
  (#972). The test only; `spawn.ts` is unchanged. #960 stays open for its first
  suggestion, counting a zombie as dead via `ps` (see _Watching_).
- 2026-09-29 — P1-18: #967 proven live. fleet-security run 36564241156
  rewrote #754's body to name that run, including the new
  `reddoor-website:staging` gap from #966, which also proves #966 live.
- 2026-09-29 — P1-2 / #942 (#959), P1-4 / #941 (#961), P1-11 tracking-issue
  bodies rewritten on every failure (#967), P1-13 `land-prs` retries transient
  reads (#963), P1-14 / P1-15 (#964).

- 2026-09-29 — P1-8 / #907: the prospect-audit daily cap reserves a `running`
  row before the spend, atomically, and counts finished plus non-stale running
  rows (#968). The row cited `src/db/prospect-audits.ts:27`, the
  old two-state union. That union is now `FinishedProspectAuditStatus` at `:28`,
  and `ProspectAuditStatus` (with `running`) is at `:36`.

- 2026-09-29 — P1-6 / #892: `protection-audit` judges every branch Renovate
  merges into, not only the default branch (#966).
  reddoor-website's `staging` is expected to show as the one new gap;
  applying its ruleset stays 🔴.

- 2026-09-29 — P1-10: forward pointers to #874 on the three meta-week docs that
  recommended deleting `FIGMA_PAT` (the docs half; the credential half stays
  with the operator).

- 2026-09-29 — P1-3's #889 half: a maintained site with a blank Git repo or
  Netlify ID is a cockpit watch item, acceptable as `no git repo` /
  `no netlify id` (#962). #912 stays in P1-3.

- 2026-09-29 — `land-prs.mjs` is REST-only and proven from the cloud: it landed
  itself (#953), then #902 and #896 through update-branch (adopted from the
  orphaned `claude/happy-cerf-xb0xif`; review found and fixed a
  neutral-checks gate hole and a CLOSED-reported-as-merged path).
- 2026-09-29 — Renovate majors #902 (`@types/mjml` v5) and #896
  (upload-artifact v7; proven by backup artifact `turso-backup-36530796403`).
- 2026-09-29 — P0-2 alarms (#956) and P0-3 / #911 (#957).
- 2026-09-29 — P1-14: `js-yaml` is a devDependency and all 14 workflows are
  parsed, with `workflowSteps` cross-checked against the parse (#964).
- 2026-09-29 — P1-15: release-health files "Daily release-health check failing"
  when the checker itself fails or hangs, and time-travel files "Time-travel run
  failing outside the suite" for a red run whose suite step did not fail
  (#964).

- 2026-09-29 — P1-21: AUTONOMY.md's settings and journal lines fixed by #971
  (another session).
- 2026-09-29 — P0-1: all seven nightlies green on post-Airtable `main`.
- 2026-09-29 — #895 time-travel red since 09-21: shallow checkout, not a clock
  (#951, `33c01b3`).
- 2026-09-29 — Closed as resolved, with evidence comments: #717 (every exposed
  host re-probed 404 or unpublished, with controls), #698 (the namespace went
  with #937/#940), #863 (fixed by #875).
- Meta-week S1–S7 all shipped by 09-14, including the sharp security wave
  (S1/A7). Airtable Phase 6 finished (#937, #940, #945). #646, #539 and #891
  are closed.
