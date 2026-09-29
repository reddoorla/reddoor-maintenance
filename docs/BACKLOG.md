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

| #     | Item                                                                                                                                                                                                                                                                                                                                                                                                                       | Tier | Effort | Start here                                                                                           | Done when                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1-3  | **#912** remains: nothing checks that a roster `url` resolves. #889 (blank repo / Netlify ID) is done in #962                                                                                                                                                                                                                                                                                                              | 🟢   | M      | see "P1-3 start here" below this table                                                               | Names the-pointe-burbank (206-byte 404 = bogus-host fingerprint [M]), passes the `-rd` hosts     |
| P1-7  | **#910**: store the a11y route counts, not only the violation count                                                                                                                                                                                                                                                                                                                                                        | 🟢   | S–M    | `src/audits/a11y-fields.ts`, `src/db/migrations.ts`, `field-map.ts`, `site-row.ts`, `fleet-state.ts` | A 1-of-2-routes run reads differently from a 2-of-2 run, round-tripped through Turso             |
| P1-12 | `scripts/` drift: schedule `sync-configs --dry` as a weekly drift report (no workflow runs it [M])                                                                                                                                                                                                                                                                                                                         | 🟢   | S–M    | `.github/workflows/`                                                                                 | A weekly run posts drift to a tracking issue, with a positive control                            |
| P1-16 | Prospect audits: a run that throws after a paid stage stays `running` and stops counting after the 2 h stale window, so a deterministic post-spend bug can reach ~300 paid runs/day instead of 25. Mark such a row terminal (`failed`) so it counts for the full 24 h (#968 review)                                                                                                                                        | 🟢   | S–M    | `src/db/prospect-audits.ts`, `src/cli/commands/prospect-audit.ts`                                    | A post-spend throw holds its slot for 24 h; a pre-spend throw still releases it; mutation-tested |
| P1-17 | Protection audit: bypass actors on a non-default Renovate base branch are not judged, because `rules/branches/{b}` carries no bypass info. The preset's invariant (3) names this sweep as its instrument (#966 review)                                                                                                                                                                                                     | 🟢   | M      | `src/audits/protection-coverage.ts`, `src/github/gh.ts`                                              | A `staging` ruleset whose required check the Renovate App can bypass reads as a gap              |
| P1-19 | `search_found_page1 = 0` is still stored when no Search Console property matched (`src/reports/draft.ts:359`, `src/recipes/announce.ts:120`), while the evidence now says `unknown` (#959). Pairs with #943                                                                                                                                                                                                                | 🟢   | S      | as named                                                                                             | A no-property result stores NULL, not 0                                                          |
| P1-20 | Digest: a day whose pending set is unchanged still sends (`src/reports/digest.ts:563-660` skips only empty days and same-day duplicates); 09-18→09-28 repeated the same "29 Navy … health-gate (+4 more)" line for 11 days [M, mailbox]. Send on change (or weekly heartbeat), carry the age of a repeated item, and carry the exact ask ("set `Report recipients (To)` on `/s/29-navy`, then approve") linked to the cell | 🟢   | S–M    | `src/reports/digest.ts`, `tests/reports/digest*`                                                     | An unchanged pending set sends nothing; a repeated item shows its age and the concrete action    |

### P1-3 start here (#912)

The data is not stored. The browser audit's `uptime_reachable` covers
`maintained` sites only (`selectFleetSites`) and measures sampled routes, not
the roster URL, so it can never see a `building` site like the-pointe-burbank.

1. **A roster-URL pass over every non-archived row**, not `selectFleetSites`:
   for example a new `--only` audit in the `fleet-lighthouse` nightly.
2. **The next migration** (0029 is taken by #968's `claimed_at`) adding `url_resolves` (pass/fail), `url_status` and
   `url_checked_at`, plus `schema.ts`, `field-map.ts`, `fleet-state.ts` and the
   `WebsiteRow` fields.
3. **The Netlify 404 fingerprint**: status 404 with `server: Netlify`, proven
   against a bogus-host control (`no-such-site-zz9q.netlify.app` returns the
   same 206-byte page) and a known-good one (`the-tower-burbank-rd.netlify.app`).
4. **A surface for building sites.** They get no cockpit card
   (`isDashboardVisible`), so use a digest collector or an off-fleet lane, with
   an "expected, not deployed yet" accept key so the check stays two-sided.

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
- **#969**: a11y audit's `SpawnTimeoutError` kills Playwright's process group
  but orphans its `webServer` (the site's dev server). Filed from #950's review
  by the same session; its fix touches `src/audits/util/spawn.ts`. #972 (#960's
  flake fix) changed only `tests/audits/util/spawn.test.ts`, so the two no
  longer collide beyond that test file.

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
11. **#916** — still wanted: #950 removes none of what it catches, and it passes
    roalson-interests. In a fix round for 0.102.0, with a `reddoor-starter`
    palette fix staged beside it, because the starter's Hero would go red.
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
19. **P1-20, the digest (#975, parked after two dirty review rounds)** — pick
    how the digest decides what is news. It is green and full-suite clean, but
    round 2 found (a) an item that was mailed, fixed and then recurs stays
    silent until the weekly heartbeat, and (b) every send resets every item's
    baseline, so six jittering Lighthouse items sent on 20 of 28 simulated
    days. **My pick:** on every run, forget keys and ask parts no longer
    present, so a recurrence re-sends; keep a high-water baseline for keys
    that persist; compare health asks by field, not by status. That is about
    30 lines plus tests on `claude/digest-send-on-change`. Say "go" and a
    worker finishes it, or name another rule (e.g. "send on any NEW badge,
    ignore metric changes").

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
