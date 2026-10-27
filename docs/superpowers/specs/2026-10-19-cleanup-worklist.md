# Cleanup worklist, 2026-10-19

The maintenance cleanup session (worker brief from the cockpit session
of 2026-10-19) surveyed `main` at `2459645a`. Five read-only agents ran on
Sonnet at medium effort. Each pointer below is a file:line or a commit at that
head. A line marked _(lead-checked)_ was re-read by the lead. The other lines
are the surveyors' findings, and the worker re-checks each one before
building on it, as `CLAUDE.md` asks.

## Baseline (measured)

- CI `pnpm test:coverage` step on `main`, last three runs: 4m22s, 5m00s,
  4m24s (runs 39276203086, 39274886780, 39272603611).
- Local `vitest run` in a 4-core cloud container: 411 s wall, 9,614 tests
  (9,606 pass, 8 skipped, 0 fail), 605 files. The sum of per-file times is
  922 s. Survey agents were running at the same time, so this wall time is
  noisy; the CI figure is the reference.
- Slowest files: `tests/audits/form-e2e-live-runner.test.ts` 163 s,
  `tests/audits/a11y-live-spec.test.ts` 155 s,
  `tests/recipes/match-harness.test.ts` 86 s, `tests/prospect/pipeline.test.ts`
  41 s, `tests/reports/header-image/capture-consent-browser.test.ts` 39 s,
  `tests/cli/prospect-audit-email.test.ts` 35 s.
- 22 tests take over 5 s and sum to 241 s. Fourteen form-e2e-live-runner
  tests take about 6.6 s each. Two of them take about 37 s, which looks like
  the 30 s page timeout plus settle. The fixed waits are
  `src/audits/form-e2e.ts:623-625` (`FILL_SETTLE_MS = 1200`,
  `PAGE_TIMEOUT_MS = 30_000`) _(lead-checked)_.

## Ranked worklist: agent-ready (one PR each)

| #   | Item                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                                                                                                         | Size                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | **Close 5 delivered issues** by comment with evidence (no PR)                                                                                                                                                             | #955 `4463f4d8` (#901), `release.yml:120,137`; #1230 #1232; #1231 #1235, #1238; #960 #972 (`ps` half parked, BACKLOG "Watching"); #1372 #1377 `917e8bbd`, BACKLOG P1-51 done                                                                                                                                     | 0 lines                            |
| 2   | **CLI `formatResult` x10 → one shared helper**, which also fixes a bug: `bump-deps` and `upgrade` have no `failed` branch, so a failed recipe prints `applied: 0 commit(s)`                                               | `src/cli/commands/bump-deps.ts:18-21` _(lead-checked)_, `upgrade.ts:17`, six byte-identical copies (`analytics-tag.ts:15` …)                                                                                                                                                                                     | ~45 net                            |
| 3   | **Speed: form-e2e settle and timeouts injectable for fixtures**                                                                                                                                                           | `src/audits/form-e2e.ts:623-625,976`                                                                                                                                                                                                                                                                             | 163 s file, target well under half |
| 4   | **Speed: the other slow tests** (prospect-audit-email 21.6 s single test, decisions.test 12.8 s, tsx spawns in two CLI registration tests)                                                                                | `tests/cli/prismic-models-registration.test.ts:86`, `tests/cli/prospect-audit-registration.test.ts:84` (tsx, not `dist`)                                                                                                                                                                                         | ~60 s file time                    |
| 5   | **launch-check minors** #1373, #1374, #1375                                                                                                                                                                               | `src/recipes/launch-check.ts:450` (quoted-only HREF), `:460` (row url base), `:161-173`                                                                                                                                                                                                                          | ~50                                |
| 6   | **decisions.mjs minors** #1353, #1355, #1356, #1357 (#1354 documented, not changed)                                                                                                                                       | `scripts/decisions.mjs:95,199,204,21,68`                                                                                                                                                                                                                                                                         | ~50                                |
| 7   | **dropbox.mjs minors** #1392, #1393, #1394                                                                                                                                                                                | `scripts/dropbox.mjs:299-305` (any 409 = granted), `:194` (429 only), `:360-379` (no size check after session)                                                                                                                                                                                                   | ~35                                |
| 8   | **dropbox-file-request-upload minors** #1397–#1401                                                                                                                                                                        | `scripts/dropbox-file-request-upload.mjs:14,40,89,171,196-204`                                                                                                                                                                                                                                                   | ~90, mostly tests                  |
| 9   | **evening-branches minors** #1348, #1349                                                                                                                                                                                  | `scripts/evening-branches.mjs:143,269`                                                                                                                                                                                                                                                                           | ~12                                |
| 10  | **search-console-recheck minors** #1339 (cheap half), #1340, #1341                                                                                                                                                        | `src/cli/commands/search-console-recheck.ts`, `.github/workflows/fleet-lighthouse.yml:24-25`                                                                                                                                                                                                                     | ~100                               |
| 11  | **#998: `protectBranch`'s PUT strips reviews and restrictions** (real defect, code and test only, never run live)                                                                                                         | `src/github/gh.ts:404-421`, caller `src/recipes/self-updating/index.ts:255`                                                                                                                                                                                                                                      | ~60–90                             |
| 12  | **Hollow and duplicate tests**                                                                                                                                                                                            | `tests/types.test.ts:68,76,107` (no `expect`); identical bodies at `tests/forms/ingest.test.ts:840`/`:1005`, `tests/dashboard/fleet-cockpit.test.ts:332`/`:517` and `tests/reports/digest-run.test.ts:458`/`:537`                                                                                                | small                              |
| 13  | **Weak assertions**                                                                                                                                                                                                       | `tests/dashboard/audit-report-json.test.ts:208` (`toBeDefined` only), `tests/db/header-images.test.ts:33`, `tests/forms/notify.test.ts:309`, `tests/reports/draft.test.ts:1170`, `tests/prospect/site-checks.test.ts:204`                                                                                        | small                              |
| 14  | **Dead exports, no consumer anywhere**                                                                                                                                                                                    | `findForeignAnalytics` `src/audits/analytics.ts:1037`, `isInProgressState` `src/audits/netlify-deploy.ts:68`, `isCanonicalStatus` `src/fleet/site-status.ts:93`, `resetRdapBootstrap` `src/prospect/dns.ts:90`, `TIER4_CHECK_KEYS` `src/prospect/site-checks.ts:3267`; none is reached from a public entry point | ~35                                |
| 15  | **Prospect-audit dispatcher re-implements `gh-rest.dispatchWorkflow`**, under a stale comment that says it lacks `inputs`                                                                                                 | `src/dashboard/prospect-audit-trigger.ts:102-160` vs `src/github/gh-rest.ts:62-71`                                                                                                                                                                                                                               | ~35                                |
| 16  | **`src/util/fs.ts` and identical private helpers**: `exists` x9, `readIfExists` x7, `readJsonMaybe` x2, `ymd` x5, byte-identical `slugify`/`formatIsoDate`/`pathDepth`/`searchHost` pairs, `lazyFleetDb` x2               | `src/audits/a11y.ts:294` = `src/audits/lighthouse.ts:56`; `src/cli/commands/preflight.ts:36` = `src/cli/commands/report.ts:87`; others in the survey                                                                                                                                                             | ~150                               |
| 17  | **`scripts/lib/cli.mjs`**: `isMain`/`self` x10 byte-identical, `next()` x4, sleep x3 (`land-prs.mjs:198` already exports `realSleep`), `proxyReexecEnv` x2. Keep `prismic-sync-build.mjs` and `scripts/hooks/` standalone | `scripts/decisions.mjs:751`, `scripts/dropbox.mjs:492` …                                                                                                                                                                                                                                                         | ~90 net                            |
| 18  | **Test helper copies → `tests/_helpers/`**: `captureClient` x6, `authHeader` x5, `recordingMirror` x5                                                                                                                     | `tests/reports/digest-turso.test.ts:28` …                                                                                                                                                                                                                                                                        | ~150                               |
| 19  | **Delete `scripts/webflow-fixtures.mjs`**: nothing references it. The fixtures it wrote stay committed                                                                                                                    | only inventories mention it                                                                                                                                                                                                                                                                                      | 25                                 |

