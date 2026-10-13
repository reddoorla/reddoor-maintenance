## 2026-10-13 — The 09-30 model rule reaches main, two weeks after it was set (this PR)

> Follows 2026-10-13 — CRM baseline, the new-business build sheet, and three corrections the operator made.

The operator asked why the new-business review had burned so many tokens, and whether model choice "is an issue or did we already try and implement and it didn't take". It didn't take. On 2026-09-30 the operator set "research runs on Sonnet; writing and review run on the session model", and the GOLA session wrote it into `CLAUDE.md`. That session's branch, `claude/practical-ride-kbipzv`, was never merged and has been idle since 10-01 02:25Z. The backlog mentions the rule only in passing, inside the branch's status line. So `main`'s `CLAUDE.md` never carried it, and no session that started since has seen it.

**What it cost, measured.** This session's workflows ran about 330 agents, every one on the session model:

| Workflow           | Agents | Subagent tokens |
| ------------------ | ------ | --------------- |
| Round-1 review     | 36     | 8.85M           |
| Step-zero drafting | 8      | 1.15M           |
| Round-2 review     | 105    | 24.25M          |
| Bet 1 redesign     | 44     | 11.27M          |
| v3 claim check     | 68     | 14.66M          |
| Fix loops          | ~70    | ~10M            |

Under the rule, the raw-source readers, the desk-research agents and the claim extractors would have run on Sonnet. That is roughly 30–40% of the agents [I].

**The rule was ambiguous, so this PR states the judging exception.** The 09-30 text lists "a list of claims to verify" as research. The 09-14 A/B (R8) points the other way. Sonnet at medium agreed with Opus on 16 of 17 verdicts and ran 2.3 times faster, but it missed the one planted false claim. So the section now separates the two jobs: gathering evidence for a claim runs on Sonnet, and ruling it true or false stays on the session model. The A/B also showed about the same token count on both tiers. The saving is speed and price per token, not tokens. This session's three-vote refuters were judges, so they would have stayed on Opus anyway.

**Belief corrected.** I had treated "the repo has no such rule" as settled after grepping `main`'s `CLAUDE.md`. The rule existed. It sat on a branch, and a backlog line mentioned it, a derived view pointing at a state that never landed. A rule the operator sets in one session only takes effect when it reaches `main`.

**A collision to know about.** `claude/p1-33-w4-slim-claude-md` (P1-33 W4, a draft from 10-13 14:02Z) moves every operator directive out of this file into reddoor-workspace's `CLAUDE.md`. Its `claude-md-map` test will need this new section mapped, most likely as `operator:`, moved to the workspace. Whoever lands second resolves the overlap.
