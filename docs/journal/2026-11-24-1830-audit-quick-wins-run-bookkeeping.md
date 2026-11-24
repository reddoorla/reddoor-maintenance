# 2026-11-24 — audit-review quick wins: run bookkeeping and a pinned Lighthouse

Landed in the "run bookkeeping" PR from `claude/qw-run`. Four items from the 11-23 audit-system review's quick wins (workspace `audits/2026-11-23-audit-system-review/report.md` §4), worked across three sessions that handed off at the 300k-token seam.

**Why.** The review could not say what an audit costs or where its time goes, because a run kept nothing about itself; it found branded answers kept whole and category answers cut to a snippet, so a later reader could not re-check a category verdict; it found a failed analysis still sent the paid probe and accuracy stages to the model with nothing to ask about; and it found `npx @lhci/cli` running whatever version the npx cache held, with a lost Lighthouse marking the whole run `partial` though no page shows Lighthouse.

**What changed.**

- COST-05: every probe keeps its whole answer as `fullAnswer`; the snippet stays truncated.
- COST-01 / B-13: `result.run = { stages: { <stage>: { ms, costUsd?, calls? } }, totalCostUsd }`. Cost comes from each `claude -p` envelope's `total_cost_usd`, collected through an AsyncLocalStorage scope (`src/prospect/run-record.ts`) so two concurrent stages cannot mix their sums. It lives inside `result_json` (about 812 bytes on a real run), so there is no migration. Nothing renders it; it is in the report page's source until top-10 item 9 trims the payload.
- COST-04 / B-14: analyze is retried once. When it fails twice, probes and accuracy are skipped with `ANALYZE_FAILED_SKIP`, and the report says why. Stderr was already captured on every `claude -p` exit path (`exitDetail`), so that half closed as no longer reproducing.
- TEC-07: `lhciInvocation` runs the `@lhci/cli` the package resolves, under node, else `npx --yes @lhci/cli@^0.16.0`; `REDDOOR_LHCI_BIN` wins first, the seam the CLI test now uses to supply its fake. `auditStatus` no longer counts Lighthouse, which waited on W1 (#2257) because W1 rewrote the same lines.

**Measured.** The Lighthouse stage on reddoorla.com, main `c6438de4` against the branch: performance 0.95 / 0.963, accessibility, best practices and SEO 1 / 1, agentic browsing 0.89 / 1, 92 s / 73 s. Both produced a result, which is what the brief asked. The render diff over every stored row: 73 complete or partial rows rendered with `renderProspectReport` on main (`ee0dee45`) and on the branch, 0 differ; a control row with its URL changed was caught (1 differs). The read was SELECT-only through `openReadOnlyDb`, whose UPDATE control was refused before the dump.

**Belief corrected on contact.** The previous session's permission classifier refused that Turso read, and the PR was going to argue the render diff by construction. This session's identical read went through, so the literal diff replaced the argument. The argument was right, but it was an inference where a measurement was available.

**Defects met on the way.** After `main` was merged in, the full suite had one red: `tests/prospect/end-to-end.test.ts` lost the business name. Its analyze stub had stopped parsing under `AnalyzeSchema` when the model began answering our questions by id: no `id`s and no `categoryQueries`. So analyze had been failing inside this test on `main` too, and the test passed only because the probes still ran after it and found the name. COST-04's skip exposed it. The stub now answers the base set by id; every assertion is unchanged, and analyze and the probes both succeed in it. Pinning lhci broke `tests/cli/audit-lighthouse-failures.test.ts`, which put a fake `npx` on `PATH` that the pinned invocation no longer called; both cases timed out. The fix was the env seam, not a changed assertion.

**Mutations, each red:** dropping the per-stage timing write in `timedStage()` (`pipeline.test.ts` "times every stage that ran…"); the TEC-07 status test against the old `auditStatus`.

**Review: two rounds, Opus.** Round 1 (3 lenses) was dirty with four majors, each reproduced:

- **Failed calls reported no cost.** The CLI exits 1 on an error envelope that still carries `total_cost_usd`, and the cost was read only after the exit-code check. So the first attempt of the very retry this PR adds, and every budget-capped probe, read as free; one probe read `totalCostUsd: null` after $2.10. Cost is now read from stdout before any check.
- **The skip note was not client-safe.** It said "the analyze stage" and "paid" on a prospect's page. It now reads "Not run — the content analysis this test is built from could not be completed."
- **The lhci pin was not held on fleet sites.** `@lhci/cli` is a devDependency here, so on a fleet site the resolver walked up from `dist` to the site's own copy, which onboarding pins at `^0.15.1`. A resolved copy outside `LHCI_VERSION` is now passed over for the pinned npx.
- **The website said the visibility test "ran and failed" when it never ran.** The website's hand-copied list of skip messages did not know the new one. That fix is reddoorla/reddoor-website#394.

The finding that `run` reaches the page source was already settled by the brief (top-10 item 9) and is stated in the PR. The minors are #2282 and #2283. Round 2 looked at the fixes alone and was clean; its one nit, that build metadata in a version fails the caret check, costs only a fall back to the same pinned version.
