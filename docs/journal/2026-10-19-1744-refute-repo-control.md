## 2026-10-19 — A refute-claims control on pinned repo files, one skeptic per claim: production passes and the control still saturates (#1490)

P1-57 (#1443) ran the seeded levers control through the bake-off, and it could not separate the arms. Every arm caught 7 of 7 false claims. The only error was on c10, whose label is contestable against today's docs. One agent judged all 17 claims, where production spawns one skeptic per claim. And the docs corpus the control cites is fetched, not committed, and 39 of its 40 pages had drifted. This session built the harder control that PR asked for, ran it once, and found that it saturates too.

**The control.** It has 36 claims about six repo files at `46eaa80d`: two workflow files, `.claude/settings.json`, and three bake-off lib files. 18 claims are false, 16 are true documentary claims, and 2 are behaviour claims keyed `untested`. The false claims are the subtle kinds the brief asked for:

- dropped conditions: the long-prompt threshold counting only uncached input, and the tracking issue opening "on any branch";
- wrong defaults: 600 s for a 900 s timeout, and 24 h for a 12 h window;
- a field given to the wrong event, hook or list: `Stop` for `SubagentStop`, `deny` for `ask`, and push for pull_request.

Repo files were chosen over docs for two reasons. A commit cannot drift, and `git show <pin>:<path>` re-fetches it anywhere CI has full history, which `ci.yml` checks out. Every label names its deciding line. The tests check that line's text at the pin, and check that the line lies inside the claim's cited range, so a skeptic is always shown the evidence its label rests on.

**Proving the key, not only the scorer.** Before the first run, an adversarial label review on the session model found that I had keyed r32 wrong. Its first wording, "normalise with a kind that has no pipeline throws", is refuted by `number`, `boolean` and `file`, which have no pipeline and return normally. I had read line 53 and not lines 38-50.

The fix went further than rewording r32. Every label a function call can settle (13 of 36) is now settled in the tests by importing the pinned file and calling it. That is a read from a different authority than the one that wrote the label. The same review found that r14's "SessionStart" sat on line 73, outside its cited range 92-101. A strict skeptic could only have called that claim `unclear`.

**One skeptic per claim.** The harness gained an item mode. A task exporting `items(dir)` and `assemble(outputs, dir)` runs one agent per arm and item, marked `(BAKEOFF-ARM: <arm> ITEM: <item>)`. `score` checks each item agent's model, effort and writes on its own, then scores the assembled arm. Each skeptic gets production's `refutePrompt` and per-kind `verdictSchema`, and its verdict goes through `enforceQuoteRule`.

A harness review found that my first `assemble` keyed each verdict by the claim the agent was spawned for. Production files a verdict under the id the skeptic typed (`byId.get(r.id)`), so the bake-off would have credited a mistyped id that production drops. Now it does not. The same review caught four more defects in the decision code before it judged anything:

- it never checked that a config had two runs;
- it read the task's arm list instead of the run's;
- it printed "the key held" before any referee had ruled;
- the secrets check matched `refute-repo` inside every skeptic's own input path.

**Getting 432 agents to run in a 4-CPU container.** A workflow runs `min(16, CPUs - 2)` agents at once, which is 2 here. I expected 7 hours for one workflow, so each arm ran as its own workflow under `args.only`. The run's args are 134 KB, too large to paste twelve times, so `bakeoff.mjs split` writes one launcher file per arm. My first launcher called the bake-off workflow as a child with `workflow({ scriptPath })`. The runtime refused that, because my worktree is outside the session's working directory. The launcher now embeds the workflow body as a function.

In practice a 36-agent run took 2.7 to 4.9 minutes, not the 20 I had estimated from 2 slots. Per-agent time was far below my guess of a minute or two.

**The result.** Production ran first, as a pilot: Opus `xhigh`, two runs. It scored 36/36 both times, so the instrument passed on known-good input before anything else was spent. The other ten runs then went out together.

Every config except one scored 72/72 pooled. That includes Haiku `medium` at $0.24 a run, against Opus `xhigh`'s $8.58. Sonnet `medium` run 2 wrote `confirmed` on r33 while its own `reason` said the order was "the opposite of the claim". The quote was real, so the quote rule let it through. That is a slip in the output field, not in the reading.

One Haiku skeptic called `list_events` with `session_id: "unused"`. The call is a no-op, but it is outside the allowlist, so the rule faults the run. Pooled errors spread by 1 against the pre-registered minimum of 3, so the rule says the control may not rank. Whether the false claims are worded subtly or plainly, a skeptic reading one file region with the deciding line in range catches them at every model and effort.

**Belief corrected: effort barely moves the cost of this step, and the model does.** About 80% of an Opus skeptic's cost is the cache write of its fresh context (system prompt, `CLAUDE.md`, the prompt): $6.95 of the gold's $8.75. So Opus `low` costs 87% of Opus `xhigh`. Sonnet costs about 55% and Haiku about 3%. All costs are floors (#1435). An independent Python pass agreed with `collect` on all twelve runs to four decimals.

**What would rank the arms**, if anyone still needs it, is difficulty: claims whose deciding fact needs two files, or a quantity computed across lines. Saturating on single-line evidence is itself the finding. For this step, the measured question now has a different shape. Does Haiku or Sonnet match Opus on claims where Opus itself sometimes fails?

The whole run cost at least $67.05, including the $0.42 referee. The result is on workspace#1. `DEFAULT_MODEL` is unchanged, which is the operator's call.
