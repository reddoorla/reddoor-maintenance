# Backlog — what to work on next, in order

**Last full re-rank: 2026-09-29 ~06:00Z** (cloud PM session, `claude/lucid-wozniak-wj8gaj`).
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
- **Status.** In progress in this session (branch `wip/alarms` → session PR).

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
- **Status.** In progress in this session (branch `wip/lahi` → session PR).

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

| #     | Item                                                                                                                                                                   | Tier | Effort | Start here                                                                                            | Done when                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | Land `land-prs.mjs`'s REST port (#953, adopted from orphaned `claude/happy-cerf-xb0xif`) so cloud sessions can use the landing gate                                    | 🟢   | S      | `scripts/land-prs.mjs`                                                                                | Merged. The first real cloud landing (e.g. #902/#896) is logged in the journal.                                                          |
| P1-2  | **#942**: a Search Console lookup that finds no property is recorded as `unknown`, not "fail: Not on page 1"                                                           | 🟢   | S      | `src/reports/auto-tick.ts:182-208`, `src/reports/draft.ts`, `src/reports/search/client.ts:226`        | `propertyFound:false` → `unknown` "No Search Console property matched this site"; mutation-tested both ways                              |
| P1-3  | **#889 + #912**: one "roster fields are valid" collector — maintained site with blank repo/Netlify ID; roster URL that 404s                                            | 🟢   | S–M    | a new collector beside the cockpit's alarm context (`src/dashboard/`), with the pre-launch exclusions | Names Beachfront (blank `netlify_id` [M]) and the-pointe-burbank (URL 404 = bogus-host fingerprint [M]) today, and passes a healthy site |
| P1-4  | **#941**: watch filter chips drop sites that also have an attention item                                                                                               | 🟢   | S      | `src/dashboard/fleet-cockpit.ts:164-180`                                                              | A site with one attention item and one watch condition carries both tags; tier stays `attention`                                         |
| P1-5  | Merge Renovate majors **#902** (`@types/mjml` v5: `index.d.ts` byte-identical [M]) and **#896** (upload-artifact v7: same SHA already in `daily-reports.yml` [M])      | 🟢   | S      | branches updated 2026-09-29                                                                           | Merged. Dispatch `fleet-db-backup` once and confirm the `turso-backup-<run_id>` artifact exists.                                         |
| P1-6  | **#892**: protection-audit judges the branch Renovate merges into, not only the default branch (reddoor-website `staging` has no required check)                       | 🟢   | S–M    | `src/audits/protection*`, `tests/audits/protection-coverage.test.ts`                                  | reddoor-website's `staging` shows as a gap. Applying the staging ruleset stays 🔴.                                                       |
| P1-7  | **#910**: store the a11y route counts, not only the violation count                                                                                                    | 🟢   | S–M    | `src/audits/a11y-fields.ts`, `src/db/migrations.ts`, `field-map.ts`, `site-row.ts`, `fleet-state.ts`  | A 1-of-2-routes run reads differently from a 2-of-2 run, round-tripped through Turso                                                     |
| P1-8  | **#907**: the prospect-audit daily cap binds before the spend                                                                                                          | 🟢   | M      | `src/db/prospect-audits.ts:27`, `src/dashboard/prospect-audit-trigger.ts`                             | N concurrent starts admit only cap − count; a crashed run frees its slot after the stale window                                          |
| P1-10 | **#874 (docs half)**: forward pointers on the three meta-week docs that still recommend deleting `FIGMA_PAT`                                                           | 🟢   | S      | `docs/meta-week/06-priorities-system.md:630`, `01-fleet-current-state.md:1409`, `_research/inv-07-…`  | Each carries a pointer to #874                                                                                                           |
| P1-11 | Tracking-issue bodies are never rewritten (S2 leftover): the issue body keeps the first failure's run URL forever (#895's body still named 09-21's run when it closed) | 🟢   | S      | the open steps in `.github/workflows/*.yml`                                                           | Body updated with `gh issue edit` on each failure                                                                                        |
| P1-12 | `scripts/` drift: schedule `sync-configs --dry` as a weekly drift report (no workflow runs it [M])                                                                     | 🟢   | S–M    | `.github/workflows/`                                                                                  | A weekly run posts drift to a tracking issue, with a positive control                                                                    |

