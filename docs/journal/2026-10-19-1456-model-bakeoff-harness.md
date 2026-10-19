## 2026-10-19 — Model bake-off harness and transcript ledger, with the row-4 result (P1-55, #1417)

This was the first slice of reddoorla/reddoor-workspace#1: the first two acceptance boxes and one measurement. It added `scripts/model-bakeoff/` (the harness, a Workflow script and the ledger) and the result for row 4 of the routing table (T5 census sweeps). Nothing in it changes routing.

**The measurement.** I froze 38 files of this repo at `4083be93`: 18 workflow files and 20 top-level scripts. Each run makes 228 checks, all against a reference computed by script.

| Arm (two runs each, gold one run) | Score   | Cost per run     |
| --------------------------------- | ------- | ---------------- |
| Haiku 5.5 at `medium`             | 456/456 | about $0.013     |
| Haiku 5.5 at `low`                | 455/456 | $0.014 to $0.016 |
| Sonnet 5.5 at `medium`            | 456/456 | $0.26 to $0.29   |
| Opus 5.5 at `low`                 | 456/456 | $0.34 to $0.37   |
| Opus 5.5 at `high` (gold)         | 228/228 | $0.71            |

Every transcript shows exactly the model and effort that agent asked for. The whole run, including one referee ruling, cost $2.43. An independent Python pricer over the same transcripts agreed with the ledger on every agent. By the issue's decision rule, Haiku at `medium` is the cheapest arm that matched gold on every check across two runs. The result is posted on workspace#1.

**The one hard check.** Both Haiku misses across two bake-off attempts were the same check: the bare `"node:"` literal on line 42 of `central-dep-blocker.mjs`. The first truth function missed it too, because its regex required at least one character after the colon. Eight of nine arms in the first run found it, and the referee ruled the truth wrong. The truth-against-itself self-test had passed before that run. It proves the scorer, not the truth. The README now says so.

**The first run was contaminated and was thrown away.** The review lens found it, not me. All four Haiku arms wrote `scratchpad/census/census.py` at the same path at the same time, and the transcripts show haiku-medium-1 running haiku-medium-2's script. Nothing in the harness could see this: separate arms are only independent if they cannot touch each other. Each agent now gets `<run>/work/<id>`, and `score` reports any Write or Edit outside it. Bash redirects are still invisible, and the README says so.

**The pricing correction.** I confirmed the prices against the claude-api skill rather than copying #2's. Claude Code writes 1-hour cache entries (`cache_creation.ephemeral_1h_input_tokens`), and those cost 2x input. #2's `ledger.js` priced every write at 1.25x, so its cache-write cost is low by up to 1.6x on those tokens. Haiku's long-prompt card (5x every class above 100K) is as #2 assumed.

**Five dirty review rounds, then the operator.** Each round ran three lenses: correctness, wiring and safety, and claims and docs. All five found real defects, and they clustered in two places.

- **The scorer's handling of items the reference lacks.** In round 1 a missing field was credited when the reference was 0. In round 2 extras and duplicates shared one disagreement id. In round 3 a single extras check per collection could not carry one verdict about the reference. In round 4 an extra the referee ruled real left its fields unscored, which is now a reported problem.
- **The Bash tripwire that reports arms which write.** It started as regexes and every round found new bypasses or false positives. In round 3 I replaced it with a command-word design. Round 4 found `"$(gh api x)"` inside double quotes. Round 5 found that `curl -G -X POST` went unflagged. CodeQL then flagged the `sh -c` regex as exponential (196 ms at 22 repetitions), and a quote-aware lexer replaced it.

The measured result never moved through any of this. The operator answered Operator decisions 131 with "land it now", with round 5's fixes unreviewed. The remaining minors are #1419.

**What I would do differently.** The tripwire is detection, and detection over shell syntax does not converge; five rounds proved it. Prevention would: a read-only custom agent type that denies `gh`, `git push` and curl writes. It was out of this slice's scope, because it changes agent definitions, and it belongs with workspace#1's write-access box.

**Instrument bugs of my own.** The mutation script reported a mutation whose search pattern no longer matched the code as green, because the tests ran against unmutated code. Five mutations looked like survivors before I made the script fail loudly on a missed pattern. Also, `bash.filter(forbiddenCommand)` passed each array index as the recursion depth, which turned off the nested `sh -c` scan after the fourth command.

**Cloud caveat.** This container holds only its own session's transcripts, so the ledger was proven on those. The 30-day re-run against the laptop's transcripts is a later acceptance box.
