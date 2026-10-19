## 2026-10-19 — Bake-off row 5: every arm passed the refute-claims skeptics, and that is not enough to move them off Opus (#1443)

P1-57 measured the one model setting pinned to Opus in config: the `refute-claims` skeptics (`DEFAULT_MODEL = "opus"`, effort inherited from the session). The question was whether Opus at a lower effort, or Sonnet, catches the seeded false claims as well as Opus at `xhigh` does. The task file is `scripts/model-bakeoff/tasks/refute-claims.mjs`. The result is on reddoorla/reddoor-workspace#1 and in `scripts/model-bakeoff/results/2026-10-19-refute-claims.json`.

**The control's evidence had moved under it.** The seeded levers control cites 40 pages of the Claude Code docs by line number. The pages are fetched, not committed, and on 2026-10-19 `fetch-corpus.mjs` found 39 of the 40 changed since the 2026-09-14 copy. The archive.org availability API showed a 2026-09-14 snapshot, but `web.archive.org` itself is blocked by the cloud egress policy, so the old bytes could not be recovered. Every anchor was therefore moved by hand to the same passage in today's page, and each label was re-read there. All 17 still held on that reading. One example is a coincidence: the exit-code-2 table still has exactly 16 "Yes" rows, but over a different set of events from September. The task pins today's bytes, so the run can be checked but not repeated once the docs change again. The control's own anchors in `refute-claims-levers*.json` are untouched, and still stale.

**Result.** Nine runs were scored against the answer key: the gold (Opus `xhigh`, with the production prompt and no addendum), and two runs each of Opus `medium` and `low` and Sonnet `high` and `medium`.

- Every run caught 7 of 7 false claims and left c03 `untested`.
- The only disagreement was c10, which both Opus `medium` runs refuted. An Opus `high` referee upheld the key's `confirmed`.
- Cost per 17-claim run: gold $1.42; Opus `low` $0.47 and $0.44; Sonnet `medium` $0.21 and $0.29. The whole run cost $5.49.
- Every transcript ran the model and effort it asked for.
- `collect` and an independent Python pass agreed on every agent's cost to four decimal places, once the Python used the ledger's own price card. My first pass used remembered prices and was about 1.5x high.

**Why the result does not support a change.**

- **c10 is the run's only discriminating claim, and its label is the weakest thing in it.** Today's line adds a host condition, and the production prompt tells skeptics to refute that kind of omission. A round-2 re-score showed what hangs on that one ruling: with c10 relabelled `refuted`, only the two Opus `medium` runs pass, and the gold fails.
- **The task is also easier than production.** One agent got all 17 claims, which is how the harness works, where the workflow spawns one skeptic per claim. That lets c04 and c11 (the same lines, opposite claims) answer each other.
- So `DEFAULT_MODEL` stays, and no Operator decision was asked. The next useful measurement is a harder control: more planted false claims, one skeptic per claim, and a corpus that can be fetched again.

**Beliefs corrected on contact.**

- **The tolerance written before the run was looser than the instrument it imitated.** It counted only refutations, over 10 claims with c03 among them, so an arm that confirmed nothing, or that refuted only c03, passed. Round 1 caught it. Round 2 found that a raw `confirmed` on c03 still passed, because `enforceQuoteRule` rewrites it to `untested`. The rule now mirrors the PASS control's lines and judges c03 on the verdict the arm wrote. No arm of this run flips under either version, and the result file says the rule was tightened after the run.
- **My own first draft overstated the result.** Its c10 caveat claimed the outcome held under either reading of the label. Round 2 disproved that by re-scoring.
- **A tolerance of "within one of the gold" is dead code next to a ship line of 2.** Mutation testing found it (the mutation survived), and it was removed before the run.

**Mechanics worth keeping.**

- The Workflow tool's `args` would have meant retyping a 42 KB prompt. Instead the run used a copy of `model-bakeoff.workflow.js` with the args embedded as a constant (`args.` → `BAKEOFF_ARGS.`), and `collect` accepted its transcripts unchanged.
- Three review rounds: round 1 (3 lenses) and round 2 were dirty; round 3 was clean, and its minors were filed as #1440 and #1441.
