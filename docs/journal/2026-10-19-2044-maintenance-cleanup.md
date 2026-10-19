## 2026-10-19 — Maintenance cleanup: 19 worklist items, 18 code PRs and 4 issue closes, 24 issues closed (Operator decisions 132)

> The worklist is `docs/superpowers/specs/2026-10-19-cleanup-worklist.md` (#1421). The operator chose its 19 items only. Blux retirement and the workflow composite action stay out of scope, as Operator decisions 132 records.

The brief came from the cockpit session: close out issues, improve code and test quality, and cut redundancy in this repo. One lead session ran it with at most six agents live. Five Sonnet readers surveyed `main` at `2459645a`. Everything after that ran on the session model: one implementer per item, then one fresh adversarial reviewer per PR round. Each PR landed with `land-prs.mjs`.

**What landed.** These were landed or closed with evidence:

| item | PR    | what                                                                                                                                                                                                  |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | —     | closed #955, #1230, #1231, #1372 by comment with evidence; #960 left open on purpose (its parked `ps` half)                                                                                           |
| 2    | #1428 | one `formatRecipeResult` for 11 CLI commands. bump-deps, upgrade **and sync-configs** printed a failed site as `applied: 0 commit(s)`. The survey said two commands; there were three.                |
| 3    | #1427 | `form-e2e-live-runner.test.ts` 160 s → 31 s in CI, through `settleMs`/`submitTimeoutMs` seams; production defaults unchanged                                                                          |
| 4    | #1481 | `prospect-audit-email.test.ts` 52–70 s → 6.3 s: it launched Chromium to render a 404 print page                                                                                                       |
| 5    | #1423 | launch-check #1373, #1374, #1375 items 1–2                                                                                                                                                            |
| 6    | #1432 | decisions.mjs #1353–#1357                                                                                                                                                                             |
| 7    | #1437 | dropbox.mjs #1392–#1394                                                                                                                                                                               |
| 8    | #1455 | dropbox-file-request-upload #1397–#1401                                                                                                                                                               |
| 9    | #1436 | evening-branches #1348, #1349                                                                                                                                                                         |
| 10   | #1484 | search-console-recheck #1340, #1341, and the cheap half of #1339                                                                                                                                      |
| 11   | #1442 | #998: `protectBranch` carries existing protection forward instead of nulling reviews and restrictions                                                                                                 |
| 12   | #1461 | three type tests that vitest could never fail, two ingest tests that were hollow, two duplicates                                                                                                      |
| 13   | #1469 | five weak assertions tightened                                                                                                                                                                        |
| 14   | #1467 | six exports with no consumer deleted (34 lines)                                                                                                                                                       |
| 15   | #1473 | the prospect-audit dispatcher uses `GitHubRest.dispatchWorkflow`. Its docstring said that method could not send `inputs`; it could.                                                                   |
| 16   | #1489 | `src/util/{fs,date,slug,path-depth}.ts` and `db/lazy-fleet-db.ts`; src net −127                                                                                                                       |
| 17   | #1494 | `scripts/lib/cli.mjs`: `isMain`, `flagValue`, `sleep`, `proxyReexecEnv`; scripts net −30                                                                                                              |
| 18   | #1483 | `captureClient`, `authHeader`, `recordingMirror` in `tests/_helpers/`; net −69                                                                                                                        |
| 19   | #1472 | deleted `scripts/webflow-fixtures.mjs`. beachfrontdentistry.com is served by Netlify now, with 0 `data-wf-` attributes, so a run would have overwritten the Webflow fixtures with the SvelteKit site. |

**Measured.**

- **Issues:** 24 closed, 4 by comment and 20 by PR. The reviews filed 18 new minor issues (#1433, #1434, #1446–#1451, #1453, #1454, #1457, #1468, #1470, #1471, #1474, #1487, #1488, #1495), as the minors rule asks. Net open count is down 6, and the new ones are smaller and better described.
- **Lines:** the 18 code PRs total +2,800 / −1,006. Honest accounting: the redundancy PRs removed about 330 lines of `src/`, `scripts/` and test duplication (#1467 −34, #1472 −25, #1483 −69 net, #1489 −127 src net, #1494 −30 scripts net, #1473 −34 src net, plus #1428's ten copies). Most of the +2,800 is new tests: every fix carries a red-first test and a mutation table. This session made the code smaller and the tests larger.
- **Test time, the belief corrected on contact:** I expected the two speed PRs to shorten CI. They did not.
  - vitest's summed test time fell (635 s on run 39276203086, about 600 s on runs 39312510961 and 39308085440), and the two files fell by about 190 s between them.
  - But the CI `pnpm test:coverage` step went from 4m22s–5m00s to 3m39s–4m55s. vitest's reported Duration went from 260.5 s to 282.6 s and 285.7 s.
  - Across the same afternoon, import time nearly doubled (56.6 s → 102.6 s) and transform rose from 6.8 s to 10.6 s, as other sessions added files and the runners were loaded.
  - With parallel workers the wall time is set by the longest files (`a11y-live-spec` 155 s, `match-harness` 86 s), not the sum. The form-e2e file was not on the critical path. A wall-time win needs `a11y-live-spec` or the import cost, not more per-file trims.

**What the reviews caught.** 23 review rounds ran across 19 PRs, and five PRs needed a second round or more. Each finding below was reproduced, and each would have shipped:

- **#1423, round 1:** judging the first due date flipped six maintained sites from `ok` to `missing`, Data Dynamiq among them, and Data Dynamiq is the documented 8/8 control. The reviewer ran `launchCheck` from both trees over all 47 live Turso rows (read-only) to find it. Fix: the new rule applies only before launch.
- **#1432, three rounds:** the TODO-placeholder check was first too narrow, then too broad. I chose the final rule myself: refuse a bare `TODO`, TODO followed by punctuation, or a line starting `TODO the ask`.
- **#1437, round 1:** retrying a finish that met `path/too_many_write_operations` re-sends bytes that Dropbox's spec (files.stone) says were already appended.
- **#1436, round 1:** the new real-git test inherited the host's git config and `GIT_DIR`.

**Process defects, mine.** These are recorded so the next orchestrator avoids them:

- **Browser runs.** I let the form-e2e implementer run its browser file "alone" while four agents were live, then corrected that. Later `prospect-audit-email.test.ts` turned out to launch Chromium indirectly, and two other agents ran `hydration-wait.test.ts`. The briefs gained a list of every file that imports Playwright.
- **A shared ref was overwritten.** One reviewer's `GIT_DIR` probe overwrote the main checkout's `refs/remotes/origin/main`; it repaired it with a fetch. Another agent's root-level `mut.py` in the shared scratchpad was run in the wrong worktree. Each agent now gets its own scratch subfolder and must not run probes against a real repo.
- **Wrong model tier once.** I started one reviewer on Sonnet, against the rule that verdicts run on the session model, and re-ran it.

**What cost the most was landing, not CI.** Another session landed about every 8–10 minutes all afternoon, and `main`'s ruleset needs an up-to-date branch, so most PRs took two or three update-and-CI rounds. #1484 ran out its script's three-round limit twice. Serial landing of 20 PRs took five hours (#1421 at 16:45Z, #1494 at 20:44Z), and #1484 alone needed three runs of the script. Next time, put the cleanup's docs-only and tests-only PRs in one window when no other session is landing, or ask whether a lower-traffic slot exists.

**Left with the operator** (from the worklist's "needs the operator" section, unchanged):

- Blux retirement (about 3,800 src and 4,574 test lines).
- The workflow failure-issue composite action.
- `src/webflow/sites/beachfront.ts` and the gen-report generators.
- The behaviour choices in #1390, #1391, #1396, #1379 and #906.
- #1339's digest alarm (comment posted).
- #1375 item 3.
- The partly-done #1055, #1090 and #910.
