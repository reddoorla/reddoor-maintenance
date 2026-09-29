# Morning brief — 2026-09-29 (overnight project-manager session)

## One-line verdict

[VERDICT]

Sixteen PRs landed overnight. Each passed an independent three-lens review and was landed by the repo's own head-SHA-gated script. The main results:
- the alarms that could not fire on a cancelled or hung run now can;
- LAHI's 10-05 report is unblocked;
- the prospect-audit cap now binds before the spend;
- the landing script works from a cloud session;
- the backlog is written down in one ranked, agent-readable file, [`docs/BACKLOG.md`](../BACKLOG.md).

**Five things need you. Only the first is dated before 10-01.**

## Top of stack (yours; ordered by date)

1. **Sonder's Testing report, due 09-30.** It is the fleet's first Testing report ever. On yesterday's data it drafts blocked: Titles & Meta fails, and Form Functionality has never been measured. Decide whether to fix those or send with the logged send-anyway override.
2. **29 Navy.** The Maintenance draft has had 0 blockers since ~09-18. Set `Report recipients (To)`. It is null, so the send falls back to MatthewB@worthe.com. Then press "refresh preview" on `/s/29-navy` and approve.
3. **LAHI, due 10-05.** Since #957, a site with no CMS reads CMS Checked as `n/a`. If a LAHI draft for this cycle already exists, press "refresh preview" before approving, because its stored evidence predates the fix. The client email still draws ✓ beside every checklist row whatever the evidence says, so LAHI will see "CMS Checked ✓". Whether that copy stays is your call (BACKLOG, operator decisions).
4. **MSOT / Revogen recipients.** Both still resolve to `accounting@revogenbiologics.com`. Fix the cells before approving either report.
5. **Revogen GA4, due 10-05.** `ga4_property_id` is NULL, so its report will draw no analytics section (#921). Look up the numeric property ID in GA and set it in the site editor.

The rest are in [`docs/BACKLOG.md`](../BACKLOG.md) → "Operator decisions", each as an exact ask. The ones to look at first:

- **#952**, the 0.100.1 release PR, is waiting on you as always. It publishes to npm.
- **#955**, changesets v3: #897 and #901 must land together by hand, or be closed. Merged alone, each one breaks the release chain.
- **#916**: #950 (another session) merged first, so #916 now conflicts with main. Decide whether it is still wanted before anyone spends the rebase. It would turn 9 of 12 sampled sites red until their palettes are fixed.
- **Private runner.** Confirm that the private `prospect-audit` workflow matches the public copy in `docs/private-runner/`. The public copy does not declare the `goal` input the cockpit sends, so the two have drifted at least once. #968's claim-by-`site_key` was designed to survive that drift, but only you can read the private file.

## What landed (merge time UTC; all squash-merged and pinned to the reviewed head SHA)

| PR          | What                                                                                                                                                 | Why it mattered                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #951 05:41  | time-travel checks out full history; a ci-gate test for every suite-running workflow                                                                 | red every week since 09-21; the cause was the checkout, not a clock                                                                                              |
| #953 06:10  | `land-prs.mjs` speaks only REST (adopted from an orphaned branch)                                                                                     | no cloud session could use the landing gate; the review found a neutral-checks gate hole and a closed-reported-as-merged path                                    |
| #902 06:15  | `@types/mjml` v5                                                                                                                                      | byte-identical types                                                                                                                                              |
| #896 06:21  | upload-artifact v7                                                                                                                                    | proven by backup artifact `turso-backup-36530796403`                                                                                                              |
| #956 06:38  | a cancelled run files its tracking issue; only main's runs open or close one                                                                          | 09-28's lighthouse night filed nothing; a branch dispatch had closed #895 while main was red                                                                      |
| #957 06:46  | #911: a site with no CMS reads CMS Checked `n/a`                                                                                                      | LAHI's 10-05 report was blocked for good                                                                                                                          |
| #958 06:53  | `docs/BACKLOG.md`                                                                                                                                     | the to-do list you asked for                                                                                                                                      |
| #959 07:08  | #942: no Search Console property reads `unknown`, not "fail: Not on page 1"                                                                           | a false SEO failure could block a Testing send                                                                                                                    |
| #961 07:18  | #941: a broken site keeps its watch filter tags                                                                                                       | filter chips undercounted broken sites                                                                                                                            |
| #962 07:45  | #889: a maintained site missing its repo or Netlify ID is a watch item                                                                                | flags Beachfront's missing Netlify ID, which would block its 11-08 report                                                                                         |
| #963 07:57  | `land-prs` retries transient reads, never writes                                                                                                      | one proxy reset had stopped a landing                                                                                                                             |
| #964 08:04  | every workflow parsed as YAML; release-health and time-travel alarms can fire                                                                         | the review caught a lockfile that would have broken every nightly at install                                                                                      |
| #965 08:11  | forward pointers to #874 on the FIGMA_PAT deletion advice                                                                                             | following the old advice would break every comp-driven site                                                                                                       |
| #966 09:01  | #892: protection-audit judges every branch Renovate merges into                                                                                       | reddoor-website `staging` has no required check; #754 now lists it                                                                                                |
| #967 09:43  | a tracking issue's body is rewritten on every failure (P1-11)                                                                                         | a reopened issue used to show the first failure's run, not the latest                                                                                             |
| #968 10:18  | #907: the prospect-audit daily cap reserves a slot before it spends (migration 0029, `claimed_at`)                                                    | the cap counted rows written after the spend, so it could not bind on the burst it was built to stop; two review rounds found two production-wiring reverts     |

Also:
- **Closed with evidence:** #717 (every previously exposed host re-probed with controls; each now returns 404 or is unpublished), #698 and #863.
- **Filed:** #955 (changesets v3 analysis).
- **Landed by another session, not me:** #954 (Airtable references) and #950 (a11y spec), plus issues #960 and #969. #950 landing unblocks #905 and #949.

## Nightlies

[NIGHTLIES]

## What went wrong, or nearly did

- **Line-number citations drifted in three PRs.** Edits shifted lines that `continuity.md` cites by number. `runbook-anchors` caught one citation per PR and passed the rest by accident, because the shifted line still held an anchor term. #956 went red in CI once because of it. From then on, every PR had its citations checked by reading the cited lines.
- **A lockfile that would have broken every nightly.** #964's first lockfile failed `--frozen-lockfile`, because the repo's js-yaml override rewrites a new dependency's range. It was invisible locally. The reviewer proved it in a fresh worktree, and that is now how lockfile changes are checked.
- **Tests at the function layer passed while the wiring was wrong.** Twice on #968, the fix could be reverted in the CLI or the Netlify adapter with the full suite still green. Tests now drive the real CLI and the real handler.
- **Tooling friction:**
  - The permission classifier refused a force-push of the session branch, so the branch was re-created after each squash merge.
  - The classifier returned no verdict for several minutes once.
  - One landing stopped on a transient proxy reset, which #963 fixes.

## Next for agents (from the backlog)

- **P1-3 / #912:** check that a roster URL resolves. It needs a sweep and the next migration. The start-here is written.
- **P1-7 / #910:** store the a11y route counts.
- **P1-12:** a scheduled `sync-configs --dry` drift report.
- **P1-16:** a `failed` terminal status for prospect audits. A post-spend throw now holds its slot for 2 h.
- **P1-17:** bypass actors on non-default Renovate base branches.
- **P1-19:** stop storing `search_found_page1=0` when no property is found.
- **#905, #949:** unblocked now that #950 has landed. Claim on the issue first.
