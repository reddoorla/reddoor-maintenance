## 2026-10-26 (overnight, 7:10pm–8:30pm PT) — P1-55's next slice: four harness fixes landed, row 10 measured (Explore on Haiku `low`, 78/78), and routing goes to the operator (reddoorla/reddoor-workspace#1)

Landed: #1780 (#1498), #1781 (#1499), #1782 (#1540), #1785 (#1500) and this PR, #1790 (row 10). Decisions: `decisions/2026-10-27-0305-p1-55-*` in the workspace.

**The brief's premise was a day stale.** It expected rows 4 and 6 to be the only measured rows on workspace#1. All of rows 1–6 already had result comments from 10-19. The "measure the open rows" step therefore had nothing in rows 1–6. I measured row 10 instead, the cheapest of 7–12 whose result maps straight onto a routing knob, and ticked the "rows 1–6" acceptance box with links. Rows 3 and 5 are measured but undecided: both say a harder control comes next.

**Four harness fixes, each found harder than its issue said.**

- **#1498** (the caller's pnpm config ran inside the t4 scorer).
  - The issue named `~/.npmrc` and pnpm's `rc`. Under vitest, PATH resolves the repo's pnpm 11.11.0, which ignores `global-pnpmfile` in both. It reads `$XDG_CONFIG_HOME/pnpm/config.yaml` instead.
  - So the first red test passed with the fix removed. Only after it also wrote `config.yaml` did the mutant go red.
  - The fix gives every pnpm the scorer starts an empty config dir. Review round 1 then found that one dir per process let arm A's gate plant config for arm B's install, which I reproduced. It is now one dir per `run()` call, removed afterwards.
  - The store path is now asked in the pin's own snapshot, not the root's HEAD. Given `store/v11`, pnpm 10 resolves to `store/v11/v10`.
  - The root clone's filter drivers are avoided by archiving from a fresh bare repo fetched by sha.
- **#1499** (a self-ignoring `.gitignore`). The fix asks git for ignored paths and keeps those the pin's own rules do not ignore. Round 1 found two majors in it:
  - check-ignore reports a `!` negation match with a non-empty source, so `.claude/*` plus `!.claude/settings.json` let a new `.claude/.gitignore` hide the file again;
  - check-ignore exits 128 on a path beyond a symlink that base tracks, which stopped the whole score.
  - Both are fixed. Round 2 was clean.
- **#1540** (`runs.json` inside the run). Moving it and `referee-args.json` beside the run was the issue's fix. Round 1 found two more problems:
  - `result.json` also lists each arm's errors with the expected value;
  - `prepare`'s fresh-`--out` check did not cover the new sibling files, so a stale `<run>.runs.json` would merge into a new run.
- **#1500.** Four of its six items were already done on `main`; the harness had been refactored since it was filed. The cache key and `referenceDisputes` were the two still open.

**A review agent corrupted a branch, and I misread the symptom first.**

- The #1540 reviewer ran the suite with `GIT_DIR` pointed at my worktree. The tests' fixture `git init`/`git commit` calls then landed four commits by author "t" on `claude/p1-55-bakeoff-1540`, and replaced `package.json` with `{"scripts":{"check":"svelte-check"}}`.
- The same runs set `core.bare=true` in the shared `.git/config`, so the main checkout read as bare.
- CI failed in `pnpm/action-setup` with "No pnpm version is specified". I called that a pre-test flake and spent the one re-run on it. It was the branch's own `package.json`.
- Fixed forward in `da91219` (force-push is refused), with `core.bare` reset. Later reviewers were told never to set `GIT_DIR`, and to run from an archive copy.
- The underlying hazard remains: any test that shells out to git inherits `GIT_DIR`, so under a git hook it would write to the enclosing repo.

**Row 10, measured with the arms being the built-in Explore.**

- **How it ran.** The arms were launched through the Agent tool with `subagent_type: "Explore"` and a per-call model and effort, not through the workflow; this session had no opt-in to run workflows. That needed three harness additions:
  - a task-level `agentType`;
  - `textOutput`, which scores the last `json` block of the agent's last word;
  - a `prompts` command that runs the workflow script with a recording runtime, so hand-launched prompts are byte-identical. A test checks that.
- **Truth guard.** The task's one-answer guard refused two of my first questions before any agent ran: `formatCost` is also declared in `ledger.d.mts`, and two files throw `pick a fresh --out`.
- **Second authority.** A raw grep disagreed with the truth (7 importers of `credentials.ts` against 3, 4 importers of `ledger.mjs` against 1). Every extra hit was a string, type or comment, so the truth stood and the grep was the wrong instrument.
- **First collect read nothing.** It read no output from any of the ten agents: a background subagent returns its report through a `SubagentHandback` tool call, not as text. Fixed with a test before any score was read.
- **Results.** Haiku `low` scored 26/26 on all three runs at about $0.012 a run, against $0.61 for the Opus `high` gold. Haiku `medium` also matched every check, at about 10% more. Sonnet `medium` listed `types` (the file `src/types.ts`) as a directory once, at $0.16 a run. The whole run cost $1.33, referee included.
- **Effort.** This container's environment has `CLAUDE_EFFORT=medium`, and the per-call `low` and `high` took effect over it.

**Routing: nothing written, deliberately.**

- The brief said to write `model:`/`effort:` into the matching agent or skill frontmatter. No such file exists for rows 1, 2, 6 or 10:
  - the inventory step of row 2 lives inside `figma-slices`' main-thread Stage A;
  - rows 1 and 6 have no agent anywhere;
  - a project `Explore.md` would replace the built-in's prompt (not what was measured), and would reach only sessions that start in maintenance.
- Row 4 was already routed (`sweep.md`).
- My pick in the decision file is per-call rules in the workspace `CLAUDE.md`, which is exactly what was measured. The three global settings are a separate decision file. My pick there is to leave all three: no main-session turn has been measured, and both `refute-claims` controls said they could not rank.
- #1501's sandbox is a third decision file. `unshare --mount --net` works here, so the score-time gates can be sandboxed. The agent side cannot be, from inside the harness.

**Filed, from minors-only review rounds:** #1783, #1784, #1786, #1787, #1791, #1792 and #1793.

**Honest accounting.**

- 16 agents in all, well under the brief's stop at about 60: 9 arms and the gold, 1 referee, and 5 reviewers, two of them resumed for a second round.
- The `/bakeoff` skill in claude-skills carries its own copy of the harness, which still keeps `runs.json` and `referee-args.json` inside the run. Nothing here touched it.
- The brief's Node path (`v24.19.0`) does not exist. `.nvmrc` pins 24.22.1, and my first runs were on Node 22 before I noticed.