Items 5–10 run after item 17 only if that does not collide; they touch the
same scripts, so 17 goes last among the script items.

## Needs the operator

- **Retire the dormant Blux emit, catalog, freeze and migrate pipelines,
  keeping `blux convert`.** Operator decision 59 calls the pipeline dormant
  since July, and its last consumer, the-pointe, is archived. The cut is about
  3,800 `src` lines and 4,574 test lines. It is the largest single cut on this
  list, but `reddoor-starter-blux` still renders `blux_*` slices.
- **The workflow failure-issue steps → a composite action.** There are 40
  open/close steps, about 970 lines in 14 workflows, and converting the 10
  identical pairs removes about 250 lines. These are the alarm paths, and
  the dispatch-only workflows can only be exercised on `main`, so a slip is a
  silent outage. Same question for the setup block (repeated in 13–17 files,
  about 100 lines).
- **One-off generators and assemblers with no caller**:
  `src/webflow/sites/beachfront.ts` (252 lines, test-only; removed 2026-10-20 with
  `src/webflow`, OD 97(c)),
  `scripts/gen-report-shapes.mts` and `scripts/gen-report-fixture.mts` (548
  lines, which write into reddoor-website; #893 asks to extend the first).
- **Laptop-only tests that never run in CI or the cloud**:
  `tests/blux/catalog/pointe-coverage.test.ts:24` (hard-coded `/private/tmp`
  path) and `tests/blux/freeze/freeze-golden.test.ts:12`. Tied to the Blux
  question.
- **Behaviour choices inside review-minor issues**: #1390 (`--mkdir`) and
  #1391 (overwrite default) in `dropbox.mjs`; #1396 (needs a measurement);
  #1379 (loosens a deliberate fail-closed check in `src/audits/analytics.ts:1019`);
  #906 (the 429 shape on `./forms`, which is public API); #1339's digest item.
- **Partly-done issues to close or re-title**: #1055 (option A built, with
  items 45 and 46 open), #1090 (answered by #1102 and item 57), #910 (small
  half done in #1005).
- **Left open, not this session's**: fleet, bot, RED and site-repo issues
  #1029, #1007, #1002, #947, #921, #898, #893, #874, #779, #773, #754, #674,
  #672, #623, #545, #490. Owned elsewhere: #1408–#1411 (P1-54) and #1419
  (P1-55).

## Not worth doing

- `resolveTargetPrettier` twin (`src/recipes/_prettier.ts:30`): documented as
  intentional.
- The helper copies inside `src/recipes/match-harness/template.ts`: they ship
  as standalone files.
- About 370 test-only `export`s that are also used in their own file:
  removing the keyword saves 0 lines.
- Three GitHub transports (`gh.ts`, `gh-rest.ts`, `makeSyncGitHub`):
  merging them is a design question, not a cleanup.
