# Backlog — what to work on next, in order

**Last full re-rank: 2026-09-29 ~06:00Z; state updated 2026-10-04 ~16:10Z** (Sunday PM pass, `claude/youthful-turing-o7qpdl`; a diff, not a full re-rank).
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

| Due   | Site                                          | Report                                         | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 09-30 | Sonder                                        | Testing (the fleet's **first** Testing report) | **Sent 2026-10-01 16:34:12Z, delivered** [M, daily-reports run 36892838203 `✓ sent`, live row]. Approved by the operator 09-30 21:18:16Z.                                                                                                                                                                                                                                                                                                                                                                                                  |
| hold  | 29 Navy                                       | Maintenance 2026-09                            | **Sent 2026-10-01 16:34:13Z, delivered** [M, same run, live row]. Approved 09-30 21:20:01Z.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 12-30 | Vida Legacy Foundation                        | Maintenance (first)                            | 2026-09 draft withdrawn 2026-10-01 01:03:47Z (item 41). Quarterly, so the first Maintenance report is due 12-30 [M]. Out of this window.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11-01 | Sonder                                        | Maintenance                                    | **Pushed to 2026-11-01** by the operator's rule (10-01, #1099): a Testing report within a month of a Maintenance due date pushes Maintenance back one cycle. Today's run drafted no Maintenance row [M, run log: only `skipped (already drafted 2026-09): Sonder Testing`]; `nextDueDate` reads 2026-11-01 [M]. Out of this window.                                                                                                                                                                                                        |
| 10-05 | Data Dynamiq, Espada, Revogen, Vineyard, LAHI | Maintenance                                    | No rows yet; they draft in the 10-05 `daily-reports` run (~15:00Z) and each needs the operator's approve. **10-04 16:03Z [M]:** `nextDueDate` = 2026-10-05 for all five, `preflightSite` returns no finding for any of them (its negative control, Espada with recipients and contact blanked, returns `recipients-missing`), and fleet-lighthouse re-stamped evidence 10-04 13:48Z (`wrote=21 failed=0`). **Corrected:** Data Dynamiq now has `ga4_property_id` 556916505, so it is no longer the one without GA4; all five are enrolled. |

**Settled — do not flag again (operator, 2026-09-29, after being asked
several times):** the report recipients are correct as they are. MSOT and
Revogen both resolving to `accounting@revogenbiologics.com` is intended, and
29 Navy's send going to MatthewB@worthe.com is intended.

---

## P1 — next, agent-ready, no operator decision needed

| #     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tier | Effort | Start here                                                                                       | Done when                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| P1-24 | #947 (starter and recipe half) + #948's residual race: add a bundle-only hydration marker (`html[data-hydrated]`, set in the root layout's onMount, as roalson #57 does) to `reddoor-starter`, then make `src/recipes/smoke-suite/template.ts:32` scaffold it instead of `hydrationMarker: "footer"`. Unblocked: the 25 guard PRs merged 09-30. The fleet rollout is per-repo PRs (🔴 as a mass push), not part of this item                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 🟡   | M      | `src/recipes/smoke-suite/template.ts:32`, roalson-interests #57                                  | Starter PR and central recipe PR landed; the recipe's test pins the marker                                         |
| P1-25 | Prismic toolbar and previews under the shared CSP baseline. williamson-homes#7 found that on a wired site every preview opened `/` (routes-free client, `url: null`, and `redirectToPreviewURL` takes no `linkResolver`), and the CSP blocked the toolbar: `prismic.io/prismic-toolbar/4.1.10/toolbar.js`, the `<repo>.prismic.io` iframe, and html2canvas for Share. Fixed in williamson-homes (`ca6027f`) and the starter (reddoor-starter#164). `BASELINE_CSP` in `src/configs/svelte.ts:103` has the same `script-src`/`frame-src` gap for any site that does not override them. Scoping `frame-src` to one host needs the repository name, which `createSvelteConfig` does not take: pick an optional `prismicRepository` option over a `*.prismic.io` wildcard. Sites cloned before #164 carry both defects; rolling the fix to them is per-repo PRs (🔴 as a mass push), not part of this item | 🟡   | S      | `src/configs/svelte.ts:103`, `tests/configs/svelte.test.ts`, reddoor-starter#164                 | The baseline admits the toolbar path, html2canvas and (given `prismicRepository`) that host, each pinned by a test |
| P1-27 | The audits' port picker races under parallel tests. `findFreePort` (`src/util/free-port.ts`) binds :0, closes, and hands the port to a server that binds it later; its own comment calls the window "theoretically racy". On 2026-09-30 it happened: #1066's `build` on `455d6db` failed 7 tests in `tests/audits/a11y-live-spec.test.ts` with `EADDRINUSE … port: 40937`, on a head that differed from a green one only in two docs files; it passed 60/60 locally and on the one re-run. Retry the spawn with a fresh port on `EADDRINUSE` (a11y, lighthouse, smoke), up to 3 tries                                                                                                                                                                                                                                                                                                                 | 🟢   | S      | `src/util/free-port.ts`, `src/audits/a11y.ts`, `src/audits/lighthouse.ts`, `src/audits/smoke.ts` | A test that squats the first port picked still gets a result, and goes red with the retry removed                  |

### Blocked behind another PR (do not start early)

- **P1-30 · Mantis Landscaping: Blux → native Reddoor stack (#1107) 🟡/🔴.
  Blocked on Operator decisions 59–62.** The plan is
  `docs/mantis-landscaping-plan-2026-10.md`. The phases are P0 (Blux
  export, repo from the starter, capture into `matching/spec/`), P1
  (Prismic repository and write token 🔴), P1b (`ensure-site`, status
  `building`), P2 (model, slices, routes, seed from `blux convert`), P3
  (Netlify), P4 (form intake on `/api/forms/mantis-landscaping` with
  Turnstile), P5 (fidelity and §4 improvements), P6 (cutover of `A` and
  `www` only, then `launch`) and P7 (cancel Blux 🔴). Each phase's "done
  when" is in the plan's §6. _Verify:_ `curl -sI https://mantislandscaping.com/`
  still shows Blux, and `captures/mantis-landscaping/manifest.json` exists.
  **10-01 ~18:40Z: 59–62 answered; P0, P1 and P1b under way.**
  - **P1b done:** the Turso row `site_01M3WA8PZXD4Q8N7P234MNYJNB`,
    `building`, with `git_repo` `reddoorla/mantis-landscaping` (verified
    by `SELECT`).
  - **P1:** the Prismic repository `mantis-landscaping` exists; its
    `/api/v2` answers 200, while a made-up name answers 404. The operator
    reports the token and secrets set; they are not visible from this
    container.
  - **P0:** reddoorla/mantis-landscaping#1.
  - **Next:** P2.
  - **Still open:** the Netlify site's name (CI assumes
    `mantis-landscaping`), and Nicole's answers (61: 1, 2 and 7, plus the
    drafts).
    **10-01 ~18:45Z: the operator answered the rest.**
  - **61.1, the form recipient:** the client's address. It is on the row
    as `point_of_contact` (verified by `SELECT`) and is not written here,
    because this repo is public. Pre-launch rows still notify only the
    operator (`src/forms/notify.ts`).
  - **61.2, DNS:** asked for after the client reviews the build.
  - **61.7, icons:** use Lucide, not the Noun Project PNGs.
  - **The three draft projects:** ignored.
  - **P3, Netlify:** created on the operator's authority as
    `mantis-landscaping` (`f0ce133b`), on `main`, `pnpm run build` →
    `build/`.
    - `FORMS_INGEST_URL` and `FORMS_INGEST_TOKEN` are set; the token
      matches Williamson's by sha256 prefix.
    - A "Prismic publish" build hook is on `main`. Its Prismic webhook is
      the operator's to add.
    - `netlify_id` is on the row (verified by `SELECT`).
  - **The first production build failed on Netlify's secret scan:** Blux's
    `__analytics.js`, vendored in P0's `matching/spec/`, carries Blux's
    browser API key. It was removed in mantis-landscaping#2.
    **10-04: P2a stopped at Operator decisions 64.** mantis-landscaping#3
    (model, slices, routes, 301s) had two dirty review rounds. The seed
    content is drafted on `claude/p2b-seed-draft`. Nothing has been pushed
    to Prismic.