### Blocked behind another PR (do not start early)

- **#905, #949** (a11y spec: missing-browser message, `addStyleTag` under strict
  CSP): both edit the spec that open PR **#950** (another session) rewrites. Wait
  for #950.
- **#947 (recipe half)**: `src/recipes/smoke-suite/template.ts:32` scaffolds
  `hydrationMarker: "footer"`, which cannot prove hydration. It is agent-ready,
  but pairs with #948's hydration-signal decision.
- **#921 persistence**: do it the #910 way once #918 merges.

---

## Operator decisions (🔴 or product calls — agents prepare, never do)

Ordered by what unblocks the most. Each line is the exact ask.

1. **LAHI 10-05** — approve P0-3's `n/a` semantics when its PR lands, including
   whether a maintained site on the placeholder Prismic sentinel also counts as
   "no CMS". Otherwise use the logged send-anyway override on 10-05.
2. **29 Navy** — set `Report recipients (To)`, press "refresh preview" on
   `/s/29-navy`, then approve.
3. **MSOT / Revogen recipients** — fix the cells before approving either report.
4. **Revogen GA4** — look up the numeric property ID in GA and set
   `ga4_property_id` (site editor), so its 10-05 report carries analytics (#921).
5. **Release PR #952** (0.100.1, the #944 changeset) — merge when you want it.
   It publishes to npm.
6. **Airtable residue** — PR #954 (another session, at your request, opened
   2026-09-29 05:52Z) removes the `settings.json` pre-approval and network allow
   and AUTONOMY.md's Airtable tiers, and keeps `AIRTABLE_PAT` by your choice.
   Not in #954: AUTONOMY.md still calls `settings.json` "local, gitignored"
   (false since #788), and its working loop names `docs/autonomy-journal.md`,
   which has had no row since 2026-09-09.
7. **Changesets v3** — #897 (action v2) and #901 (CLI v3) must land together as
   one hand-written PR, or be closed. Merged alone, #897 reds the release job on
   every push to main, and #901 publishes to npm while silently skipping the
   `v*` tag and GitHub Release, which leaves the match-harness snapshot guard
   comparing against v0.100.0 forever [M, upstream source]. Details:
   #955.
8. **#918 / #920** (GA4 tag mechanism + recipe) — their author stopped after
   four dirty review rounds with "the merge is yours". #918 is 16 behind main
   and predates #936's `no analytics` opt-out.
9. **#916 vs #950** — both rewrite the a11y spec and conflict. #916 would turn
   9 of 12 sampled sites red until their palettes are fixed. Pick the order.
10. **Cloud environment** — add `GA_SUBJECT`, `GA_SA_KEY_B64` and
    `PERPLEXITY_API_KEY`. Without them, cloud-drafted reports silently lack
    analytics [M].
11. **Google Maps keys (#754)** — add referrer and API restrictions to the three
    keys in GCP, then close the four alerts.
12. **Promotion authority (#623 → #545)** — pick identity A/B/C, apply the
    prepared staging ruleset, and promote reddoor-website `staging` → `main`.
13. **Renovate delivery (#898)** — pick among `prCreation: "immediate"`, a
    priority on the grouped rule, wider or staggered windows, and a separate App
    identity for `release.yml`. `renovate/pnpm-12.x` is rate-limited on #490 now.
14. **#779** — go-ahead for the form-e2e central widening. Seven maintained
    sites have no form end-to-end check [M].
15. **Standing product calls** — #943 (what "Search Console set up" means),
    #948 (hydration signal), #690 (pnpm pin questions), #672 (cockpit design),
    #674 (design-review tool), #711 (close into CLAUDE.md or scope one lint),
    #728 (beachfront `matching/`), #776 (confirm closed), and on the laptop,
    #773 (local-only git objects).

---

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

- 2026-09-29 — #895 time-travel red since 09-21: shallow checkout, not a clock
  (#951, `33c01b3`).
- 2026-09-29 — Closed as resolved, with evidence comments: #717 (every exposed
  host re-probed 404 or unpublished, with controls), #698 (the namespace went
  with #937/#940), #863 (fixed by #875).
- Meta-week S1–S7 all shipped by 09-14, including the sharp security wave
  (S1/A7). Airtable Phase 6 finished (#937, #940, #945). #646, #539 and #891
  are closed.
