## 2026-10-19 — Bake-off row 1: every arm implements a planned roalson-interests task, and Haiku `medium` is the cheapest to match gold (P1-60, reddoorla/reddoor-workspace#1)

**There was no plan to replay.** The brief asked for a written plan in roalson-interests with a task that has its own tests. The repo has none:

- No `docs/superpowers/plans/` at any of its 117 commits.
- A Sonnet sweep of its issues, PR bodies and the 13,000-line journal found no Task/Step plan.
- The T4 plans lived in the sessions that wrote the code, and nobody committed them.

The best stand-in was #253 (`hoverActivate`, commit `8644d8c`), whose description reads like a spec:

- the behaviour;
- why the dwell is 200 ms;
- what does not change;
- the ten unit tests, case by case.

It was written beside the code, not before it, so I added only the interface it implies and said so in the result. A pre-written plan could be vaguer than this one.

**The harness scored extractions; this task is scored on a tree.** Three small shared hooks carry it:

- `setup`, called by `prepare`, gives every agent a one-commit copy of the pin.
- `evaluate`, called by `score`, replaces the agent's self-report as the thing scored.
- A collection flag, `mechanical`.

Review then added more:

- a collection flag, `refFixed`;
- an item-level `mechanical`, honoured only for evaluated output;
- `referenceFor`, which refuses `evaluate` without `truth`.

**Two siblings built the same hook at once.** P1-58 (#1475, `pnpm update`) landed while this PR waited on CI. It brought its own `observe(work, structured, agent, reference)` and an identical collection-level `mechanical`. Two hooks for one job would be worse than either, so at that merge t4 moved onto P1-58's:

- t4 exports `observe`, which runs and caches its gates inside the task.
- `evaluate`, `evaluatedOutputs` and `referenceFor` came out of the shared `bakeoff.mjs`. P1-58's `scoreArms` already refuses `observe` without `truth`.
- What this PR still adds to the shared files is `setup`, `refFixed` and the item-level `mechanical`, now gated on `observe`.
- Both runs re-scored through `scoreArms` to the same 32/32s.

None of this changes t5-census, figma-inventory, seeded-review, refute-claims or pnpm-update. Their tests pass across four merges of `main`.

**Proving the instrument caught my own scope list.**

- The first proof failed the `suite` gate on the implementing commit itself.
- Any new module under `src/lib` makes roalson's `capability-index` test require a regenerated `docs/COMPONENTS.md`, and the real commit did regenerate it.
- My scope list had left it out. The "extra file" perturbation passed only because its out-of-scope file was that same index.
- Without the proof, every agent that did the job properly would have been scored out of scope.

The final proof was 32/32 on known-good, and each of six perturbations failed exactly where it was changed. One was an attack: a `package.json` rewrite hidden by `assume-unchanged`, an `fsmonitor` hook and a type error. It failed typecheck and scope, and the hook never ran. My own `git status` inside that copy did run the hook, which was the best demonstration that the scorer must never use an agent's `.git`.

**The held-out tests are stricter than the plan in two places.** All four misses on the tests as written came from them:

- Gold run 1 and Opus `xhigh` run 1 apply the mouse-only `pointerType` filter to `pointerleave`. The test fires a bare `MouseEvent` with no `pointerType`, though a real mouse leave carries `"mouse"`.
- Both Sonnet runs ask `matchMedia` on each event rather than at creation.

The referee credited 10 of 11 rulings. So the strict count penalised the most careful readings, not the cheapest. The referee was not stable on the closest call: Sonnet's lazy query was ruled against in one round of three on identical code. #1502 holds the three plan sentences that would remove both details.

**Result.** Every arm scored 32/32 on both runs after the referee.

| Arm              | Cost per run, run 1 / run 2 |
| ---------------- | --------------------------- |
| Haiku `medium`   | $0.05 / $0.10               |
| Sonnet `medium`  | $0.40 / $0.32               |
| Opus `low`       | $0.39 / $0.45               |
| Opus `xhigh`     | $1.50 / $1.85               |
| Opus `high` gold | $1.03 / $1.05               |

By workspace#1's rule that is Haiku `medium`. Haiku and Opus `low` were also the only arms that passed the held-out tests as written on both runs. Transcripts confirm every model and effort.

The row cost $9.29, of which $2.15 was referees, and much of that $2.15 was mine:

- My scorer rewrite changed the evidence text, which changed the disagreement ids, and the rulings had to be redone.
- A 718-character id (its evidence paths) came back from the referee cut to 80 and matched nothing.
- The id is now the failure's first line plus the arm.

Also mine: a `pgrep -f` waiter that matched its own command line and sat for 40 minutes before run 2 was scored.

**Review: three rounds, the third clean.**

- **Round 1** found the serious ones:
  - every `node_modules` hardlinked to one store inode, across agents, eval trees and the store;
  - scope read through the agent's own `.git`, so `assume-unchanged` hid a change and `fsmonitor` ran code in the scorer;
  - out-of-scope edits could reach the gates.
- **Round 2** found:
  - an infinite loop in an agent's test could abort scoring for every agent;
  - an agent that wrote no tests still scored full marks;
  - the scorer's git ran filters from the caller's global config;
  - the README overstated what is tracked.
- **Round 3** found only minors, filed as #1496–#1502.

One round-1 major is mitigated, not fixed: reads, Bash writes and score-time code are untracked, so the harness is a tripwire, not a sandbox (#1501). I audited all ten agents' transcripts and plan files for the routes and found nothing. The closest was opus-xhigh-1 copying a probe script into its own `node_modules` root and deleting it.

**What was tried and abandoned.**

- **Marking held-out test results mechanical.** It made the instrument blind to the plan's open details; the referee is the right judge there.
- **Giving the referee the agent's live tree.** It must read the tree that was scored.

Nothing was pushed to roalson-interests. The result is at [workspace#1](https://github.com/reddoorla/reddoor-workspace/issues/1#issuecomment-6274850362).