- **#947 (recipe half) + #948's residual race: unblocked 2026-09-30; ranked as P1-24 by the 09-30 PM pass** (item 35
  answered "(b) now, (a) after"). `src/recipes/smoke-suite/template.ts:32`
  scaffolds `hydrationMarker: "footer"`, which cannot prove hydration. Do it
  together with the a11y spec waiting for a bundle-only marker
  (`html[data-hydrated]`, set in the root layout's onMount as roalson #57 does)
  before the reveal pass. Measured on roalson: preview alone 208 in 12 of 14
  cold runs (217 twice, mid-hydration); preview + that wait 208 in 10 of 10.
  Starter first, then the recipe, then the fleet. Blocked only on the 25 site
  PRs for #948's guard flag landing first (see Done, #948).
- **#921 persistence**: do it the #910 way once #918 merges. **#918 merged 2026-09-29 21:35Z (`18054c6f`), so this is no longer blocked;** not yet ranked, because #921's four-site table is stale (Revogen's property is on the row now) and needs a re-measure first.

### Watching (owned elsewhere, or parked)

- **P1-26, the fleet `/privacy` page (#1055, option A): parked by the
  operator 2026-09-30 ~21:25Z** until a lighter week with no new client
  work, to save tokens. The brief is ready in `docs/privacy-2026-09.md`, and
  #1055 tracks it. Do not recommend it before the operator un-parks it. Its
  one hard date: roalson-interests must carry the page before its launch adds
  GA4.
- **GOLA (operator's desktop session `session_01Sjj8cMbeBoVNQ5bsErLsK9`,
  started 2026-09-30 20:25Z)**: rates research from GOLA's Discord history and
  a PDF sweep; at 21:17Z "sweep 50% done; PDFs ~23:00–23:15 UTC". No branch
  pushed yet, and no issue. The PM pass reports its state (`get_session`) and
  does not act on it.
  **10-01 03:40Z [M]:** branch `claude/practical-ride-kbipzv`, 13 commits to
  02:25:59Z, no PR. It touches `docs/workJournal.md` (+66) and `CLAUDE.md` (+13,
  "research agents run on Sonnet"). `list_sessions` is not available to the PM
  Routine, so its session state was not read.
  **10-01 12:00Z [M]:** unchanged — same head, last commit 02:25:59Z, still
  no PR.
  **10-04 16:00Z [M]:** still unchanged — same head, last commit
  2026-10-01 02:25:59Z, no PR. Three and a half days idle.

- **Live worker sessions, 10-04 ~16:00Z [M, branches and PRs; `get_session`
  is not available to the PM Routine].** All three pushed within ten minutes of
  the pass starting: rank, do not take.
  - Mantis P2a: landed its stop as Operator decision **64** in #1118
    (`9664ef0a`, 16:17Z) while this pass ran. The next new item here is **65**.
  - #1117, `prismic-ci` from a cloud session (#1113): landed as `2c5d9f1c`
    at 16:04Z, also during this pass.
  - PR #1116, `claude/video-encode-command` (`5715a32c`, 15:59Z): the `video`
    encode command (item 63), review round 1 folded in. Still open.
- **#754, new repos below the posture floor (10-04 nightly [M]).**
  `mantis-landscaping`, `williamson-homes` and `williamson-construction-co`
  have no repo ruleset, and secret scanning and push protection are off. For
  the Williamsons this is item 33 (d), still open; Mantis is new, and its first
  Netlify build already failed on a vendored Blux key (mantis-landscaping#2),
  which push protection would have stopped at the push. 🔴, the operator's.
  The renovate-staleness gaps on data-dynamiq, MSOT and vineyard cleared
  between 10-01 and 10-04.

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
   **Done [M, 2026-09-30 ~19:00Z]:** the row has `ga4_property_id = 545817747`
   and `search_console_property = https://revogen.com/`. Not an ask any more.
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
      kept, and the full-bleed opt-in is `data-bleed`. Second pass done
      2026-09-30 (Discord, Figma, MarkUp; corpus private in claude-skills):
      awaiting the operator's accept/cut of 34 new candidates, the order to
      encode reviewer-enforced vs never-reviewed rules, and whether N4 ("CTAs
      above the fold") stays cut. The file's last section lists the asks.
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
    **Ready 2026-09-30 [M]:** fleet-lighthouse run 36731239566 stored it:
    `ROSTER_URL_SUMMARY checked=34 pass=31 fail=1 no_url=2`, and the one fail is
    `the-pointe-burbank https://the-pointe-burbank.netlify.app 404
netlify-site-not-found`. The ask stands: set the url now.
    **Answered and done 2026-09-30 19:33:07Z [M].** The gate held first:
    fleet-lighthouse run 36731239566 (schedule, success) logged one warning,
    `the-pointe-burbank https://the-pointe-burbank.netlify.app 404`
    `netlify-site-not-found`, and the summary
    `ROSTER_URL_SUMMARY checked=34 pass=31 fail=1 no_url=2 mirrored=34`.
    A SELECT read `url_resolves = fail`, `url_status = 404 netlify-site-not-found`
    and `url_checked_at = 2026-09-30T15:06:30.087Z`. The url was then written
    through `setSiteDetail` (bound as `netlify/functions/site-details.mts` binds
    it), with result `updated`. Before: `https://the-pointe-burbank.netlify.app`.
    After: `https://the-pointe-burbank-rd.netlify.app`, read back from Turso. The
    new host answers 200, and the old one still answers 404. The health columns
    keep today's `fail` until the next nightly re-probes the row.
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
    - **Update 2026-09-30 ~15:45Z: Form Functionality is measured, and one
      different blocker remains.** gallerysonder#105 (`0eb2bee`) made the four
      forms real and forwards `testMode`, and production `/health` declares it
      from 15:36Z. A dispatched `fleet-form-e2e` (run 36738059445) wrote
      `form_e2e_ok = pass`, `form_e2e_checked_at = 2026-09-30T15:42:24.675Z`
      and `turnstile_widget = pass` [M, live Turso]. `titles_meta_ok` is also
      `pass`. On `autoTickChecklist` + `approveBlockers` against the live row
      (the draft's own code, run read-only), 12 of 13 gating items pass. The one
      blocker left is **Maint: Google Indexed: unknown, "Not yet measured"**,
      because Sonder is not search-enrolled: `ga4_property_id`,
      `search_query` and `search_console_property` are all NULL
      (`searchEnrolled` false). That is true in every environment, so it is not
      a credentials gap. No Testing draft row exists yet: at 15:45Z today's
      `daily-reports` schedule had not fired (it ran at 16:00Z on 09-29), so the
      draft it creates will carry this evidence without a refresh.
      **Ask:** record Sonder's Search Console property (or GA4 property id) on
      the row so Google Indexed measures, or send with a logged override naming
      only that item. My pick: record the property if the service account has
      access to it (then the next draft is clean), and otherwise override,
      reason "Sonder is not enrolled in Search Console yet (#939); every other
      gate measured green on 09-30". The send is yours either way.
    - **Update 2026-09-30 ~19:00Z (PM pass) [M]:** the draft exists
      (`report_01M3SGQRB1P4AX68Z20PME512P`, 16:00:37Z) and was re-rendered at
      18:40Z (run 36760315621, `evidence=reticked`). The row now carries
      `search_console_property = https://gallerysonder.com/`, but the blocker
      is unchanged: `site_health.search_console_outcome` is NULL, and a
      re-render cannot fill it, because `src/reports/retick.ts:5` keeps
      `Maint: Google Indexed` draft-time-only. It clears only by a re-draft
      that runs the lookup, or by the logged override. A live worker owns the
      Google Indexed work today; this line reports it and does not re-plan it.
      **Later, 19:18Z:** that worker's #1060 (`8ae1bf8c`) landed. Refresh
      preview now runs the Search Console lookup for an unsent, unapproved
      draft of a search-enrolled site, so the ask is: press refresh preview,
      then approve if Google Indexed measures.
    - **Update 2026-09-30 ~19:20Z: 13/13 measured, no blockers. Ready for
      your approve and send.** The diagnosis above was wrong about the cause.
      Sonder was not "not enrolled"; it was **opted out**:
      `accepted_watch_conditions` held `no search console`, and
      `searchEnrolled` returns false for an opt-out even with a property
      recorded (journal 2026-09-29, the Search Console entry, had said so).
      With the opt-out removed and `search_console_property` set through
      `setSiteDetail`, the draft still could not pick it up, because refresh
      preview kept Google Indexed as drafted (#929). #1060 (`8ae1bf8c`) makes
      refresh re-measure it for an unsent, unapproved report on an enrolled
      site. Dispatched `report-rerender` run 36764821092 on `8ae1bf8c`:
      `status=rendered bytes=86345 header=turso evidence=reticked
search=measured`. Read back (SELECT only) at 19:20Z:
      - all 13 evidence rows `pass`, with Google Indexed "Page 1 on Google (#2)";
      - all 13 boxes ticked;
      - `search_found_page1 = 1`, `search_position = 2`;
      - the body reads "Page 1 Google Result (#2)";
      - `approveBlockers` on the live row is `[]`.

      No override is needed. Nothing was sent.

    - **Update 2026-09-30 ~21:03Z: the header no longer shows the cookie
      banner.** #654 was closed by #814, but the draft's header still showed
      Sonder's consent panel and its blur scrim over the hero. Sonder's banner
      mounts after hydration, 3–5s after `load`, which is after #814's one
      click. Its classes are utility-only, so the CSS fallback never matched.
      #1070 (`d269b9cf`) now clicks only buttons inside a consent overlay,
      looks again after the settle, and refuses to store a shot whose banner
      will not leave. The plate was regenerated with `header-image sonder
--write-back` and inspected: 21:02:23Z, 888,694 bytes, the "Theo
      Hirschfield / Euphorbia" hero with no banner. The preview was refreshed
      (run 36776796655), and `approveBlockers` is still `[]`. Test emails to
      the operator inbox only: `01a0f3e7…` (old header),
      `01a0f41d…` (**broken, disregard**: an unstyled capture, see below) and
      `01a0f421…` (correct). Still ready for your approve and send.
    - **Follow-up (not built): an unstyled capture passes every check.** One of
      four cloud captures at 20:58Z rendered Sonder without its stylesheet:
      plain-text banner copy and two giant SONDER logos. `assertNotBlank` passed
      it, and so did the consent backstop, because an unstyled banner is not
      `position: fixed`. It was stored, and it went out in a test email before I
      looked at it. Three later captures were fine. The likely cause is this
      container's egress proxy [I], but nothing would stop the same shot in
      Actions. **Ask:** should the capture refuse a page whose stylesheets did
      not all load (`document.styleSheets` vs `<link rel=stylesheet>`)? My pick:
      yes, the same refusal shape as the consent backstop, as its own PR.
    - **Answered 2026-09-30 (yes) and built on `claude/header-unstyled-refusal`.**
      The DOM check the ask proposed would never fire: Chromium gives a `<link>`
      a non-null `sheet` even when its request 404s, returns HTML or is reset
      (measured). The capture now watches the network instead. It refuses a shot
      when a stylesheet from the page's own host, one that styles the screen,
      failed or answered 400 or above, and it re-shoots once first. Blocking
      Sonder's own CSS reproduces the broken shot exactly. A sweep of all 19 live
      fleet homepages found no false positive.
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
    - Sonder: **covered since 2026-09-30.** gallerysonder#105 (`0eb2bee`)
      restructured the forms and declares `testMode`; the dispatched run
      36738059445 passed it, and `skipped` fell from 8 to 7 of 15. Still
      uncovered: 29-navy and caltex (no form, the floor of 2), and
      data-dynamiq, erp-industrials, la-homelessness-initiative,
      la-homelessness-youth and revogen.

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
    **Answered 2026-09-30 ~14:40Z: land it.** williamson-homes#5 merged as 6ae87bda.

37. **OD7-P1, williamson-homes#7 (wire the live Prismic repository): round 2
    found one minor defect; land after two small CSP edits, or a third
    round?** **Answered 2026-09-30 ~18:48Z ("continue"): pick (a).**
    Applied in `d9cccee` (html2canvas's one file, `prismic.io/prismic-toolbar/`,
    this repository's host in frame-src; each bound by a test that goes red on
    revert) and merged on green as `ca6027f`. Production
    `williamson-homes.netlify.app` served #7's build by 18:57:59Z: all 10
    reference paths answer 200, `/nope` 404, no `website-files.com`. #7 replaces the `your-prismic-repo-name` sentinel with
    `williamson-homes` and sets `a11yRoutes`. Its head `6b7ddff` is CI green.
    CI's first run on real pages: the a11y gate reported "0 violations across 7
    routes (2 fixtures + 5 from package.json)" and smoke passed 21 of 21, both
    read from the job log. **Round 1** found no blocker. It found two majors
    this wiring makes live, both fixed in `6b7ddff` with a test each that goes
    red on revert. First, `/api/preview` sent every Prismic preview to `/`,
    because the routes-free client returns `url: null` and
    `redirectToPreviewURL` takes no `linkResolver`. Second, the CSP blocked
    the Prismic toolbar (`toolbar.js` from `prismic.io`, an iframe from
    `<repo>.prismic.io`). **Round 2** confirmed the preview fix against the
    real `asLink` and found one minor: the toolbar's Share button loads
    `https://html2canvas.hertzen.com/dist/html2canvas.min.js`, which
    `script-src` blocks, and its loader has no error path, so Share hangs for
    editors (visitors never load the toolbar). Nit: `https://prismic.io` and
    `https://*.prismic.io` could be narrowed to `https://prismic.io/prismic-toolbar/`
    and `https://williamson-homes.prismic.io`. _Ask:_ (a) add the html2canvas
    host and narrow both entries, each bound by a test, then land on green; (b)
    land as it is and accept that Share hangs until a follow-up; or (c) a third
    round. _Pick:_ (a). The edits are three CSP entries in one file, and the
    shared baseline in `@reddoorla/maintenance` has the same toolbar gap, which
    is worth its own item. williamson-homes#6 (#5's round-2 fixes, plus a
    focus handoff that its own review found) passed its second round and
    merged as `923007e`.

38. **OD7-P2, williamson-construction-co#3: a second worker took the PR over
    mid-flight; which session owns OD7-P2 now?** Worker
    session_01NUe11AdYHSuYtPRAypZziJ (prompted as "the only session on this
    repo") opened #3 at `dd47476`. After its container restarted, worker
    session_0198wGXMnzyFNhDgpVmmXt5c ("continue PR #3", created 16:29Z by
    session_01RoR4tzDuS92b4M2Mn3MP7d) pushed `99637f5` to `claude/site-build`
    at 16:51:03Z and rewrote the PR body. The first worker stopped on #3, as
    its brief says, and unsubscribed. **Still owed on #3, preserved on branch
    `claude/od7-p2-round1-unmerged` (`50799ca`, no PR)**: five round-1 fixes
    absent from `99637f5`. They are: `scroll-padding-top` for the fixed
    header (a11y lens, WCAG 2.4.11 major); `media-src` allowing
    `prismic-io.s3.amazonaws.com`, the host every staged video and the PDF are
    stored on, which `*.prismic.io` does not match (ops lens major: the videos
    would be blocked in production); the Webflow jQuery CDN in the build guard;
    About's CTA "Hire Us" with a buttons-vs-capture test; and a seed re-run
    guard. The staged release still says "Contact" on About's CTA. **The form
    is done, on branch `claude/intake-form` (`30b2085`, stacked on
    `dd47476`, no PR):** a 9-field intake to central as an `inquiry`,
    Turnstile-token refusal, and 7 mutations each red, one of them in central.
    **Prismic:** 32 models are in `williamson-construction` ("32 match"), and 6
    pages, 8 projects and 90 files are in migration release
    `ar0oXBIAAC0ARR2n`. Publishing that release is the operator's; the MCP
    refuses both an unasked publish and migration releases. _Ask:_ (a) the
    `0198…` session keeps OD7-P2 and cherry-picks `50799ca`, then rebases
    `claude/intake-form` after #3 lands; or (b) end it and re-dispatch this
    worker. _Pick:_ (a). It holds the PR and a round-2 review in flight, and
    the two branches are small and independent. Still open for launch, from
    decision 7: D6 (the form stays held on the operator; the row is
    `building`) and D8 (Lato, marked `TODO(D8)`). Turnstile needs no new
    widget: "Site Forms 2" (`0x4AAAAAAD_aiDmsrlRAHq-V`, verified centrally
    by `TURNSTILE_SECRET_KEY_2`) already lists `williamson-construction.com`.
    Set it as `PUBLIC_TURNSTILE_SITE_KEY` at launch. The netlify.app preview
    host would take that widget's last slot.
    **Update 2026-09-30 ~17:25Z (session `0198…`):** it acted on pick (a)
    before the answer, because its own brief said "continue PR #3". It
    cherry-picked `50799ca` onto #3 (`783423e`, fold-in `b57e99b`) and merged
    #3's head into `claude/intake-form`, now draft PR #5 (base
    `claude/site-build`). If the answer is (b), revert `783423e`/`b57e99b`;
    nothing else depends on them.
    **Answered 2026-09-30: re-dispatch; #3 landed at b57e99b as eec070be.**

39. **OD7-P2, williamson-construction-co#3: round 2 found real minors; land
    at `b57e99b` on green, or run a third round?** #3's head `b57e99b` passes
    locally (lint, check, build, 77 files / 659 tests); CI ran green on
    `2e1ff42`. **Round 1** (three lenses, on `dd47476`) found no blocker and
    four majors: a navy focus ring invisible on the navy bands; three looping
    background videos with no pause (WCAG 2.2.2); editor-picked button styles
    that could render white on white; and PR claim 3 ("Homes'
    `hover:bg-secondary/10` goes red") being false for this palette. All four
    were fixed in `99637f5`, and each fix has a test that goes red on revert
    (21 mutations in the PR body). **Round 2** (one reviewer, the fix commit)
    found three minors in the new video control (it guessed its state, showed
    on a band with no video, and did nothing before hydration) and a nit (a
    weak focus cue on white-bodied buttons over navy). All four were fixed in
    `2e1ff42`; five of six mutations go red, and the pre-hydration gate cannot
    be tested under jsdom. The first worker's five round-1 fixes are on top
    (see 38). _Ask:_ (a) land #3 at `b57e99b` on CI green, with no third
    round; or (b) a third round. _Pick:_ (a). Round 2 found nothing above
    minor, and every fix is bound by a test. Separately, the operator still
    owns: publishing migration release `ar0oXBIAAC0ARR2n`, after About's CTA
    in `ar0odRIAAC0ARR3x` is changed from "Contact" to "Hire Us". The wiring
    PR follows the publish and carries Homes' preview fix (williamson-homes#7).
    #5, the intake form, needs its own review after #3 lands.
    **Answered 2026-09-30: re-dispatch; #3 landed at b57e99b as eec070be.**

40. **OD7-P2, Williamson Construction is wired and serving; three calls
    before launch.** Landed 2026-09-30 by session
    `session_01TRyUVAryzCaxqiViHbw6XJ`:
    - williamson-construction-co#5, the `/join-the-team` intake, as
      `06ce6e0`.
    - williamson-construction-co#6, the wiring, as `e9ce75a`. It sets the
      `williamson-construction` repository, six `a11yRoutes`, Homes' preview
      `linkResolver` fix and #7's narrowed toolbar CSP.

    `main` CI is green. #6's a11y gate reported "0 violations across 8
    routes", and smoke passed 25. `https://williamson-construction-co.netlify.app`
    serves all 14 paths with a 200 (19:18Z); an unknown project slug answers
    404, and `/health` reads `"prismic":"ok"`.

    The operator published release `ar0oXBIAAC0ARR2n` at 18:50Z, confirmed
    from the connector and from the Content API master ref.

    #5's review: round 1 (three lenses) found two majors; round 2 (the fix
    commits) found nits only.
    - The a11y major, focus lost on a disabled submit, is fixed. Eight
      mutations each went red.
    - The lead-safety major is **not** fixed; it is (b) below.

    The three calls:
    - **(a) About's CTA.** The release went out before the label edit, so
      `ar0odRIAAC0ARR3x` (About Us), `cta_block`, first button, is live as
      "Contact". The capture says "Hire Us". A Migration API script, dry-run
      and correct, was refused by this session's permission classifier as a
      shared-resource write. _Ask:_ change that one label in the Prismic
      dashboard and publish, or allow a worker to stage it through the
      Migration API for you to publish. _Pick:_ the dashboard; it is one
      field.
    - **(b) The site-side Turnstile refusal in `/join-the-team`.** With
      `PUBLIC_TURNSTILE_SITE_KEY` set, a POST without a token gets a 400
      before it reaches central, so central never sees that lead. That
      covers JS off, `challenges.cloudflare.com` blocked, a host not on the
      widget, and a Cloudflare outage.
      - Central already keeps a tokenless submission: `spam_auto` on a
        `requireTurnstile` site (`src/forms/ingest.ts`), and a plain `new`
        row while the site is `building`.
      - `TurnstileWidget.svelte` documents the fleet as fail-open.
      - It is dormant today, because no sitekey is set.
      - Removing it was refused by the classifier as a security-test
        removal, so it was not changed.

      _Ask:_ (1) remove the refusal and let central classify; (2) keep it;
      or (3) keep it and send a screen-out beacon so refusals show in the
      cockpit. _Pick:_ (1), before the sitekey is set at launch.

    - **(c) Turnstile on the preview host.** "Site Forms 2"
      (`0x4AAAAAAD_aiDmsrlRAHq-V`) lists `williamson-construction.com`, and
      adding `williamson-construction-co.netlify.app` would take its last
      slot. _Ask:_ add the preview host, or not. _Pick:_ do not add it. Set
      the sitekey in Netlify's production context only, at cutover, so the
      preview never renders a widget that cannot mint a token for it; under
      (b)(2) that host would refuse every submission.

    Still open from item 7: D6 (the form stays held on the operator, and the
    row stays `building`) and D8 (Lato, `TODO(D8)`; **answered 2026-09-30 ~20:05Z: Reddoor's kit `noj4tji`, with `freight-sans-pro` and `freight-sans-pro-lights` added; see the plan's D8 line**, see the plan's D8 line). No live form was
    submitted.

    **Answered 2026-09-30 (operator):**
    - (a) "Use the Prismic MCP." Release `ar1q1BIAAG9QRYia` held the one
      label change, and the diff showed exactly one delta. It was published
      through the MCP, the Content API master ref returned "Hire Us", and a
      Netlify rebuild of `main` (ready 20:08Z) serves it on `/about-us`.
      There is still no Prismic → Netlify publish webhook, so a publish
      needs a manual rebuild until one is set.
      **Corrected 2026-10-01 18:58Z:** a Netlify build hook "Prismic publish"
      has existed since 2026-09-30 05:32Z and Prismic's webhook fires it; the
      operator triggered it and three deploys followed. Publishes rebuild.
    - (b) "Remove it and let central decide." Landed as
      williamson-construction-co#7 (`e15517e`). Putting the refusal back
      turns the new route test red.
    - (c) Turnstile runs on live sites only. The sitekey goes in Netlify's
      production context at cutover, and the preview host stays off the
      widget. Read through `CLOUDFLARE_PAT`: "Site Forms 2" lists
      `williamson-construction.com` (9 of 10 domains), and "Site Forms 3" has 3.

41. **Vida Legacy Foundation's first Maintenance report (new 2026-09-30).**
    Today's daily-reports run drafted VLF Maintenance 2026-09
    (`report_01M3SGR33D4JA5YHKKT3756XY2`, 16:00:48Z, 0 blockers [M]) and, two
    seconds later, sent VLF's Launch email and flipped the site to maintained
    [M, run 36740864230]. _Ask:_ (a) approve it as it is, a day after the
    launch email; or (b) leave it unsent and let October's report be the first.
    _Pick:_ (b) [I], since the launch email already carries the same evidence.
    Either way it is yours; no agent approves or sends.
    **Answered 2026-09-30 ~19:50Z: skip it. October is VLF's first
    Maintenance report.** The 2026-09 draft stays unsent; no agent sends it.
    **Revised 2026-10-01 ~00:20Z, after #1078:** VLF's row is
    `maintenance_freq = Quarterly` with no `maintenance_day` [M, live Turso], so
    withdrawing the 2026-09 draft (`completed_on` 2026-09-30) makes its next
    Maintenance report due **2026-12-30**, not in October. The operator chose
    to keep Quarterly and accept 12-30 as the first. **Yours:** press "Don't
    send" on that draft at `/s/vida-legacy-foundation` once #1078 is deployed.
    **Done 2026-10-01 01:03:47Z** on the operator's word ("don't send"), through
    the endpoint's own `withdrawReport` + `patchReportIfOpen` path:
    `withdrawn_at` stamped, `withdrawn_by = dashboard`; VLF's stored
    `next_maintenance_at` refreshed 2026-09-30 → 2026-12-30 [M].
42. **`PRISMIC_TOKEN_VIDA_LEGACY` is not set (🔴 secret).** fleet-prismic-drift
    (run 36704968338, `wrote=15 failed=0`) warns `[vida-legacy-foundation] no
write token for Prismic repository "vida-legacy"`. VLF went maintained
    today, so its drift is now read without a token. _Ask:_ mint the token and
    set the secret, per `prismic-models --fleet turso --tokens` (read-only
    checklist). No agent mints it.
    **Done 2026-09-30 ~21:28Z (#1076).** The operator supplied the token and
    approved setting this one secret. Before it was set, the same token
    answered 200 for `vida-legacy` and 403 for `revogen` on the custom-types
    API [M]; `gh secret list` then showed
    `PRISMIC_TOKEN_VIDA_LEGACY 2026-09-30T21:27:56Z`. #1076 adds the
    workflow's env line and the test. Proven on the PR branch (run
    36780192887): no token warning, VLF read as `vida-legacy` with 18 models
    matching, and `11 checked, 0 failed` against the morning's
    `10 checked, 1 failed` [M]. Tomorrow's 05:00 UTC run on `main` is the
    durable confirmation.
    **Confirmed on `main` 2026-10-01 [M, scheduled run 36854540795, 11:18Z]:**
    no token warning, `[vida-legacy-foundation] … repository: vida-legacy`,
    18 models match, `11 checked, 0 failed`, `FLEET_WRITE_SUMMARY wrote=15
failed=0 total=15`.
43. **#1055, no site in the fleet has a privacy policy** (filed 2026-09-30).
    GA4's terms require one, and design D4 of the fleet-analytics spec makes
    Reddoor the owner. It is a product and copy call (who writes the policy,
    one fleet template or per client), so it is not agent-ready. _Ask:_ say
    whether a starter-level privacy page, with a per-site data notice on each
    form, is the direction; then it becomes a P1 item.
    **Answered 2026-09-30 ~21:20Z: option A** (one starter `/privacy`
    template, per-site values, a footer link and a notice under each form).
    Built as P1-26. The wording is reviewed once by a lawyer before it reaches
    a client's live site (item 45). The consent question it leaves open is
    item 46.

44. **OD7-P1b / P2b, the Williamsons' fidelity pass (asked by the operator
    2026-09-30 ~20:15Z): not a decision, queued work.** The operator asked for
    a favicon on both sites and a much tighter match to the references,
    including hover states and scroll animations (the sticky numbering on
    Homes). Measured [M]: both sites ship the starter's favicon (md5
    `3a387408…`), and the reference icons are in each capture. Homes' reference
    has 12 sticky rules, driven by `countersAnim.js` (captured, 219 lines,
    jQuery), and 10 IX2 scroll-into-view events; the rebuild has neither.
    Construction's reference has 18 hover rules and click-only IX2. The briefs are
    in the plan (§7, "Phase 1b / 2b"). Start each one only when that repo's
    current worker has ended: at 20:17Z both were `WORKING`
    (`session_01UHJ28GGynFCzakmooVUj76` on Homes, at 707k of 1M context;
    `session_01TRyUVAryzCaxqiViHbw6XJ` on Construction).
    **Homes' worker ends with the PR that adds this line** (2026-09-30), with williamson-homes#9
    held for item 47. #9 builds a first scroll reveal for the steps; the
    reference's sticky numbering (`countersAnim.js`) replaces or extends it.
    Start Homes' P1b from whichever #9 head the operator merges.
    **Construction's P2b landed 2026-09-30** as williamson-construction-co#8
    (`205608d`), after item 52 was answered; see Done. Homes' P1b is what
    remains of this item.
    **Homes' P1b is williamson-homes#10 (2026-10-01), held after two review
    rounds; see item 53.
45. **Privacy policy wording (P1-26): one legal review of the template.**
    The template's text speaks for each client's business, and it discloses
    what the fleet actually does with visitor data. _Ask:_ send the draft in
    `reddoor-starter` (once P1-26 lands) to a lawyer once. Until then it stays
    marked DRAFT and goes to no client's live site. Also yours: whether clients
    hear about the page before it goes live (_pick:_ a line in their next
    Maintenance email, with the link).
46. **Analytics consent in California (revisits analytics design D3).** A
    privacy page cures CalOPPA and the GA terms, but not the CIPA exposure:
    the California wiretap and "trap and trace" demand letters aimed at
    analytics on ordinary business sites, at $5,000 per violation in
    statutory damages. That claim turns on consent, not disclosure. D3 chose no banner
    (`docs/superpowers/specs/2026-09-22-fleet-analytics-design.md:111`), and
    `initAnalytics` already takes an optional gate predicate, so the
    mechanism is cheap either way. _Ask:_ (a) keep D3 and accept the
    residual risk; (b) a light consent gate (GA4 loads only after an
    accept) on California clients' sites; (c) replace GA4 with a cookieless,
    first-party analytics that needs no consent. _Pick:_ put (b) or (c) to
    counsel alongside item 45, since the same review answers both. Not legal
    advice; the law here was moving through 2025–26.
47. **williamson-homes#9 (Homes visual polish): which head to merge.** Two
    adversarial rounds, and round 2 still found a real defect, so it stopped
    under "two dirty rounds". Round 1 (major: steps flickered at hydration;
    minors: an untested guard, hero height tied to slow zoom, footer insets)
    was fixed in `07cc956`. Round 2 on `07cc956` found no blocker or major.
    It did find that arriving by client navigation from a scrolled page lit
    every step, so the reveal never played (it errs toward showing content),
    plus three test gaps. `50d6154` fixes all of round 2, is unreviewed, and
    turns 9/9 mutations red. **Ask:** merge `50d6154`, merge `07cc956`, or send
    it back for a third review. **Pick: `50d6154`**; it is small, and every line
    is under a mutation that goes red. The PR comment has the detail.
    **Answered 2026-09-30 ~21:35Z: merge `50d6154`, no third round.** Merged
    22:27Z as `b9cc06c`, pinned to `50d6154` with CI green. Item 44's Homes P1b
    can start from it.
48. **Cockpit warnings, 2026-09-30: Beachfront Dentistry's Netlify ID.** The
    cockpit's watch "Netlify ID not recorded" [M, 21:30Z]. The Netlify API
    lists site `b36d3ca8-bdc1-4675-b002-5a6469cf5b9b` (`beachfront-dentistry-rd`,
    custom domain `beachfrontdentistry.com`, repo `reddoorla/beachfront-dentistry`)
    [M]. _Ask:_ approve writing that value to the row's `netlify_id`. _Pick:_
    yes; the 09-29 journal already showed the site is on Netlify and that
    accepting the condition would be the wrong fix. PR: `claude/cockpit-warnings-2026-09-30`.
    **Answered 2026-09-30 ~21:38Z: write it.** Written 21:40:52Z through
    `setSiteDetail`, NULL → that ID, read back [M].
49. **Cockpit warnings, 2026-09-30: four maintained sites without GA4.** 1836dig,
    29 Navy, Data Dynamiq and LA Homelessness Youth are on watch for "GA4
    property not recorded" [M]. None has a property that the reports account can
    see (13 properties listed; 500039567 "LA Youth Homelessness" is LAHI's, and
    its stream is on LAHI's domain; see the 09-29 journal). _Ask:_ for each site,
    (a) keep it on watch until it gets a property and a tag, which waits on
    P1-26 and items 45/46; or (b) accept `no analytics`. _Pick:_ (a) for all
    four. `no analytics` means the client runs its own analytics (design D8),
    and the analytics audit skips an opted-out site (`src/audits/analytics.ts:1395`).
    So a mute added now would stay behind unseen after a property lands.
    **Answered 2026-09-30 ~21:38Z:** Youth does not need GA, so `no analytics`
    was written 21:40:52Z (`["no custom domain"]` → `["no custom domain","no
analytics"]`). The operator creates properties for the other three. When the
    numeric property IDs arrive (not the `G-` measurement IDs), a session records
    each in `ga4_property_id` after confirming the reports account lists it. The
    tag install is separate and waits on P1-26.
    **Done 2026-10-01 01:03:49Z:** the operator gave 556936272 (1836dig),
    556907604 (29 Navy) and 556916505 (Data Dynamiq). Each is listed by the
    reports account ("1836 Dig", "29 Navy", "Data Dynamiq"), and each was written
    NULL → that ID through `setSiteDetail`, read back [M]. Only 1836dig's
    property has a web stream (`G-1ZYB95TKC1`, `https://1836dig.com/`); 29 Navy's
    and Data Dynamiq's have none yet, so they collect nothing until a stream and
    a tag exist (P1-26).
    **Streams created by the operator 2026-10-01 [M, Admin API ~01:20Z]:**
    1836dig `G-1ZYB95TKC1` (`https://1836dig.com/`), 29 Navy `G-MSYB9MQGRV`
    (`https://29navy.com/`), Data Dynamiq `G-V11LZYNMY2`
    (`https://www.datadynamiq.com/`). These are the measurement IDs that go in
    each repo's `src/lib/site-config.json` (design D5) when the tags are
    installed. That install is still P1-26's (privacy page first).
50. **Cockpit warnings, 2026-09-30: Reddoor's Prismic drift, one label.** The
    cockpit's only live-site attention item that has no ask yet [M]. The drift is
    `industry` → `Inquiry.inquiry_survey_id`, label and placeholder only
    (reddoor-website `f3dbd4a`, 09-17). Its commit says the Prismic side waits
    on an interactive Slice Machine push. The ack expired 08-30. _Ask:_ push
    `industry` from reddoor-website with Slice Machine (repo → Prismic). _Pick:_
    push; it is not destructive, and re-acking would hide a label that tells the
    client editor the field must not be blank.
    **Answered 2026-09-30 ~21:38Z: pushed by the operator.** Prismic's
    `inquiry_survey_id` now carries the repo's label [M, Prismic MCP]. The
    stored verdict read `fail` at 21:34:12Z, before the push, from dispatch 36780192887. The next prismic-drift run re-reads it.
    **Confirmed 2026-10-01 [M, scheduled run 36854540795, 11:18Z]:**
    `[reddoor] … repository: reddoor-la`, 25 models match Prismic, nothing
    to push.
51. **#1078 (P1-28, withdraw a report draft): land after two review rounds.**
    Round 1 (on `826dc0e9`) found a blocker (a withdrawn draft froze the
    schedule, since `nextDueDate` is based on the last send), a major
    (`launch`/`announce` reused a withdrawn row), a race and UI minors. All
    were fixed in `d4605b7b` (8411 tests; every named mutation red). Round 2
    on `d4605b7b` found no blocker or major. It found real minors: withdrawing
    an overdue draft advances only one cycle (about six clicks to catch up), a
    no-anchor site's shown next date can be a month off, and UI refusal labels.
    **Ask:** (a) one more commit that treats a withdrawal like a send for
    scheduling, plus the UI fixes, then land; (b) land `d4605b7b` as it is and
    file the minors; or (c) a third round after (a). **Pick: (a)**; VLF is due
    2026-10-30 under either rule. Detail: the #1078 comment.
    **Answered 2026-09-30 ~23:35Z: (a).** Folded in as `8affbff8`: the base
    is the later of the last send and the latest withdrawn draft's
    `completed_on` (the draft day, not the click), so an overdue site catches up
    in one step. No third round. 8426 tests; every named mutation red. Landed
    2026-10-01 00:19Z as `57f5049d` (#1078, head `cb68a2d9`). The "VLF 10-30"
    line above was wrong: VLF is Quarterly, so it is 12-30 (see item 41).

52. **williamson-construction-co#8 (Construction fidelity, OD7-P2b): round 2
    found minors, so the merge is yours.** The PR ships:
    - the reference's favicon and apple-touch-icon;
    - `freight-sans-pro` / `-lights` from kit `noj4tji`, loaded in CI and on
      the deploy preview [M];
    - every reference hover, measured in Chromium on the capture;
    - the IX2 mobile menu, a white panel sliding from -15rem, replacing the
      blue dialog.

    `src/hover-rules.test.ts` pins all 18 `:hover` rules and the IX2 click
    targets. 11 mutations each turned a test red. The head is `a7acae5`: CI
    green, 743 unit tests, 55 Playwright tests, axe 0 violations across 8
    routes.

    Round 1 (three lenses) found three majors, all fixed in `44c96d1` and
    `a7acae5`:
    - the panel never slid (the `translate` vs `transform` property);
    - Tab could land in the closing panel, or on a control under the open one;
    - the menu icon returned 700ms early.

    Round 2 found no major, but it did find two minors and two nits:
    - (i) Any click or tap on the page closes the open menu, because `<main
tabindex="-1">` takes focus. The code and its test meant to keep it
      open, and the LEDGER does not record it.
    - (ii) The "not under the panel" half of the Tab test can never fail,
      because `elementFromPoint` skips `inert`.
    - (iii) A phase with no anchor still fades on hover.
    - (iv) The plan shapes use Tailwind's default easing where the reference
      uses `ease`.

    Each is a line or two. _Ask:_ (a) fix all four at the current head and
    land without a third review; (b) land `a7acae5` as it is and file the
    four; or (c) a third round. _Pick:_ (a). For (i), my pick is to keep
    "a page click closes the menu", which is better on a phone, and ledger it
    as a deviation rather than suppress it.

    **Also yours, from the same brief.** "The matching gate passes" cannot be
    shown from a cloud session. `gate.sh` needs the laptop-only
    `matching-a-page` skill (`page-diff.mjs`). Construction also has no
    `matching/SPEC.md`: Phase 1 was never done, so the gate refuses the page.
    There is no mask, floor or declared deviation, so nothing is unledgered.
    _Ask:_ run Phase 1 and the gate from the laptop, or drop that done-when
    for P2b. _Pick:_ drop it for P2b, and make Phase 1 its own item if you
    want the pixel gate on this site.

    **Answered 2026-09-30 ~23:45Z (operator): (a) fix all four and land.**
    Fixed in `903fe79`: (i) kept and pinned by a test and a LEDGER line;
    (ii) replaced by a rect-overlap check, shown to fail on a panel left
    painted; (iii) and (iv) each tested and mutated. Landed with `land-prs`
    pinned to `903fe79`, CI green, as `205608d`. The proxy refused the branch
    delete, so `claude/od7-p2b-fidelity` is still on GitHub. **The gate
    question above is still open.**

    **Gate question answered 2026-10-01 (worker, cloud): it runs, and it is
    proven.** Both blockers were setup. The skill is a `claude-skills`
    clone with `MATCHING_SKILL_DIR` set, and Phase 1 is now done for all 14
    pages (williamson-construction-co#9). On the reference itself (the apex
    host) the gate printed 14/14 pages, 165 regions, 0 FAIL. The negative
    control failed at 52–74%. The merge of #9 is decision 58 (landed as
    "55"; renumbered by the 10-01 12:00Z PM pass, see the note above 57).

53. **roalson-interests#242 (MarkUp: "Improved Projects" tab matches Land):
    held after two dirty review rounds.** Under its own tab Improved now has
    Land's off-white ground, 40px strip, unpinned divider and sand cards, with
    and without script. Round 1 found two majors: the cards were cream on a
    cream ground, and the no-JS map offset was 145.4 instead of 100. Round 2
    found a stale unit-test string and the carousel's photo-less box left
    sand. All of it is fixed at `48e1c11`, and CI is green.
    deploy-preview-242 on real listings reads identically to Land: card
    234/231/228, photo box 243/241/239, heading 51px under the tabs.
    _Ask:_ (a) land without a third round; (b) a third round. _Pick:_ (a).
    Then resolve pin `2b18dce4` with "fixed in <sha>".
    **Answered 2026-10-01 ~04:10Z (operator, "land what you can"):** landed
    `5e47eeb`; on the live site Improved reads identically to Land; pin
    resolved.
54. **roalson-interests#243 (MarkUp: "the map bounces when I click a point")
    reopens roalson-interests#136.** #136 was closed 09-28 with "keep the
    three flights … reopen only if someone reports the press as janky", and
    Nicole's pin is that report. The fix:
    - The camera flies straight to the pressed listing: IH-35 was
      `[potranco-road, ih-35]` and is now `[ih-35]`.
    - `active` still comes only from the viewport centre.
    - Reproduced red on origin/main, 8 mutations red, and one review round
      clean apart from a reduced-motion guard (folded in, `ce12414`).

    _Ask:_ land it, or keep the three flights. _Pick:_ land. Then resolve
    pin `f4be21e8`.
    **Answered 2026-10-01 (operator, "land what you can"):** landed `195a798`
    (live build 04:58:32Z); pin resolved; noted on #136.

55. **Roalson MarkUp pins left open (questions, not fixes).**
    - (i) **Homepage #4**, Nicole to Erik: keep the featured band's
      PROPERTIES button? _Pick:_ keep it. It is the band's only route to the
      full list.
    - (ii) **Homepage #3**, "Drop down back color to 20% opacity": no
      dropdown exists. In Nicole's screenshots the homepage map never drew
      tiles, so she saw a solid maroon box. _Pick:_ ask Nicole which element
      she means, and check whether the map tiles load on her browser, which
      could be blocked by an extension or a network.
    - (iii) **Properties #3**: is the property package an arrow or a
      download? _Pick:_ a download glyph with the `download` attribute, since
      it is a PDF. Whether it opens in a viewer stays the browser's choice.
    - **Answered (operator, 2026-10-01):** (iii) download. It landed as
      roalson-interests#245 (`72fa1c0`). A bare `download` attribute is
      ignored on the cross-origin CDN link, so a press now fetches and saves
      the PDF. Verified on the live site, and the pin is resolved.
    - (ii) **Still open.** The operator reads it as "bring the colour back",
      not a dropdown. Which colour, and over what (the map tint, the
      featured card ground, or the dark strip under the bar), is the
      operator's to name; then it is a one-line change at 20%.
    - (i) **Answered (operator, 2026-10-01):** remove it; an ALL circle sits
      beside the controls instead (roalson-interests#248).
    - (ii) **Answered (operator):** the progress bar's unfilled track at 20%
      (roalson-interests#246). All 12 pins are resolved.

---

> Two items carry the number 53 (PM pass 2026-10-01): this one is Homes
> (#1087, #1089, #1091); the one above is Roalson (#1092). Numbers are left as
> landed because PR titles cite them; new items continue from 57.

53. **williamson-homes#10 (Homes fidelity, OD7-P1b): answered 2026-10-01 and
    landed as `5ec2ddd` (head `bde334a`).** The operator chose a third review.
    It was dirty: the fixed header box covered the sticky bar, so it could not
    be clicked, plus two minors. All three were fixed with tests shown red
    first, and the operator then approved the merge.

    The calls the PR raised:
    - (i) Accessibility wins on hover.
    - (ii) The 17 census rows are accepted and declared as exact rows.
      `census.sh home` exits 0.

    **Still yours, from (iii):** push the ProcessSteps and PageHero slice
    models from Slice Machine. Prismic has neither `step_height` (this PR)
    nor PageHero's `height` (#9). The prismic-ci rollout cannot run from a
    cloud session: the proxy hides the Actions secrets API, and the recipe
    refuses when it cannot confirm `PRISMIC_WRITE_TOKEN`. Once the models
    are pushed, an agent sets `step_height: tall` on about-us's
    "Collaborative approach" ProcessSteps slice through the Prismic
    connector. The operator has asked for that edit.
    **Done 2026-10-01 [M]:**
    - The operator pushed both models from Slice Machine.
    - The edit went through the Prismic release "About Us: tall
      collaborative-approach steps", and the operator published it.
    - The publish webhook rebuilt the site. At 02:28:21Z,
      `curl …/about-us | grep -c 'md:min-h-\[40rem\]'` returned 1.
    - Nothing in (iii) is open. The question of how models should reach
      Prismic in the first place is #1090.

> Relabelled by the 10-01 12:00Z PM pass. #1090's item below had landed as
> "54", although P1-29 and the 03:36Z report already cite it as **57**.
> Construction's #9 had landed as a second "55" (#1095, and that session's
> journal entry); it is **58** now. Prettier numbers an ordered list from its
> first item, so this note breaks the list to keep both labels. Next new item: 63
> (59–62 added 2026-10-01 for Mantis Landscaping, #1107).

57. **#1090, how models reach Prismic (new 2026-10-01).** After P1-29's
    write-up: pick the route that replaces or supplements Slice Machine in the
    starters and in `prismic-models`/`prismic-ci`, including type generation
    (`prismicio-types.d.ts`) and the generated slice index. Not an ask until
    P1-29 lands; listed so the PM pass carries it.
    **First fact, 10-01 11:53Z [M, `npm view slice-machine-ui deprecated`]:**
    npm marks `slice-machine-ui` (2.21.6, modified 2026-09-18) deprecated:
    "Slice Machine is replaced by the Prismic CLI and the Type Builder.
    Existing projects are still supported." The same check on
    `@prismicio/client` (7.22.1) prints no deprecation, so the check can say
    no. This is one source; P1-29 still owes the second and the options.
    **P1-29 landed 2026-10-01** (`docs/prismic-model-management-2026-10.md`):
    deprecated since 2026-09-18 by npm, Prismic's docs, the slice-machine
    README and the new CLI's own migration code; Prismic's route is the Type
    Builder plus the `prismic` CLI, whose `push` and `pull` both delete to
    match. _Pick:_ A now, B next: roll `prismic-ci` to williamson-homes (and
    every Prismic site without it), then swap `slice-machine-ui` for
    `prismic gen` in the starters behind our own gate, never `prismic init`
    or `prismic push`.
    **Superseded by the operator's ask (10-01 17:00Z): migrate the whole
    fleet.** Plan and estimate: `docs/prismic-migration-plan-2026-10.md`
    (21 repos, 18 Prismic repositories, about 3½ h of operator time over
    two weeks). _Ask:_ D1–D3 there (Type Builder source of truth, delivery
    tool, generated-file layout); recommended (a), keep `prismic-models`,
    Prismic's layout.
    **Answered 2026-10-01 ~17:25Z: "taking all your recommendations go for
    it"** — D1 (a) Type Builder on with a nightly pull-sync PR, D2 keep
    `prismic-models` + `prismic-ci`, D3 Prismic's file layout. Pilot is
    reddoor-website#235. Phase 1 needs, from the laptop, for each of
    alamo-anatomy, hedloc, reddoor-website, the-pointe-burbank,
    the-tower-burbank, vida-legacy-foundation, williamson-homes: mint a
    Custom Types write token (🔴), `gh secret set PRISMIC_WRITE_TOKEN --repo
reddoorla/<repo>`, then `reddoor-maint prismic-ci <repo>`. The recipe
    refuses from a cloud session by design (secrets API).
    **10-04: #1113 lifts that.** `prismic-ci` now runs from a cloud session.
    The install PR's own dry job proves the token reads the models, and PR
    listing and creation are REST-only. Phase 1's seven runs can come from
    the cloud. The operator still mints and sets each token.
    **Phase 1, 2026-10-01 18:50Z (laptop worker): 4 of 7 done.**
    `prismic-models.yml` is on `main` in alamo-anatomy (#62), hedloc (#52),
    the-pointe-burbank (#41) and williamson-homes (#14). Five of the seven
    repos already held `PRISMIC_WRITE_TOKEN` (four since 2026-08-14,
    williamson-homes since 09-30), so two tokens are owed, not seven.
    - _Ask (a), 🔴:_ mint a Custom Types write token and set
      `PRISMIC_WRITE_TOKEN` for **the-tower-burbank** (Prismic repository
      `the-tower-burbank`) and **vida-legacy-foundation** (`vida-legacy`).
      Then `reddoor-maint prismic-ci <a fresh clone>` for each. The central
      `PRISMIC_TOKEN_THE_TOWER_BURBANK` is absent as well; its `env:` line
      already exists.
    - _Ask (b):_ reddoor-website was skipped, because reddoor-website#237
      (staging → main, opened 18:19Z) touches `.github/workflows`. Its secret
      has existed since 08-14. The recipe can only open its PR against `main`,
      since the apply job guards `refs/heads/main`, so `--base staging` does
      not apply. _Pick:_ run it against `main` once #237 has merged.
    - _Ask (c):_ a PR that adds only the workflow never runs the `dry` job
      (the path filter), so none of the four got a model-delta comment and
      nothing has yet exercised a site's own secret. A local read with the
      central tokens found alamo-anatomy (6), hedloc (8) and
      the-pointe-burbank (35) in sync. williamson-homes has no token on the
      laptop: the review read its ids through the Prismic connector and they
      match (3 types, 20 slices), but its fields are unmeasured.
      _Pick:_ one throwaway PR per site that reformats a model file and is
      closed unmerged, as caltex-landing was proven on 08-16.
    - Not an ask: the nightly sweeps only `reddoor` and
      `vida-legacy-foundation` of the seven, and both read "match" on 10-01.
      The other five are `launching` (alamo-anatomy, hedloc) or `building`
      (the two Burbank sites, williamson-homes), which the sweep excludes by
      design. The Williamson Homes row also has a null `git_repo`.
58. **williamson-construction-co#9 (Construction matching gate, Phase 1 for
    14 pages): held after two dirty review rounds.**
    - Round 1 found four majors, fixed in `7db29f3`:
      - slides clipped content (and a focusable See More) at 390;
      - the testimonials clipped;
      - the dots were 2.62:1;
      - the census declarations never read the candidate.
    - Round 2 found one verified major: the slider controls row sat over the
      tallest phase slide's See More at 390 and took its clicks. It also
      found that the `max-[991px]` variants missed Webflow's inclusive 991,
      767 and 479.
    - Both are fixed in `106d06e`, and nobody has reviewed that head.
    - Gate r7 (`7db29f3`, cold server): 8 of 14 pages PASS. Every failing
      region is a LEDGER line: the font kit's wrap, the accessible form's
      extra height, slides that grow rather than clip, the photo pipeline,
      and an empty reference paragraph.

    The head is `f25cfb9` (`106d06e` plus LEDGER and journal lines), and CI is green on `106d06e`.
    _Ask:_ (a) land it as it is; or (b) a third review round first.
    _Pick:_ (a). The round-2 fix is pinned by `slider-content.spec.ts`'s
    "no slide link under a control" check at three widths, and M18 and M19
    each turn it red.

    Optional calls, not blocking:
    - (c) Prismic slice variations instead of the structural `:has(+ …)`
      picks. They are content edits in four documents.
    - (d) Typographic quotes in the testimonial content.
    - (e) The reference's empty 45px paragraph on Providence Hospital. Pick
      for both: leave them.

    **Answered 2026-10-01 (operator, "land it"):** landed as `2ee22e8`
    (head `f25cfb9`, CI green, `land-prs`). Branch
    `claude/matching-gate-phase1` is still on GitHub; the proxy refuses the
    delete.

    **Answered 2026-10-01 15:27Z (operator): (a).** The operator merged #9 at
    `f25cfb9` as `2ee22e8`, with no third review round. (c)–(e) were not
    taken up, so they stay as they are.

59. **Mantis Landscaping: which starter (#1107, plan
    `docs/mantis-landscaping-plan-2026-10.md`).** The operator asked for
    the "reddoor stack" and for improvements. The repo's `blux` pipeline
    renders only on `reddoor-starter-blux`: its `emit` and `catalog` write
    `blux_*` slice ids [M]. The pipeline has been dormant since July, and
    its last consumer, the-pointe, is archived.
    _Ask:_ pick one.
    - (a) **Native `reddoor-starter`**, using `blux convert` only to
      extract content, assets and theme tokens, and seeding about seven
      native slices from that.
    - (b) **The Blux track:** `blux convert/emit/migrate` onto
      `reddoor-starter-blux`. This is the fastest faithful copy, and the
      hardest to improve afterwards.
    - (c) Native, hand-seeded without the pipeline.

    _Pick:_ (a). There are 6 pages, about 30 text blocks and 89 images, so
    a native build is bounded. The improvements in plan §4 are
    native-starter work either way, and the site does not inherit a render
    layer that no CI exercises.

    **Answered 2026-10-01 ~18:00Z (operator, "I'll take your picks"): (a),
    native.** The operator generated the repo from `reddoor-starter`, first
    as `tucksravin/mantis-landscaping` and then transferred to the org; it
    is now `reddoorla/mantis-landscaping`. P0 is
    reddoorla/mantis-landscaping#1.

60. **Mantis Landscaping: the Blux export, and when Blux may be cancelled
    (#1107).** `blux catalog/convert` need the dashboard export
    (`site.json` plus each page's `index.html`). The live site does not
    serve `site.json` (404 at three paths [M]). The export also holds the
    projects feed's unpublished items 2–4 and Blux's form settings, which
    is where the contact form delivers today (plan R2, R4).
    _Ask:_ (i) download the Mantis export from the Blux dashboard (or ask
    whoever holds the Blux login) and attach it to #1107 or drop it in the
    session; (ii) keep the Blux site paid until 14 days after the DNS
    cutover.
    _Pick:_ (i) yes, now; (ii) yes. Blux serving is the rollback until then.

    **Answered 2026-10-01 (operator): (i) and (ii) yes.** The export
    arrived at ~18:13Z, and the operator still holds the Blux account. On
    the export [M]:
    - `blux convert` reports all 3 pages "FAITHFUL": 17 bands, 5
      low-confidence blocks.
    - It does not read the `projects` collection.
    - It resolves only 2 of the 89 images the live pages use, with or
      without `--probe`. So the seed uploads from the planning capture,
      checked against `captures/mantis-landscaping/manifest.json`.
    - The collection has 6 items. Three are disabled drafts (Urban
      Farming, Vertical Gardens, Wood Work), at 8–11.5K characters each.
    - The export names no form recipient. Its account email is an
      `@mantislandscaping.com` address [I: probably where Blux delivers].

61. **Mantis Landscaping: client facts, as one message for Nicole (#1107).**
    No agent contacts the client. The answers unblock P1-30's P4 and P6.
    1. The contact-form recipient. Today's is unknown, and leads may
       already be going to an unread inbox.
    2. Who holds the Squarespace Domains account. RDAP shows only the
       registrar, Squarespace Domains II LLC; the domain expires 2027-05-09
       [M]. Who will change the apex `A` and the `www` `CNAME` at cutover?
       Google Workspace mail (MX, SPF) stays untouched.
    3. Apex or `www` as the one host. _Pick:_ the apex, which is what
       people type.
    4. `/ediblegardens` and `/projects/ediblegardens` are near-duplicates
       (43 shared images; the first has 8 more). Which URL stays? _Pick:_
       `/projects/edible-gardens`, as the fuller page, with 301s from both
       old paths.
    5. The "Pest control / IPM" and "Consulting" cards link to 404s. Supply
       pages for them, or drop the cards? _Pick:_ drop them until there is
       content.
    6. Keep the Mailchimp newsletter? _Pick:_ yes.
    7. Are the Noun Project icons licensed (plan R5)?
    8. The report cadence once maintained. _Pick:_ Maintenance Quarterly,
       Testing Yearly [I: what a six-page brochure site needs].
    9. Who signs off the alt text and meta descriptions we draft? _Pick:_
       Nicole.

    **Answered 2026-10-01 (operator): the picks stand for 3–6, 8 and 9.**
    The operator sent the message to Nicole, and 1, 2 and 7 are waiting on
    her answers. Whether to publish the three draft projects (see 60) is
    added to her questions. Until she answers, they stay out, which
    matches pick 5.

62. **Mantis Landscaping: improvements that change how the site looks or
    reads (#1107, plan §4).** The safe defaults need no sign-off: one host
    with 301s, `robots.txt`, labels and heading order, `alt` text, the
    fleet form route with Turnstile, and redirects for the dead links.
    _Ask:_ approve each of the following, or strike it.
    - (a) Darken the gold to pass contrast. It measures 1.76:1 on the
      contact form's Submit and 1.91:1 under white headings [M].
    - (b) Fold the duplicate edible-gardens page (OD 61.4).
    - (c) Meta descriptions on every page; none exist today.
    - (d) A native newsletter signup in place of Mailchimp's embed.
    - (e) GA4 via `analytics-tag`. This makes the parked `/privacy` page
      (P1-26) a launch dependency.

    _Pick:_ (a)–(d) yes. (e) only once P1-26 is un-parked; until then the
    site launches without GA4, as it runs today.

    **Answered 2026-10-01 (operator): (a)–(d) yes, (e) held.**

63. **Background video: self-host from Prismic, Vimeo stays for content
    videos (answered 2026-10-01; rollout is the open half).** The operator
    asked "can we do better on video quality" on Williamson Construction and
    then "Vimeo or roll our own?" The research is the 2026-10-01 journal
    entry "Vimeo or our own player"; the short form:
    - Measured: a Vimeo background embed is 20 requests, ~440 KB of player
      and three Cloudflare cookies before a frame; a `<video>` is one request
      and none. Vimeo's docs list `__cf_bm`, `_cfuvid` and `cf_clearance` as
      essential on every plan, so the 06-29 belief that a higher tier removes
      the Best Practices deduction was wrong. Our Vimeo path is 930 lines of
      workaround (interaction gating, iOS heartbeat, bot-detection carve-out)
      against 188 for `BgVideo`, and has no pause control.
    - Traffic (GA, 90 days to 09-30): the busiest video site's home page has
      ~630 views a month (Revogen), so Prismic Starter's 100 GB/month is an
      order of magnitude away even unoptimised. Prismic's file CDN supports
      byte ranges, so playback starts before the file finishes.
    - **Operator's answers:** most sites are on Prismic Starter; traffic is
      small; the Vimeo subscription stays for other uses; the operator owns
      the videos but clients may swap one in Prismic; a dumb file CDN is
      acceptable if ever needed; Williamson Construction first, then the
      eight Vimeo sites if it goes well.
    - **Landed:** williamson-construction-co#13 (`BgVideo` plays only near
      the viewport, pauses off screen, phone rendition via
      `<source media>`; `video_mp4_mobile` field pushed to Prismic). HD
      encodes from the Dropbox masters are staged on a Netlify draft deploy;
      three posters are in Prismic. #12 (an Actions job that uploads to the
      Asset API, because the connector refuses video) went through two dirty
      review rounds; the operator chose a third.
    - **Hand-off:** the content half and the fleet follow-ups moved to their
      own session on 2026-10-01 with `docs/briefs/2026-10-01-williamson-video-hd.md`.
      The encode recipe `reddoor-maint video` sits unreviewed on
      `claude/video-encode-command`.

    - **Content landed (2026-10-01, content session):** 18 HD files in the
      library via `prismic-media-upload.yml` (run 36909548005, 17 uploads;
      the scan webm was already there, md5-matched), release
      `ar6sFBIAABZvSIhQ` with 21 deltas published at 19:05Z, the build hook
      rebuilt production by 19:06Z. The recipe is #1116; the site's record
      is williamson-construction-co#16.

    _Goes well when_, read on production 2026-10-01/04 [M]: Best Practices
    100 on the dev fixtures route (lhci, desktop preset) and 100 on
    production home; the hero playing with no interaction in every run
    (phone mp4 at 390px, 1080 webm at 1440px, 5.6–6.8 s in at the 8 s
    mark); home at 390px 1.30 / 1.52 / 1.49 MB of video in 8 s unscrolled,
    counted on the wire from CDP, against the 3 MB line; zero console
    errors and no Vimeo frame on four loads. Two readings outside the line
    that the home figure hides: about-us at 390px downloads 5.9 MB (the
    20 s first-day phone mp4 is 6.0 MB and Chromium takes it whole) and
    services 6.4 MB of its 10.8 MB phone file. That is the recipe's phone
    cap (`-maxrate 2200k`), not the player, and it is the number to set
    before the eight Vimeo sites get long clips. _Ask:_ roll `BgVideo` to
    the eight Vimeo sites as each is touched, or leave them; and whether
    the phone cap should come down (1200k would put a 20 s clip near 3 MB)
    before the first rollout. _Pick:_ roll, site by site, never as a sweep;
    lower the cap in the recipe first and re-encode Williamson's two long
    clips with it, one `reddoor-maint video` run each and a six-field
    rewire.

64. **Mantis P2a (reddoorla/mantis-landscaping#3): two dirty review rounds
    (new 2026-10-04).** #3 is the content model, seven new slices,
    `/projects/[uid]` and the edible-gardens 301s. CI is green on its first
    head, `00339cd`, and the second head, `6d2bb66`, carries round 1's
    fixes. Under CLAUDE.md's two-round rule it stops here, and so does
    everything after it in P1-30, because P2b, P4 and P5 build on this
    model.
    - **Round 1** (3 lenses, on `00339cd`) found one blocker and six
      majors. All are fixed in `6d2bb66`:
      - photos with a blank alt rendered no `alt` attribute;
      - the redirect hook read `url.search` while prerendering, and there
        was no `netlify.toml` 301;
      - Document links rendered `href=""`, because the client is
        routes-free;
      - four slices used the legacy `items` zone;
      - focus outlines were invisible on the dark bands;
      - the scrims over photos were too light;
      - the project "How it Works" band was recoloured when it did not
        need to be;
      - heading levels were left to the editor;
      - two mutations survived (a dropped `context`, and a wrong project
        `linkResolver`). Both are red now.
    - **Round 2** (on `6d2bb66`). Correctness found no blocker. It found:
      - `href=""` still renders in the starter's Hero, CtaBanner and
        SectionGrid;
      - ServiceCards, FeatureTrio and Steps render empty bands when their
        group is empty;
      - the orderings are untested.

      Accessibility found:
      - **a single-photo case-study strip still overflows sideways from
        768 to about 1022px with no tab stop**, so axe reports
        `scrollable-region-focusable` (serious) at tablet widths. This is
        the real defect that triggers the rule;
      - the ProjectList kicker (13px) sits at about 3.2–3.4:1 on the
        gradient over a white photo;
      - the white inset focus ring on the photo strip can vanish on a
        bright photo;
      - TextBlock headings still allow h1.

      Tests and models found no blocker, and the models are safe to push.
      Five behaviours have no test that goes red:
      - the orderings;
      - the project meta fallbacks;
      - `SiteLink`'s `target`/`rel`;
      - the `building` guard;
      - `site-pages.test.ts`, which cannot see fields inside primary
        groups.

      The full round-2 list is in a comment on #3.

    - **Ask:** (a) let a worker take a third round on #3, limited to the
      round-2 list above, then land it; (b) take the PR over by hand; or
      (c) re-scope (for example, drop the scrolling photo strip for a
      static grid). _Pick:_ (a). Every round-2 finding is local to one
      file, none questions the model or the design, and the model is still
      unpushed, so nothing in Prismic depends on it yet.
    - **Waiting behind it** (all on branches, no PRs):
      - the P2b seed content for all five documents, with alt text on all
        74 photos, on `claude/p2b-seed-draft` (`050eb7f`), stacked on #3;
      - the seed script, the model push, the placeholder swap, P4 and P5.
    - **No laptop step any more:** #1117 (`2c5d9f1`) runs `prismic-ci`
      from a cloud session. Once #3 lands and the placeholder is replaced,
      the next worker runs it. If the install PR's `prismic-models` check
      goes red on a missing `PRISMIC_WRITE_TOKEN`, setting that secret on
      the site repo is the operator's.
    - **Name mismatch:** the session's Prismic write token is in the
      environment as `MANTIS_LANDSCAPING_PRISMIC`, not the brief's
      `MANTIS_PRISMIC`. It answers 200 on the Custom Types API (`[]`, no
      types yet), and a bogus token gets 403.
    - **Hazard:** the environment also holds a generic
      `PRISMIC_WRITE_TOKEN` for `the-pointe-burbank`. A
      `prismic-models --apply` run without
      `PRISMIC_TOKEN_MANTIS_LANDSCAPING` set falls back to it.

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

- 2026-10-01 — P1-23, `launch` scores the live site, not the checkout:
  #1056. `launch` resolves its site from a local path, which never carries
  `deployedUrl`, so Lighthouse scored the checkout's dev server. It now looks
  up the row, refuses a url that is not http(s), runs dev-guard (whose
  `/health` control proves the url answers) before the audit, and audits with
  `deployedUrl` set to the row's url; a failed live audit stops the chain
  rather than falling back. Two review rounds (round 1 test gaps, round 2
  clean), 12 mutations all red. Correction to the item: the go-live email
  renders no Lighthouse; the scores land in `site_health` and on the Launch
  report row.

- 2026-10-01 — `roster-urls` retries a transport error once before writing
  a fail: #1103, #1106. MSOT's 10-01 `error: TimeoutError` was a blip (the
  same run's other checks passed; 200 three of three an hour later). A row
  with no HTTP answer is re-read after a 25 s pause and the second read is
  the verdict; HTTP answers and both controls keep one read. `retried=N` on
  `ROSTER_URL_SUMMARY`. 14 mutations all red; review round 1 four test gaps,
  round 2 clean. The 10-minute step outgrows the retry at about 108 rows.

- 2026-10-01 — P1-29, how Prismic wants models managed (#1090, research):
  `docs/prismic-model-management-2026-10.md`. Slice Machine is deprecated
  (four sources, negative control on `@prismicio/client`), replaced by the
  Type Builder and the `prismic` CLI. Options A–D against today's three
  routes; the pick is under Operator decisions 57.

- 2026-10-01 — Operator rule: a Testing report sent within a month of a
  Maintenance due date pushes Maintenance back one cycle: #1099, `4bfc2fc`.
  `pushPastTesting` in `src/reports/due.ts`; measured from the later of the
  due date and the Testing report, re-checked, each Testing report pushes
  once, approved-unsent Testing counts for 3 days. Two review rounds (round 1
  two majors, round 2 clean), 13 mutations all red. Sonder Maintenance moved
  10-01 → 11-01 before that day's run.

- 2026-10-01 — P1-28, withdraw a report draft the operator decided not to
  send: #1078, `57f5049d`. "Don't send" on `/s/<slug>`
  (`POST /api/reports/:id/withdraw`, migrations 0038–0039). A withdrawn draft
  leaves every pending list, can never be approved or sent, and its cycle
  counts as used from the day it was drafted. Two review rounds plus an
  operator-chosen fold-in (item 51).
- 2026-09-30 — OD7-P2b, Construction's fidelity pass (BACKLOG 44 and 52):
  williamson-construction-co#8, `205608d`. It ships:
  - the reference's favicon and apple-touch-icon;
  - `freight-sans-pro` / `-lights` from kit `noj4tji`;
  - every reference hover, measured on the capture;
  - the IX2 mobile menu.

  Two review rounds; the operator chose to land after fixing round 2's four
  findings. The matching-gate done-when is still an open question in 52.

- 2026-09-30 — P1-22 closed by measurement, not code: the first scheduled
  fleet-security run after #985 (run 36709631159, 11:37Z) printed
  `RULESET_BYPASS unread=0 read=28`. The reddoor-renovate token reads every
  bypass list, so P1-17's credential fork does not arise.

- 2026-09-30 — #948 (PR #1039, reddoor-starter#163): the a11y audit's axe scan
  runs on a production build it makes itself (`npm run build && npm run
preview`, `VITE_REDDOOR_GATE_FIXTURES=1`, probed on `/_app/version.json`),
  never on `vite dev`. The starter's `/dev` guard lets only that build serve
  the fixtures, and Netlify refuses the flag. Cold runs on roalson went from
  191/201/191/208/191 on dev to 208 in 12 of 14 on the preview; the residual
  race is the #947 item above. **Rollout:** each of the 25 site repos with the
  one-line guard needs its guard PR merged before it takes a
  `@reddoorla/maintenance` bump carrying #1039, or its a11y gate fails with a
  line naming the guard. Landed `f1ad1cec`. The 25 guard PRs merged on green
  2026-09-30 on the operator's go (reddoor-website#233 by merge commit; its
  ruleset allows only that): roalson-interests#219, williamson-construction-co#1, williamson-homes#4, vida-legacy-foundation#88, reddoor-website#233, reddoor-starter-blux#37, beachfront-dentistry#70, 29-navy#59, medical-solutions-of-texas#70, revogen#89, caltex-landing#68, erp-industrial#64, vineyard-custom-homes#70, espada#78, alamo-anatomy#61, 1836dig#23, data-dynamiq#56, the-pointe-burbank#40, gallerysonder#104, la-homelessness-initiative#48, canvas-starter#30, the-tower-burbank#27, composition-hospitality#36, la-homelessness-youth#28, hedloc#51.

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
