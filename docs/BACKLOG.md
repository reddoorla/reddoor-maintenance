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

| Due   | Site                                          | Report                                         | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09-30 | Sonder                                        | Testing (the fleet's **first** Testing report) | **Not approvable on 09-30 without an override (operator decision 30).** 2 blockers [M, 2026-09-29 23:53Z, `approveBlockers` on live rows]. (1) Titles & Meta: the one problem is `/artists` title 90 chars (max 70), from Prismic `page` `artists` (`ZjwQtxIAANaT82IQ`) `meta_title`; a content edit, not code or the audit. Clears after the Prismic edit, a site rebuild, the next fleet-lighthouse run, and refresh preview. (2) Form Functionality: never measured; form-e2e self-skips Sonder (no `forms.testMode` in `/health`) and no safe probe exists before a Sonder deploy (#779 item 26). |
| now   | 29 Navy                                       | Maintenance 2026-09                            | Draft ready, 0 blockers, pending since ~09-18. Recipients are correct as they are (settled, see below); press refresh preview, then approve.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 10-01 | Sonder                                        | Maintenance                                    | Needs fresh evidence (P0-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10-05 | Data Dynamiq, Espada, Revogen, Vineyard, LAHI | Maintenance                                    | LAHI blocked by #911 (P0-3). Revogen will draw no analytics: `ga4_property_id` NULL (#921).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Settled — do not flag again (operator, 2026-09-29, after being asked
several times):** the report recipients are correct as they are. MSOT and
Revogen both resolving to `accounting@revogenbiologics.com` is intended, and
29 Navy's send going to MatthewB@worthe.com is intended.

---

## P1 — next, agent-ready, no operator decision needed

| #     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Tier | Effort | Start here                                                                                  | Done when                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1-22 | Read `RULESET_BYPASS` from the first scheduled fleet-security run after #985, and settle P1-17's measurement fork. `unread` > 0 means the reddoor-renovate App token gets no `bypass_actors`, so the default-branch floor (`src/github/rulesets.ts:148`) has been reading "no bypass actors" every night: write an Operator decisions line with the run URL and both numbers, asking which credential lets `protection-audit` see bypass lists — (a) Administration read/write on reddoor-renovate, (b) a dedicated audit-only App or token, (c) accept "unverified" fleet-wide (all 🔴). `unread=0` closes the fork. Do NOT dispatch `fleet-security.yml` to get the number (P0-1) | 🟢   | S      | the `RULESET_BYPASS unread=N read=M` line in the protection-audit step of the scheduled run | An Operator decisions line with the run URL and numbers, or a Done line saying `unread=0` |

### Blocked behind another PR (do not start early)

- **#947 (recipe half) + #948's residual race: unblocked 2026-09-30** (item 35
  answered "(b) now, (a) after"). `src/recipes/smoke-suite/template.ts:32`
  scaffolds `hydrationMarker: "footer"`, which cannot prove hydration. Do it
  together with the a11y spec waiting for a bundle-only marker
  (`html[data-hydrated]`, set in the root layout's onMount as roalson #57 does)
  before the reveal pass. Measured on roalson: preview alone 208 in 12 of 14
  cold runs (217 twice, mid-hydration); preview + that wait 208 in 10 of 10.
  Starter first, then the recipe, then the fleet. Blocked only on the 25 site
  PRs for #948's guard flag landing first (see Done, #948).
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
2. **29 Navy** — press "refresh preview" on `/s/29-navy`, then approve. Its
   recipients are correct (settled 2026-09-29).
3. **MSOT / Revogen recipients** — settled 2026-09-29: the shared
   `accounting@revogenbiologics.com` is correct. Not an ask; never re-raise it.
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
   **Answered 2026-09-30:** the conversions are Williamson Homes and
   Williamson Construction, on native Prismic; Domaru lapses on 10-19 (the
   client no longer wants it; no bridge); D5 yes. Phase 0 is running. Still
   the operator's by 10-05, via Tim: D0 Webflow billing, D6 the Construction
   form recipient, D7 the GoDaddy holder, D8 the Adobe Fonts kit owner. **Scoped
   2026-09-29: see the plan, [`docs/webflow-conversions-2026-10.md`](webflow-conversions-2026-10.md).**
   Three live sites still serve from Webflow [M]: Williamson Homes (10 pages),
   Williamson Construction (14) and Domaru (7). The plan's pick is that the
   Williamsons are the two conversions (native, Prismic) and Domaru gets a static
   bridge on Netlify to 11-01. Cutover: Williamsons Wed 10-14, Domaru Thu 10-15,
   with Webflow still serving to 10-19 as the rollback. **First ask (D1):**
   confirm the two are the Williamsons, and say what Domaru needs: (a) a bridge,
   then down on 11-01; (b) a transfer to the client's own Webflow workspace (your
   login); or (c) a full conversion. **D0:** check Webflow billing for what
   actually stops on 10-19; the roster's `"account owner"` dates (`dec 8`,
   `jan 11`) may be site-plan renewals. D2–D8 (content, track, redirects,
   fidelity, form recipients, DNS holders, Adobe Fonts) are due 10-05. Phase 0
   (repos plus full capture of all three references) needs no decision and should
   start 09-30; its brief is in the plan, §7.
   **OD7-P0 (#1029), half done:** all three references are captured whole (10 /
   14 / 7 pages, 0 failed downloads), but neither Williamson repo exists,
   because the org refused this session's create (403). What is needed to
   finish is in items 33 and 34.

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
15. **Renovate delivery (#898)** — decided 2026-09-29: `prCreation:
"immediate"` on the grouped rule. The measurement agrees with #898: here,
    `renovate/all-minor-patch` was pushed at 02:07Z on 09-28 and the next run
    started at 18:48Z, after the window, so no PR opened that week. The preset
    change is written, validated and stored as
    `docs/patches/2026-09-29-github-renovate-grouped-pr-immediate.patch`, but
    **no `.github` PR exists**: a cloud session cannot attach `reddoorla/.github`
    (its name starts with a dot), so the push was refused. **Ask:** open it from
    the laptop (`git am` the patch in a `.github` checkout, then open the PR for
    your review). It does nothing for `renovate/pnpm-12.x`, a major held by
    Renovate's own PR/branch limits; a `prPriority` or a higher `prHourlyLimit`
    is still the lever for that.
16. **#779** — go-ahead for the form-e2e central widening. Seven maintained
    sites have no form end-to-end check [M].
    **Answered 2026-09-29 ("go"); built in PR #1017, which landed
    2026-09-30 03:32:33Z as `d1e42c4a` after a third review round (item 32).**
    The probe now fills required fields outside its standard four: the first
    real option of a select, and synthetic values for text, checkbox and radio.
    The nightly names its uncovered sites, and a localhost positive control runs
    before the sweep. The widening covers no new site by itself, because every
    site it helps still needs a client deploy to declare `forms.testMode`. See
    item 31.
17. **Client email copy (#957 follow-up).** The Maintenance email draws a green
    ✓ beside every checklist row whatever the evidence says
    (`maintenance-email/template.ts` → `email-sections.ts`). With #957, LAHI's
    email will say "CMS Checked ✓" for a site with no CMS, as Form Functionality
    already does for sites without a form. Decide whether `n/a` rows render
    differently or drop out. **Answered 2026-09-29: they drop out**, neither ✓
    nor "N/A". Done in #1015, on every render path (send, refresh preview,
    stored draft body, `report --preview`, `selftest email`). A draft stored
    before that release keeps its old body until "refresh preview". The next
    [TEST] send is the change's first real check. The Announcement email's
    checklist is unchanged, since it is not evidence and not named here.
18. **Standing product calls** — answered 2026-09-29, except #773:
    - #943 (what "Search Console set up" means): evidence-based. Done in
      #1016, with the freshness window answered in item 28.
    - #948 (hydration signal): audit the built preview (`vite preview`), not
      the dev server; queued until the a11y PRs in flight land.
    - #728 (beachfront `matching/`): delete; done in beachfront#69 (`e3547dfe`),
      101 self- or dead-host comparers removed, #728 closed.
    - #776: closed as done.
    - #711: closed into `CLAUDE.md` ("Prove the instrument", the paragraph on
      a derived view read as the state).
    - #690 (pnpm pin questions): Renovate owns the pin. Verified 2026-09-29
      across all 27 public, non-archived `reddoorla` repos: 21 are on
      `pnpm@12.5.1` via merged Renovate PRs (reddoor-starter#157 and 20
      more, 2026-09-22), and the 5 still on `pnpm@11.11.0` (29-navy,
      erp-industrial, reddoor-maintenance, reddoor-md-pdf, roalson-interests)
      each list "update pnpm to v12" under Awaiting Schedule on their
      Dependency Dashboard; `.github` has no `package.json`. Closed with the
      table.
    - #672 (cockpit design): design brief first. Brief written, awaiting the
      operator's markup:
      [`docs/cockpit-design-brief-2026-09.md`](cockpit-design-brief-2026-09.md).
    - #674 (design-review tool): mine the rules only. Rules mined in
      `docs/design-review-rules-2026-09.md` (#1012). Answered 2026-09-29:
      rule 23 became a flag, six single-site rules and five seen-once rules
      kept, and the full-bleed opt-in is `data-bleed`. The second pass (Discord,
      Figma, MarkUp) waits on credentials, Figma team or project IDs, and a
      private home for the corpus; the file's last section lists them.
    - Still open, on the laptop: #773 (local-only git objects).
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
    **Answered later on 2026-09-29: do both.** The design fix is open for
    review as [vida-legacy-foundation#86](https://github.com/reddoorla/vida-legacy-foundation/pull/86)
    (`text-red-700`, 5.93:1 on beige, CI green; not to be merged by an agent).
    The gate exemption is [#1014](https://github.com/reddoorla/reddoor-maintenance/pull/1014),
    held after two review rounds: see item 29. Vida's gate is green only
    with #1014, #86 **and** the 13 palette lines, which no PR carries yet.

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
    **Resolved 2026-09-29 ~21:45Z (PM brief: rerun round 2, land if clean):
    the rerun found no blocker or major; its four minor test gaps are pinned
    in #995, which lands.**
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
26. **P1-3 PR 2, the roster-url surface (#912, PR #1004)**: two review rounds
    each found a real defect, so #1004 is held for your call, not a third
    round. It adds a digest item `url-unresolved:<siteId>` for a fresh `fail` on
    any non-archived row (it names the url and status), one fleet item
    `url-probe-stale` (metric = count) for stale stamps, and `url not deployed`
    in Accepted Watch Conditions, which mutes only `fail`. Maintained rows also
    watch on the cockpit, with a filter chip. Round 1 (on `5471c319`) found that
    a never-stamped row read "not checked in 3 days", plus four missing tests
    (a null verdict on the cockpit, a future stamp, the alias, `now` wiring).
    All were fixed in `6400ea42`. Round 2 (on `6400ea42`) found one behaviour
    defect: a site added between the day's probe and the 09:23 digest (runs
    start late, so the probe can land after lunch PT) mailed "the probe is
    behind, check the step" about a step that is working. It also found four
    test gaps. Fixed in `490e6be2`. **The product fork, and my pick:** a
    never-stamped row now counts only while no row in the fleet is fresh. A
    probe that never ran or has stopped leaves no fresh row, so it is still
    caught. The cost is that one row the probe keeps failing to stamp while it
    stamps the rest is not caught. Round 2's correctness lens found no path that
    creates such a row (every insert creates its `site_health` row). The other
    choice is to alarm on it anyway and accept one false mail per new site.
    All 32 mutations (the brief's 12 plus both rounds' survivors) turn a test
    red. The full suite passes (8061), and lint and typecheck are clean. The
    ask: land #1004 as it is (my pick), or pick the other never-stamped rule,
    or run a third round first. Landing it is `git merge origin/main` (keep
    both sides of BACKLOG), CI green, `node scripts/land-prs.mjs 1004`. The
    first stamp comes from tonight's nightly (item 20). Item 21's url fix
    clears the-pointe-burbank's item.
    **Answered 2026-09-30: land as it is.** #1004 lands with this line.
27. **#905 + #949, the a11y spec under a strict CSP and without a browser (PR
    #1003)** — **Answered 2026-09-30: third round.** Round 3 found a
    behaviour defect, fixed in `7fa108a2`; **operator: land or not.** No
    fourth round. **Answered 2026-09-30 ~03:25Z: land at this head.** Landed
    by `land-prs.mjs` as `b8e18d04` (head `2660bec5`).
    - Round 3 (on `35866ca1`, 4 lenses, 3 skeptics each, 3/3 unrefuted):
      stderr kept its first 200 characters, but a web server prints its cause
      last. A preview build (`npm run build && npm run preview`) with two
      vite-plugin-svelte warnings on stderr lost the Rollup error that stopped
      it, and the summary named only the warnings. This is not a regression:
      `origin/main` cut stderr the same way. The status was always `fail`.
      stderr now keeps its last 200 characters, behind an ellipsis. Two test
      gaps were also fixed: nothing held the ANSI strip on stdout's error
      line, and only `TypeError` held the typed-error alternative. A fourth
      claim (a hard-coded exit code survives) was refuted 3/3 as identical on
      `main`. Mutations M18–M22 each turn a test red.
    - My pick is to land. The fix changes which end of stderr's detail is
      kept, and `freezeMotion` has had no finding in three rounds. #1018 is
      closed by `8fec6927`, which round 3 reviewed.
    - Two review rounds each found a real defect, so #1003 was held for your
      call, not a third round.
    - Round 1 (`a9565ac3`) found a major: stdout's generic "Process from
      config.webServer was not able to start" line displaced the web server's
      own cause on stderr ("Port 5173 is already in use"). It also found four
      test gaps. All are fixed in `8dc2405e`.
    - Round 2 found no defect in the #949 fix or the missing-browser line, and
      the full suite passed (7769 tests). Its one confirmed defect is minor: a
      stdout failure that does not start with `Error:` (a `TypeError`, a test
      timeout) gets no detail once stderr is only npm warnings. The rest were
      test gaps. All are filed as #1018; every such case still fails.
    - All 17 mutations turn a test red. Head `d9dc1ede` is merged with `main`,
      with CI green.
    - The ask: land #1003 as it is, with #1018 as the follow-up, or run a
      third round first. My pick is to land: the round-2 finding narrows a
      summary's detail, and `freezeMotion` has not changed since round 1.
    - Landing: `git merge origin/main` (keep both sides of BACKLOG and the
      journal), CI green, then `node scripts/land-prs.mjs 1003`. #905 and #949
      are already under Done in this PR.
28. **#943, the Search Console freshness window (PR #1016)**: how long does a
    resolved Search Console lookup count as evidence for the launch check?
    #943 says "N days" and leaves N open. My pick: the site's shorter report
    cadence plus 14 days, which is 45 days for monthly, 106 for quarterly and
    380 for yearly (and 45 when both cadences are None). The reason is that
    evidence only arrives when a report drafts, so any fixed N shorter than a
    site's cadence fails that site by construction. The monthly value matches
    `ANALYTICS_SOFT_FAIL_STALE_DAYS`. The alternative is one fixed N for every
    site. #1016 is green, merged with `main`, and one review round found no
    source defect; the three test gaps it found are fixed. A different answer
    changes one constant in `src/fleet/search-console-evidence.ts`. Landing
    it is `git merge origin/main` (#1005 also adds migrations, 0033/0034, so
    keep both sides of the migration id lists), CI green, then
    `node scripts/land-prs.mjs 1016`, then close #943.
    **Answered 2026-09-30: the cadence + 14 days (as picked).** #1016 lands with
    this line; #943 closes with it.
29. **#1014's round-3 fix, PR #1035 (vida, item 23): land or not.**
    **Answered 2026-09-30: land #1035.** Landed 02:10:48Z as `b4aa1948`,
    pinned to head `3969249e` by `land-prs`. Nothing left open here.
    #1014 itself landed at 01:05:07Z as `a00d50d4` (head `861fcff8`, merged
    by `tucksravin`, ten seconds into the round-3 session and before round 3
    ran). Round 3 then found a behaviour defect in what landed, which is now
    on `main` and rides release PR #988 until the fix lands.
    - **The design.** When axe files `blendFunctions[blendMode] is not a
function` on a top-level element, the spec re-runs that rule with the
      element excluded and its children included again, until the crash
      stops (25 runs at most). It counts each excluded element as not
      measured and warns. Every other crash, and every crash inside a frame,
      still fails.
    - **Round 1.** Major: axe's exclude dropped the crashed node's whole
      subtree, so a faint paragraph inside a crashed wrapper, 200px from the
      grain, went unmeasured and the page warned instead of failing. Minor:
      a third party's grain frame moved the site to warn. Also test gaps. All
      fixed in `1d2eefae`, with 10 mutations that each turn a test red.
    - **Round 2.** Major, reproduced live: a crash filed on a **shadow host**
      (slotted light text over the grain) excludes the whole shadow tree.
      Children are re-included from the light DOM only, so a 2.32:1 paragraph
      in the shadow root was dropped and the page warned. Minor test gaps:
      the wrapper fixture has one child, so `:nth-of-type` or "first child
      only" would pass, and the blend-mode name is only ever plus-lighter.
      Integration was clean: 7991 tests passed, no `__name` in `dist`.
    - **The ask:** authorise one narrow fix and land. The fix: a crash whose
      element has a `shadowRoot` is not excludable, so it fails as
      `rule-errored` as today. Add a live shadow-host fixture and a
      two-child wrapper. That fix only narrows the exemption, and vida has no
      shadow DOM (measured on the packed build: exit 0, `/` and `/es` 24
      contrast nodes each). The alternative is a third full review round.
    - **Landing it:** make the fix on `claude/a11y-blend-mode-unmeasured`,
      `git merge origin/main` (keep both sides of BACKLOG and the journal),
      CI green, then `node scripts/land-prs.mjs 1014`.
    - **Vida separately:** vida's gate also needs its 13 palette lines
      (`--color-neutral-*: oklch(… 0 0)` in `@theme`, as in 29-navy#58).
      With #1014 packed, #86 and those lines applied locally, its gate exits 0. Without the palette lines it fails `rule-errored on a11y fixtures`.
    - **Answered 2026-09-30: narrow fix + third round.** (Relayed ~01:05Z
      by the PM session. An earlier line here said "authorise the fix and
      land" and "#1014 landed", written at 00:47Z while #1014 was still
      open.) The narrow fix is `cf338c68`, and it landed in `a00d50d4`.
    - **Round 3 found a behaviour defect, fixed in #1035 (`3876642a`);
      operator: land #1035 or not.** A crash's selector is axe's shortest
      selector unique _at that moment_ (`h2`), and it was reused in every
      re-run. If the page changed between runs (hydration, a carousel),
      `exclude("h2")` dropped a second, faint heading too, and the page
      warned where the pre-#1014 gate failed `rule-errored`. Reproduced live
      (`/grain-late`: 0 violations). The fix (`sameBlendTargets`) keeps a
      handle to each crashed element. After every re-run it requires each
      selector to match exactly that one element; otherwise the rule is not
      re-run around, and its crash fails. Pinned by `/grain-late` (appended
      heading) and `/grain-swap` (replaced heading, which only a check after
      the re-run catches). Round 3 also confirmed a test gap: no fixture's
      _first_ crash was on a shadow host, so the outer loop's host check was
      unbound (`/grain-host-first` added). A wording nit on the `html` guard
      was fixed too, and the narrow fix's missing tests were added (a crash
      named `plus-darker`; a wrapper whose first child is excluded, so
      `:nth-of-type` goes red). Per your answer there is no fourth round.
      #1035's body has the findings, votes and mutations. #1035 only
      narrows the exemption. The alternative is to revert `a00d50d4`.
    - **Vida:** #86 (design) merged 00:29Z and #87 (palette lines) merged
      01:06Z, both by `tucksravin`, not by the round-3 session. vida `main`
      `e434964e` carries the 13 lines, and its CI is green.

30. **Sonder's Testing report, due 2026-09-30 (P0-4)** — measured 2026-09-29
    ~23:55Z. Two blockers, and only the first can be fixed by 09-30.
    - **Titles & Meta [M].** fleet-lighthouse run 36584559490 names one
      problem on 15 routes: `https://gallerysonder.com/artists: title 90 chars
(max 70)`. The title is Prismic `page` document `artists`
      (`ZjwQtxIAANaT82IQ`), field `meta_title` =
      `Artists - Ruben Benjamin - Borja Colom - Theo Hirschfield - Anthony James`
      (73 chars), and the site's `brandedTitle` adds ` | Gallery Sonder` (17).
      The audit is right, so nothing is changed in code. **Ask:** in Prismic, set
      that `meta_title` to 53 characters or fewer, e.g.
      `Artists: Benjamin, Colom, Hirschfield, James` (44, so 61 on the page),
      and publish. The site is prerendered, so check that
      `curl -s https://gallerysonder.com/artists | grep -o '<title>[^<]*'`
      shows the new title. A deploy on 09-25 with no commit since 09-22
      suggests a publish rebuilds the site [I]. The next fleet-lighthouse run
      (Sonder about 15:00Z on 09-30, if it fires like 09-29) re-stamps
      `titles_meta_ok`, and then **refresh preview** on the draft.
    - **Form Functionality [M].** `form_e2e_checked_at` is NULL. Last night's
      form-e2e run 36598340500 skipped Sonder: "site /health does not declare
      forms.testMode — probe refused". `/health` has no `testMode`, and the
      four `<form>`s on `/contact` are hidden Netlify stubs. A marked probe
      needs a Sonder PR and a deploy (testMode forwarding, a `/health`
      declaration, and the forms restructure in item 26), so no safe
      measurement is possible by 09-30. Independent evidence from production:
      Sonder received 10 real submissions from 09-22 to 09-29 (inquiry 3,
      newsletter 6, rsvp 1; the latest on 09-28), all with notifications sent
      and Mailchimp fanout ok. The `contact` form's latest is 09-02.
    - **The product call.** Can the first Testing report ship with Form
      Functionality unmeasured? Under a send-anyway override, the email still
      draws "Form Functionality ✓" (`shownChecklistLabels` drops only `n/a`
      rows), and the override also lifts every other health blocker. **My
      pick:** fix the title first. When refresh preview shows Form
      Functionality as the only blocker, send on 09-30 with the logged
      override, reason "form-e2e cannot probe Sonder until its forms forward
      testMode (#779); 10 real submissions in 7 days delivered". Then book the
      Sonder forms PR (item 26) so the next Testing report is measured. The
      alternative is to hold the report until that PR deploys.
    - Also seen: the gate's note for a Titles fail says "Missing/duplicate
      title or missing meta description" (`src/reports/auto-tick.ts:356-360`)
      even when the fault is length. It pointed the wrong way here, and a
      small copy fix would correct it.
    - **Answered 2026-09-30: loosen the rule.** Title length no longer fails
      Titles & Meta. It is measured without the brand suffix the sampled pages
      share, and a title still over 70 is a warning in the browser audit note
      (`titleLengthWarnings`), not a fail. Empty titles, missing descriptions
      and duplicates still fail. The Prismic title is left as it is; `/artists`
      is 73 without " | Gallery Sonder", so it warns. Once this lands (the nightly
      builds from main, so no release is needed) and the
      next fleet-lighthouse run re-stamps `titles_meta_ok`, refresh preview.
31. **#779, the client half of form-e2e coverage** — the central widening
    (item 16) covers no new site on its own. Measured 2026-09-29 from the live
    roster (SELECT-only) and each site's deployed `/health`: 15 maintained, 6
    covered, and Vida is covered from tonight (it declares `testMode:true` and
    went maintained after last night's run started). Two sites have no form:
    29 Navy (its `/health` says `testMode:false` on purpose) and CalTex, so
    `skipped` cannot go below 2. The other six have forms, and none of them
    declares `forms.testMode`. Probing an undeclared site would post a real lead
    to the client, so each one needs a PR in its own repo: forward `testMode`
    in `buildPayload`, declare it in `/health`, and add the site-specific piece:
    - ERP Industrials: add a `role="status"` success element. Its required
      `interest` select is covered by the widening now.
    - Revogen: add a `/contact` entry to `/distribution-opportunities`.
    - Data Dynamiq, LA Homelessness Initiative and LA Homelessness Youth: the
      form sits in a closed modal. Use Beachfront's `/contact` → `#hash`
      redirect, and add `role="status"` on the two LA sites.
    - Sonder: hidden Netlify stub forms come first in the DOM, and the real
      input is outside any `<form>`. This needs a forms restructure.

    The ask: book these as client PRs, one per site in its release window. My
    pick is ERP first, since it is two small changes now. #779's second idea, a
    per-site contact-path override in the roster, was not built. It was meant to
    reach Revogen "without touching the site", but Revogen has to deploy anyway
    to declare `testMode`, so that same deploy can add a `/contact` redirect.
    Say if you want the column anyway.

32. **#779's central widening, PR #1017. Answered 2026-09-30: third round,
    then land.** The operator merged it 03:32:33Z as `d1e42c4a` (head
    `a8359581`). The first nightly after merge is its first live run.
    Round 3 found behaviour defects, fixed in `48326568`; the text below is
    what the operator decided on.
    Rounds 1 and 2 are in the PR body. Round 3 (on `84f69a1a`, after merging
    main) used 4 lenses and 3 refuting skeptics per finding; 13 of 14 findings
    were confirmed. Behaviour defects, all fixed with a red test first:
    (1) **live-lead leak**: a page that re-renders its form on a change event
    dropped the probe's hidden `testMode` input after the re-synthesis pass,
    and the click went out unmarked, so it would have been stored, counted and
    emailed as a real lead. The first fix, re-injecting after re-synthesis,
    was not enough: the click itself blurs the last filled field, whose change
    event drops the marker again. The probe now re-adds the marker in a
    capturing `submit` listener that runs before the site's handler, and it
    refuses to click (no POST) when the marker is missing just before submit.
    (2) A required select counted as filled when its selected placeholder
    was `<option disabled selected>` with no value attribute, so the POST
    omitted it. (3) A synthetic value the field rejects (`pattern`, `max`) was still
    claimed as synthesized. (4) Three synthesizer tests used `setContent`,
    which hangs under the weekly time-travel clock, so Monday's run on main
    would have gone red. Also fixed: the control step passed when every
    fixture test was skipped (it now reads vitest's JSON report and requires
    passed ≥ 1, skipped = 0, todo = 0); the control and the sweep must share a
    job (`84f69a1a`); the throw path dropped `resynthesized`; wording for a
    field that became required after the first fill; and four test gaps
    (date `min`, `maxlength`, no `resynthesized` on a quiet page, no-banner
    path). One finding was refuted (2 of 3). 15 round-3 mutations each turn a
    test red; a real all-skipped fixture makes the real control step exit 1. The
    changed fixture passed 10 of 10 runs pinned to one busy core (104–106 s
    each, 22/22 tests), and CI is green on `6bb9bee7`. My pick: land. The defects
    were real, but each now has a test that fails without its fix, and the
    marker now has two independent guards. Landing it is CI green on the head,
    then `node scripts/land-prs.mjs 1017`.

33. **OD7-P0, the Williamson repos (#1029)** — the cloud session was refused
    creating org repos (`POST /orgs/reddoorla/repos` → 403 "Resource not
    accessible by integration"), and a public repo is blocked outright as a
    public surface. The captures are done, and Phase 1 waits on these four
    answers:
    - **(a) Create the two repos.** On
      `https://github.com/reddoorla/reddoor-starter`, click **Use this template →
      Create a new repository**. Set the owner to `reddoorla`, the name to
      `williamson-homes`, and visibility **Public** (the new-site skill's
      convention; 29 Navy is public) or Private. Then do the same for the second
      repo. Or run `gh repo create reddoorla/williamson-homes --public --template
reddoorla/reddoor-starter` on the laptop. _Pick:_ public, as the fleet does.
    - **(b) The second repo's name.** The brief says `williamson-construction`,
      but the roster row is slug `williamson-construction-co`, name "Williamson
      Construction Co" [M, a SELECT on 2026-09-30]. new-site step 0 makes the
      slug, the repo, the Netlify name and `package.json#name` one decision,
      and `ensure-site` throws when the name does not slugify back to the slug.
      _Pick:_ `williamson-construction-co`, so the repo and the row agree.
    - **(c) Where the Williamson capture bytes live.** They are 310 MB (Homes
      167, Construction 143), mostly full-resolution photography, so they are
      on branch `capture/od7-williamson-2026-09-30` at `a89da157`, not on
      `main`. A fresh clone of that branch passes the check. Merging them would
      put 310 MB in this repo's history permanently. _Pick:_ keep the branch;
      the Phase 1 worker copies each capture into its repo's `matching/spec/`,
      after which you delete the branch (the proxy refuses a branch delete from
      the cloud). Every Netlify build of a site repo clones that repo, so say
      if you would rather keep only the originals there and not every
      responsive variant.
    - **(d) The RED steps from new-site, after (a).** Each site needs: branch
      protection via `self-updating` and secret scanning (a worker tries these
      first and writes down what the proxy refuses); a Prismic repository
      (suggested names `williamson-homes` and the answer to (b)); its
      `PRISMIC_WRITE_TOKEN` repo secret, the central
      `PRISMIC_TOKEN_<NAME>` secret and the `fleet-prismic-drift.yml` env line;
      and a Netlify site with `FORMS_INGEST_URL`, `FORMS_INGEST_TOKEN`, a build
      hook and the Prismic publish/unpublish webhook. No roster write is needed:
      both rows exist as `building`, and `git_repo` is filled at launch.
    - **Answered 2026-09-30:** (a) the operator creates `reddoorla/williamson-homes`
      and `reddoorla/williamson-construction-co` by hand, both **public**, from the
      reddoor-starter template; the cloud cannot. (b) The name is
      `williamson-construction-co`, matching the roster slug. (c) The capture bytes
      stay on the branch: Phase 1 copies each capture into its site repo's
      `matching/spec/`, and then the operator deletes the branch. (d) The RED steps
      (branch protection, secret scanning, Prismic repositories and tokens, Netlify
      sites, env vars, hooks) stay the operator's, after (a).
    - **Progress 2026-09-30 ~05:45Z.** The operator created both GitHub repos
      and both Prismic repositories, and added their tokens to the cloud
      environment. The Prismic repositories are `williamson-homes` and
      `williamson-construction`, **without** `-co`; the token secret name
      follows the Prismic repositoryName, not the slug. On the operator's
      authority, the PM session created both Netlify sites with `NETLIFY_PAT`,
      mirroring 29 Navy: `williamson-homes` (`9072ea82`) and
      `williamson-construction-co` (`7e2831e2`). Both are linked to their repo
      `main` through the Netlify GitHub App, build with `pnpm run build` to
      `build/`, have `FORMS_INGEST_URL` (`/api/forms/<slug>`) and
      `FORMS_INGEST_TOKEN`, and have a "Prismic publish" build hook on
      `main`. Still open: the Prismic publish and unpublish webhooks to those
      hooks (the Prismic dashboard; the hook URL is under Netlify, Site
      configuration, Build hooks); the per-repo `PRISMIC_WRITE_TOKEN` GitHub
      secret and the central `PRISMIC_TOKEN_<REPOSITORYNAME>` secrets; and
      branch protection and secret scanning.
    - **Secrets, 2026-09-30 ~05:40Z.** Both environment tokens were checked
      against Prismic's custom-types API: `WILLIAMSON_HOMES_PRISMIC` answers 200
      for `williamson-homes` and 403 for `williamson-construction`, and
      `WILLIAMSON_CONSTRUCTION_PRISMIC` the reverse, so each is its own
      repository's write token. **No GitHub secret is set yet**: the cloud proxy
      refuses `GET repos/…/actions/secrets` with 403 "Access to this GitHub
      Actions path is not permitted through this proxy", so the operator sets them
      in the UI: `PRISMIC_WRITE_TOKEN` in `williamson-homes` and in
      `williamson-construction-co`, and `PRISMIC_TOKEN_WILLIAMSON_HOMES` and
      `PRISMIC_TOKEN_WILLIAMSON_CONSTRUCTION` (no `CO`) here. The two
      `fleet-prismic-drift.yml` env lines landed ahead of the secrets; a
      pre-launch site is not swept, so they are inert until go-live.
    - **Secrets set, 2026-09-30 ~06:20Z (operator, by hand).** The operator
      reports all four set in the GitHub UI. Not verified from the cloud (the
      proxy refuses the secrets API); first real proof is a Williamson workflow
      that reads `PRISMIC_WRITE_TOKEN`, and the central pair at go-live.
34. **OD7-P0, the capture tools, PR #1032: round 3 found behaviour defects, all
    fixed in `db83c30f`; land or not.** **Answered 2026-09-30 ~03:25Z: land
    at this head.** Landed by `land-prs.mjs` as `96e10a2a` (head `5e06f8c6`,
    main merged in; only the journal conflicted). The operator answered this item on
    2026-09-30 with "run a third review round". Round 3 confirmed 24 findings (4
    lenses, 3 refuting skeptics each, confirmed when 2 of 3 could not refute
    it): 11 behaviour defects, 12 test gaps, 1 wording. The most serious
    behaviour defect: a percent-encoded `../` in a reference could make
    `capture.mjs` write a file outside `--out`, and the check then read it back
    from there and passed. Also found: a `<!--` in script code and ` src=`
    inside another attribute's value hid real tags; `image-set()`, `URL()` and
    protocol-relative runtime loads were missed; file-under-file, case-only
    and page-on-page path clashes overwrote a file or crashed a run with no
    manifest; an http/https pair to one file was a false collision; an empty
    page list passed; and a typekit kit whose id starts with `af` was excluded.
    Each has a test that was red before the fix (`4753cf72`). None of it
    touches the real captures: on all 31 pages and every captured file, the
    extracted references, page links and path mappings are byte-identical
    before and after, and all three captures pass. Note for 33(c): while
    `capture/od7-williamson-2026-09-30` exists, every default clone, cloud
    setup and `fetch-depth: 0` CI checkout downloads its ~290 MiB. _Ask:_
    land #1032 at its current head, or not? There is no fourth round. _Pick:_
    land. Every round-3 defect is fixed and bound by a test, and none changed a
    real capture. Landing: CI green, then `node scripts/land-prs.mjs 1032`.

35. **#948: the preview alone does not end the hydration race. Pick the
    signal (drafts #1039 and reddoor-starter#163, 2026-09-30).** Item 18
    **Answered 2026-09-30: the pick, (b) now and (a) after.** #1039 and
    reddoor-starter#163 land as they are. (a), #947's hydration marker, is
    now agent-ready (see "Blocked behind another PR", unblocked).
    answered #948 with "audit the built preview, not the dev server". Built and
    measured, the preview narrows the race but does not remove it. #948's bar
    was "identical on every cold run and equal to the hydrated count". Numbers
    are roalson `/dev/a11y-fixtures` color-contrast nodes, each run cold:
    old dev gate 191, 201, 191, 208, 191 (191 is the never-hydrated page, which
    blocking the entry chunks reproduces exactly; hydrated is 208). #1039's
    preview: 12 runs at 208 and 2 at 217, plus one 300 s spec timeout; 217 − 208
    = 9, the featured cards that the hydrated reveal hides. Preview plus a wait
    for `html[data-hydrated]` (roalson #57 sets it in the root layout's
    onMount): 208 in 10 of 10 runs at no added time. That variant is scratch
    only, not in #1039. The fixture half is done and proven: the guard passes
    only a build made with `VITE_REDDOOR_GATE_FIXTURES=1`, the flag is baked in
    at build time, and Netlify refuses it; mutations 1–5 all turn tests red.
    Cost: a second build per run, +11 s median on roalson. _Ask:_ which
    hydration signal does the gate wait for? (a) #947's marker: the starter's
    root layout sets `data-hydrated`, the spec waits for it on sites that
    declare it, and #947's recipe half is fixed in the same change. (b) Land
    #1039 and #163 as they are and accept about 1 run in 7 reading
    mid-hydration, until (a). (c) Wait on `networkidle` plus 3 s: 208 in 3 of 3
    runs, but +25 s per run, and it can hang on sites that poll. _Pick:_ (b)
    now, then (a). The preview is needed either way, and the marker is the only
    signal that measured clean. Ordering: until a site's `/dev` guard passes the
    flag, #1039 fails that site's gate with a line naming the guard. So the
    starter PR, then one PR per site with fixtures, must land before any
    `@reddoorla/maintenance` bump that carries #1039.

36. **OD7-P1, williamson-homes#5 (content model, project routes, slices,
    seed): round 2 found a real defect; land after three small fixes, or run
    a third round?** #5's head `9bfc481` is CI green and mergeable, with `main`
    (#4) merged in. The models and published content already in Prismic
    `williamson-homes` came from this branch (#1048). **Round 1** had three
    separate lenses and no blocker. It found two majors: featured project
    titles at 3.21:1 (the reference's `opacity-75`), and both Webflow guards
    skipping extensionless files, so a `_redirects` Webflow proxy passed the
    build check. Both, and every minor but three explained on the PR, were
    fixed in `65dd1ec`, with a fixture test for the `_redirects` case. **Round
    2** (one reviewer, the fix commit only) found: (major) the secondary
    button's hover tint `bg-secondary/10` still fails on the `bg-light` ground,
    4.23:1 inside every ImageCards slice and on a light Statement; (minor) the
    sticky header can show over the absolute header at the top of the page,
    because `focusWithin` keeps it open at y ≤ 120; (minor) the round-1 fixes
    to contrast, the header and the seed guard have no test that fails when
    they are reverted (six mutations survived). _Ask:_ (a) apply the three
    fixes below and land #5 on CI green, with no third review round; or (b) a
    third round. _Pick:_ (a). Each fix is local and bound by a test:
    `WhButton`'s hover tint `/5`, about 4.5:1 on both grounds, with a test that
    computes the blended contrast on `white` and `light`; `sidekick =
    (scrolledUp || focusWithin) && y > 120`, with a component test; and a unit
    test per round-1 fix (`opacity-75` absent, `aria-controls` absent while
    closed, the seed throwing on an unseeded link). After #5, one prepared PR
    (branch `claude/wire-prismic`, pushed, no PR; it sits on #5 at `6a52e5b` and needs #5 merged into it) replaces the sentinel with
    `williamson-homes` and sets `a11yRoutes`. Its build prerenders all 10
    reference paths from the live repository. Still the operator's (#3):
    Prismic publish/unpublish webhooks, branch protection, secret scanning.

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

- 2026-09-30 — #948 (PR #1039, reddoor-starter#163): the a11y audit's axe scan
  runs on a production build it makes itself (`npm run build && npm run
preview`, `VITE_REDDOOR_GATE_FIXTURES=1`, probed on `/_app/version.json`),
  never on `vite dev`. The starter's `/dev` guard lets only that build serve
  the fixtures, and Netlify refuses the flag. Cold runs on roalson went from
  191/201/191/208/191 on dev to 208 in 12 of 14 on the preview; the residual
  race is the #947 item above. **Rollout:** each of the 25 site repos with the
  one-line guard needs its guard PR merged before it takes a
  `@reddoorla/maintenance` bump carrying #1039, or its a11y gate fails with a
  line naming the guard. Landed `f1ad1cec`. The 25 guard PRs are open and green,
  waiting on the operator's go: roalson-interests#219, williamson-construction-co#1, williamson-homes#4, vida-legacy-foundation#88, reddoor-website#233, reddoor-starter-blux#37, beachfront-dentistry#70, 29-navy#59, medical-solutions-of-texas#70, revogen#89, caltex-landing#68, erp-industrial#64, vineyard-custom-homes#70, espada#78, alamo-anatomy#61, 1836dig#23, data-dynamiq#56, the-pointe-burbank#40, gallerysonder#104, la-homelessness-initiative#48, canvas-starter#30, the-tower-burbank#27, composition-hospitality#36, la-homelessness-youth#28, hedloc#51.

- 2026-09-30 — #779 central widening (PR #1017, `d1e42c4a`): the form-e2e probe
  fills required select, checkbox, radio and text fields outside its standard
  four, names what it synthesized, and keeps its `testMode` marker on the form
  at submit (a capturing `submit` listener, plus a refusal to click when the
  marker is missing). The nightly runs a localhost positive control in the
  sweep's own job first and fails when that control measured nothing, and it
  names each uncovered site. It covers no new site by itself: item 31, the
  client half, is still open.

- 2026-09-30 — #905, #949, #1018: the a11y spec's motion-freezing sheet is adopted
  through CSSOM (`freezeMotion`), so a CSP without `'unsafe-inline'` in
  `style-src` no longer fails the audit, and the page's CSP stays enforced
  (`bypassCSP` would have switched it off). A spec that writes no results is
  summarised from Playwright's stdout, where the line reporter prints the
  error, followed by the tail of the web server's stderr less npm warnings
  (a dying server prints its cause last; review round 3); a missing
  browser gets its own line naming the absent executable and
  `npx playwright install chromium`. Both reproduced on `1b1c52fd` first: each
  summary read "no results written (exit 1) — [WebServer] npm warn …".
  A typed error (`TypeError:`) or a test timeout on stdout is named too
  (#1018, found by review round 2; round 3 ran on the operator's call,
  Operator decisions 27).

- 2026-09-30 — #1014 + #1035 (BACKLOG 29, vida's part of item 23): axe's
  `blendFunctions[blendMode] is not a function` crash (plus-lighter) is "not
  measured" and warns, instead of failing the page, on a top-level non-host
  element. #1014 (`a00d50d4`) re-runs the rule around each crashed node;
  #1035 (`b4aa1948`) gives up the re-run, so the crash fails, when a crashed
  node's selector stops naming that one element. Vida's #86 and #87 are
  merged. Both changesets ride release PR #988.
- 2026-09-29 — P1-3 / #912, PR 2 (the surface): a fresh `url_resolves = 'fail'`
  on any non-archived row reaches the digest as `url-unresolved:<siteId>`,
  naming the url and the status; stale stamps (older than three days, unreadable, or never
  set while no row in the fleet is fresh) roll into one `url-probe-stale` fleet item whose metric is the count; `url not deployed`
  in Accepted Watch Conditions mutes only the failure; maintained rows also watch
  on the cockpit. PR 1 (#986) stores the verdict.
- 2026-09-30 — #943: the "Search Console set up" launch check passes only on
  evidence (#1016). Every draft or announcement whose Search Console lookup
  runs stores its outcome in `site_health` (`search_console_outcome` /
  `_resolved` / `_checked_at`, migrations 0035–0037). The check passes on a
  resolved lookup within the site's shorter report cadence + 14 days
  (45/106/380 days), or on the "no search console" opt-out, which wins. A
  soft-fail reads as unknown. The cockpit watch `search-console-no-property`
  names the host whose lookup matched nothing. No backfill: each site
  reads "no report lookup on record" until its next draft. #943's point 3
  (falling back from a recorded property to the by-host candidates) is not
  done.
- 2026-09-29 — P1-7 / #910: the a11y audit's route coverage is stored next to
  its violation count. `details.routes = { scanned, total }` (the numbers the
  summary's "N of M routes" prints) is written by `audit --write-back` to
  `site_health.a11y_routes_scanned` / `a11y_routes_total` (migrations
  0033–0034). A 1-of-2 run and a 2-of-2 run with the same violation count now
  read back from Turso as different rows (`tests/audits/a11y-routes-turso.test.ts`).
  The site page's Accessibility tile and the cockpit card say when a run was
  partial. Not done, and still #910's larger half: no fleet sweep runs the
  a11y audit, so the columns fill only when someone runs `audit --write-back`
  from a site checkout. The report gate does not read them.

- 2026-09-29 — Operator decisions 17: a checklist row whose evidence is
  `n/a` (no CMS, no form, no CI) is dropped from the client Maintenance and
  Testing email on every render path, and a list that empties takes its heading
  with it (#1015).

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

- 2026-09-29 — P1-12 / #983: `fleet-config-drift.yml` runs
  `sync-configs --fleet turso --dry` every Sunday at 07:23 UTC behind a
  three-fixture positive control, and files "Fleet config drift" with the DRIFT
  and SKIPPED lines (#995). It closes only when every repo in the issue's
  own body comes back CLEAN. `--dry` now reports a tracked `build/` file as
  `.gitignore` drift, as the real run already committed it. The Verify line held:
  no workflow ran `sync-configs`, and the probe printed `no changes needed`
  against the real run's `applied: 1 commit(s)` on `e2d4aa67`.

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
