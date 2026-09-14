# 13 — Research: what the docs provide, and what others do

This is the evidence base under the meta week's recommendations: what Claude Code's own controls provably are, and what practitioners outside this repo have built on top of them, held apart so neither can be read as the other.

It merges two research passes, both dated 2026-09-14: a verification pass over 37 official documentation pages fetched as raw markdown from `https://code.claude.com/docs/en/<page>.md` (one 404, `scheduled-routines`, which does not exist), and a survey of 46 community sources on running Claude Code at scale, from which 21 patterns were kept, 6 rejected, and 9 questions searched without finding a usable source.

Tags, carried with every claim: **DOC-CONFIRMED** (verbatim in the official docs), **DOC-REFUTED** (the docs say something materially different), **UNCONFIRMED** (searched across the 37 pages and absent, which is not the same as false), **PRACTICE-measured** (a source reporting numbers from a run it controlled; marked `(vendor)` where a vendor reports on its own product), **PRACTICE-anecdotal** (n of one, self-reported, no control), **PRACTICE-none** (assertion only). Only three claims below have been run against this machine, each marked **CHECKED (CLI 2.1.92)** and recorded in §7; everything else a recommendation might rest on that is not DOC-CONFIRMED is listed there too, with the check that would settle it.

---

## The controls Claude Code actually has

| Lever                                    | Exact name and location per the docs                                                                                                         | Verdict                                                    | The caveat that matters                                                                                                                                                                    | Doc page                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1. Concurrent subagent cap               | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, default 20, in the env-vars table and `sub-agents#concurrent-subagent-limit`                         | DOC-CONFIRMED                                              | `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`, default 10, also gates subagents and binds first. Ultracode sessions are exempt. `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` is a no-op since v2.1.224 | env-vars.md:297, 303; sub-agents.md:1013-1024                              |
| 1b. Nesting depth                        | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, default 3                                                                                            | DOC-CONFIRMED                                              | the default was 1 in v2.1.217-218, so the installed version decides behaviour                                                                                                              | env-vars.md:302                                                            |
| 2. Subagent model and effort             | `CLAUDE_CODE_SUBAGENT_MODEL`; `model` and `effort` frontmatter; per-invocation `model` parameter                                             | DOC-CONFIRMED                                              | the resolution order holds only from v2.1.251; before that the env var outranked frontmatter and the per-call parameter. The env var alone does not move built-in Explore or Plan          | sub-agents.md:296, 304, 345-352                                            |
| 3. `maxTurns`                            | `maxTurns` in `sub-agents#supported-frontmatter-fields`                                                                                      | field DOC-CONFIRMED, "default 10" UNCONFIRMED              | no default is stated on any of the 37 pages                                                                                                                                                | sub-agents.md:298, tools-reference.md:100                                  |
| 4. Stop a whole fan-out                  | `Ctrl+X Ctrl+K`; the `TaskStop` tool; `x` in `/tasks`                                                                                        | DOC-REFUTED (the earlier "not addressed in the docs")      | `Esc` interrupts the turn, not the subagents. A `TaskStop`-stopped agent is resumable; one stopped with `x` in `/tasks` is not                                                             | interactive-mode.md:22, 36; tools-reference.md:57; sub-agents.md:1073-1078 |
| 5. Auto-compact threshold                | `autoCompactWindow` setting, `/autocompact`, `--autocompact`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`                                              | DOC-CONFIRMED                                              | the env var outranks the other three, and takes plain integers only: `500k` reads as 500 and clamps to the 100000 minimum                                                                  | settings-reference.md:2634, model-config.md:698-700, env-vars.md:214       |
| 5b. `/compact <instructions>`            | `/compact [instructions]`                                                                                                                    | DOC-CONFIRMED                                              | none                                                                                                                                                                                       | commands.md:70                                                             |
| 5c. `PreCompact` hook                    | `PreCompact` event section in the hooks reference                                                                                            | DOC-REFUTED, both halves                                   | it can block; and its `systemMessage` and `continue` are discarded, with no `additionalContext` delivery                                                                                   | hooks.md:3015-3030, 1015-1019                                              |
| 6. Hook events                           | 33 `###` event sections in `hooks.md`                                                                                                        | 33 DOC-CONFIRMED, "9 can block" DOC-REFUTED                | 16 events say "Can block? Yes"                                                                                                                                                             | hooks.md:1120-3391, 880                                                    |
| 6a. Inject on every prompt               | `UserPromptSubmit` with `hookSpecificOutput.additionalContext`                                                                               | DOC-CONFIRMED                                              | none                                                                                                                                                                                       | hooks.md:1016, 1329-1390                                                   |
| 6b. Block a Bash command by pattern      | `PreToolUse` with `hookSpecificOutput.permissionDecision`                                                                                    | DOC-CONFIRMED                                              | a fourth value, `"defer"`, exists; top-level `decision` and `reason` are deprecated for this event                                                                                         | hooks.md:1573-1853                                                         |
| 6c. Run when a subagent finishes         | `SubagentStop`                                                                                                                               | event DOC-CONFIRMED, the stated limitation DOC-REFUTED     | it receives `last_assistant_message`, `agent_id`, `agent_type` and `agent_transcript_path`                                                                                                 | hooks.md:2360-2385                                                         |
| 6d. Block `Stop` until a condition holds | `Stop` with top-level `{"decision": "block", "reason": ...}`                                                                                 | DOC-REFUTED (the earlier "architecture limitation")        | every hook receives `transcript_path`, and the docs name "run the test suite before finishing" as the use case                                                                             | hooks.md:2499-2560, 748-762                                                |
| 6e. Blocking JSON shape                  | top-level `decision` plus `reason` for `UserPromptSubmit` and `Stop`                                                                         | DOC-REFUTED                                                | `permissionDecision` belongs to `PreToolUse` and `PermissionRequest`. The wrong shape yields a hook that runs and does nothing                                                             | hooks.md:1360-1375, 2520-2545                                              |
| 7. Prompt cache TTL                      | `promptCacheTtl`, `subagentPromptCacheTtl`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `experimental.cacheTtl` | DOC-CONFIRMED in full, including the 6-step priority order | only `5m` or `1h` are accepted, anything else ignored; requires v2.1.242+                                                                                                                  | prompt-caching.md:245-286                                                  |
| 7b. Cache invalidators                   | `prompt-caching#actions-that-invalidate-the-cache`                                                                                           | DOC-CONFIRMED, all nine verbatim                           | none                                                                                                                                                                                       | prompt-caching.md:65-78                                                    |
| 8. Session-start loading                 | the `memory.md` load-order table; `.claude/rules/*.md` with `paths` frontmatter; `@import`                                                   | DOC-CONFIRMED                                              | imports stop at four hops; a rule without `paths` loads at launch at `.claude/CLAUDE.md` priority; auto-memory loads 200 lines or 25KB, whichever comes first                              | memory.md:56-78, 97, 199-206, 403                                          |
| 8b. CLAUDE.md size guidance              | "target under 200 lines per CLAUDE.md file"                                                                                                  | DOC-CONFIRMED                                              | a file over 4 MiB is skipped entirely                                                                                                                                                      | memory.md:81, 458                                                          |
| 8c. Startup token budget                 | no such figures exist on any page                                                                                                            | UNCONFIRMED                                                | greps for every quoted figure return nothing; treat the earlier table as invented                                                                                                          | none                                                                       |
| 9. `permissions.deny`                    | `permissions.deny` over tool names, Bash patterns and `mcp__*` globs                                                                         | DOC-CONFIRMED                                              | a settings-file `mcp__` rule containing parentheses is silently skipped; allow rules cannot use an unanchored glob                                                                         | permissions.md:64, 121, 189-205                                            |
| 10. Token visibility                     | `/usage`, with `/cost` and `/stats` as aliases, plus `/context [all]`                                                                        | DOC-CONFIRMED, the earlier survey incomplete               | totals reset when `/clear` starts a new session                                                                                                                                            | commands.md:72, 74, 141, 156; costs.md:34                                  |
| 10b. Statusline token and cost fields    | the `statusLine` settings key with `type: "command"`; `cost.total_cost_usd`, `context_window.*`, `prompt_cache`, `rate_limits.*`             | DOC-CONFIRMED, the earlier name imprecise                  | it is not a fixed filename; `~/.claude/statusline.sh` is only the docs' example path                                                                                                       | statusline.md:180-196                                                      |
| 10c. OTEL per-subagent cost              | metrics carry `agent.name`; events carry `agent_type`; tool-decision events carry `subagent_type`                                            | DOC-REFUTED                                                | user-defined agent names are replaced with `"custom"`, so per-agent cost attribution does not work for your own agents                                                                     | monitoring-usage.md:575, 1137, 1206                                        |
| 10d. `~/.claude/stats-cache.json`        | absent                                                                                                                                       | UNCONFIRMED                                                | zero occurrences across all 37 pages; the claim that `costs.md` mentions it is false                                                                                                       | none                                                                       |
| 11. `ENABLE_TOOL_SEARCH`                 | `ENABLE_TOOL_SEARCH`: unset, `true`, `auto`, `auto:N`, `false`                                                                               | DOC-REFUTED                                                | unset is the default and defers all MCP tools; `auto` loads them upfront when they fit in 10% of context, so setting `auto` reduces deferral                                               | env-vars.md:434, mcp.md:1367                                               |
| 12. New-session model and effort         | the `model` and `effortLevel` settings; `/model`, `/effort`, `/fast`                                                                         | DOC-CONFIRMED with refinement                              | `/effort` writes to `modelSettings` for the active model, not to `effortLevel`; it also accepts `max`, `ultracode`, `auto`, `status`                                                       | settings-reference.md:883-893, 1028-1036; commands.md:84, 87, 110          |
| 13. Remote and cloud execution           | `claude-code-on-the-web`, `remote-control`, `routines`, `scheduled-tasks`                                                                    | DOC-CONFIRMED as new material                              | three separate products with different local-access properties; quotes and the comparison table are in §4                                                                                  | see §4                                                                     |

### Corrections to the earlier survey

The earlier lever inventory got the setting _names_ almost entirely right and the _semantics_ wrong in sixteen places. These are the traps: each one would produce a configuration that silently does nothing, or a conclusion drawn from a mechanism nobody opened.

| Earlier claim                                                                             | What the docs say instead                                                                                                                                                                        | Where                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Recalling a running fan-out is not addressed in the docs; stop each subagent individually | `Ctrl+X Ctrl+K` stops all running background subagents in the session, pressed twice within 3 seconds to confirm                                                                                 | interactive-mode.md:22          |
| `PreCompact` cannot block (logging only)                                                  | "Exit with code 2 to block compaction... You can also block by returning JSON with `\"decision\": \"block\"`."                                                                                   | hooks.md:3026                   |
| `PreCompact` can inject via `systemMessage` and `additionalContext`                       | both `systemMessage` and `continue` are discarded, and `PreCompact` is absent from the `additionalContext` delivery list                                                                         | hooks.md:3030, 1015-1019        |
| 33 hook events, 9 can block                                                               | 33 is right; 16 can block. Wrongly marked non-blocking: `PostToolBatch`, `TaskCreated`, `TaskCompleted`, `ConfigChange`, `TeammateIdle`, `WorktreeCreate`, `WorktreeRemove`, `ElicitationResult` | hooks.md:880ff                  |
| `UserPromptSubmit` and `Stop` block via `hookSpecificOutput.permissionDecision: "deny"`   | both use top-level `{"decision": "block", "reason": ...}`. Copying the earlier JSON produces a hook that fires and does nothing                                                                  | hooks.md:1360-1375, 2520-2545   |
| `Stop` input includes `stop_reason: "end_turn \| max_tokens \| stop_sequence"`            | `Stop` receives `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`. The only `stop_reason` in the docs is `"tool_deferred"`, from a `PreToolUse` defer            | hooks.md:2503                   |
| `SubagentStop` has no access to the subagent's final message                              | it receives `last_assistant_message` and `agent_transcript_path`                                                                                                                                 | hooks.md:2365                   |
| A `Stop` hook cannot read tool history, so it cannot know if tests ran                    | every hook receives `transcript_path`, and the docs give "run the test suite before finishing" as the worked example                                                                             | hooks.md:756                    |
| `ENABLE_TOOL_SEARCH` values are `auto` (default) and `false`                              | unset is the default and defers all MCP tools; `auto` loads them upfront when definitions fit within 10% of context. Setting `auto` _reduces_ deferral                                           | env-vars.md:434                 |
| OTEL metrics carry an `agent_type` attribute for per-subagent cost                        | metrics carry `agent.name` and events carry `agent_type`; on both, user-defined agent names are replaced with `"custom"` unless they come from an official-marketplace plugin                    | monitoring-usage.md:575, 1137   |
| `skillListingBudgetFraction` default 0.02                                                 | default `0.01`, reserving 1% of the context window                                                                                                                                               | settings-reference.md:2822      |
| `bashOutputMaxChars` default typically 8000-16000                                         | default unset, so Claude receives up to 30,000 characters inline; values clamp into 4000-128000                                                                                                  | settings-reference.md:2689-2690 |
| `maxEffortLevel` is managed-settings only                                                 | scope is any file; deploy it in managed settings to enforce it. It also accepts `"max"`, which sets no cap                                                                                       | settings-reference.md:1007      |
| `autoMode` is an object with `allow` and `deny` in permission-rule syntax                 | it takes `environment`, `allow`, `soft_deny` and `hard_deny` arrays of _prose_ rules plus the `classifyAllShell` boolean. There is no `deny` key                                                 | settings-reference.md:1339      |
| Five permission modes, the default named "manual"                                         | the mode is named `"default"`; values are `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`. `manual` exists only as a subagent-frontmatter alias for `default`           | hooks.md:759, sub-agents.md:297 |
| `--max-budget-usd` caps session spend                                                     | print mode only: "Maximum dollar amount to spend on API calls before stopping (print mode only)". It cannot cap an interactive session                                                           | cli-reference.md:102            |

Three further traps are not refutations but absences, and they are more dangerous for it. The **concurrency cap that actually binds** is `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` at a default of 10 (DOC-CONFIRMED), not the widely quoted 20; tuning only the 20 moves a ceiling that was never the ceiling. The **startup token budget table** ("system prompt ~4,200 tokens", "environment info ~280 tokens", and the rest) appears nowhere in the 37 pages (UNCONFIRMED); it looks invented and must not be used to size a CLAUDE.md. And **`~/.claude/stats-cache.json`** has zero occurrences anywhere (UNCONFIRMED), including in `costs.md`, where it was claimed to be mentioned. The two hook JSON shapes and `ENABLE_TOOL_SEARCH` are the silent ones: all three fail without an error message.

### The quotes the recommendations will be built on

Concurrency, both caps (DOC-CONFIRMED):

> "By default, when 20 subagents are running in a session, spawning another with the Agent tool fails with `Concurrent subagent limit reached`, and the error tells Claude not to retry." (sub-agents.md:1017)

> "`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | Maximum number of read-only tools and subagents that can execute in parallel (default: 10). Higher values increase parallelism but consume more resources" (env-vars.md:303)

> "Resuming a subagent that already finished takes a fresh slot without checking the limit, so resumes can push the running count past it." (sub-agents.md:1022)

> "`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | Removed in v2.1.224 and now a no-op." (env-vars.md:301)

Subagent model resolution order (DOC-CONFIRMED, version-sensitive):

> "1. The per-invocation `model` parameter / 2. The subagent definition's `model` frontmatter, where `inherit` selects the main conversation's model / 3. The `CLAUDE_CODE_SUBAGENT_MODEL` environment variable ... / 4. The main conversation's model" (sub-agents.md:347-352)

> "Before v2.1.251, `CLAUDE_CODE_SUBAGENT_MODEL` came first in this order and overrode both the per-invocation parameter and the frontmatter, including `model: inherit`." (sub-agents.md)

> "Setting `CLAUDE_CODE_SUBAGENT_MODEL` by itself doesn't change the model the built-in Explore and Plan subagents run on." (sub-agents.md)

`maxTurns`, field DOC-CONFIRMED and default UNCONFIRMED:

> "`maxTurns` | No | Maximum number of agentic turns before the subagent stops. When the subagent reaches the limit, Claude Code returns its output marked as partial, and Claude can resume it to continue." (sub-agents.md:298)

Auto-compaction and the env var that outranks everything else (DOC-CONFIRMED):

> "### `autoCompactWindow` — Set how full the context window gets before Claude Code compacts automatically." (settings-reference.md:2634-2636)

> "`CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Set the auto-compact window in tokens, from `100000` to `1000000`. Accepts a plain integer such as `500000` only: a value like `500k` reads as `500` and clamps to the 100K minimum. ... Takes precedence over the `/autocompact` command, the `--autocompact` flag, and the `autoCompactWindow` setting." (env-vars.md:214)

Hooks: which events can block, and the JSON contract that decides whether the block lands (DOC-CONFIRMED; the shapes below are what the DOC-REFUTED rows above got wrong):

> "`PostToolBatch` | Yes | Stops the agentic loop before the next model call" / "`TaskCreated` | Yes | Rolls back the task creation" / "`ConfigChange` | Yes | Blocks the configuration change from taking effect (except `policy_settings`)" / "`WorktreeCreate` | Yes | Any non-zero exit code causes worktree creation to fail" (hooks.md:880ff)

> "`decision` | `"block"` prevents Claude from stopping. Omit to allow Claude to stop" / "`reason` | Required when `decision` is `"block"`. Tells Claude why it should continue" (hooks.md, `Stop`)

> "To block a prompt, return a JSON object with `decision` set to `"block"`" / "`decision` | `"block"` prevents the prompt from being processed and erases it from context." (hooks.md, `UserPromptSubmit`)

> "`permissionDecision` | `"allow"` skips the permission prompt ... `"deny"` ... `"ask"` ... `"defer"`" (hooks.md:1573ff, `PreToolUse`)

> "`additionalContext` | String added to Claude's context alongside the submitted prompt." (hooks.md)

> "Use `additionalContext` when the hook is working as designed and giving Claude guidance, such as \"run the test suite before finishing\"." (hooks.md)

> "`transcript_path` | Path to conversation JSON." (hooks.md:756)

`permissions.deny`, including the asymmetry with allow (DOC-CONFIRMED):

> "A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it." (permissions.md:64)

> "Deny and ask rules also accept glob patterns in the tool-name position. The pattern must match the full tool name: `"*"` matches every tool, and `"mcp__*"` matches every MCP tool across all servers." (permissions.md:191)

> "To match a parameter on an MCP tool, pass a deny rule with `--disallowedTools`. When Claude Code loads a settings file, it skips any `mcp__` rule that has parentheses." (permissions.md:121)

> "An unanchored allow glob such as `"*"`, `"B*"`, or `"mcp__*"` is skipped with a warning and doesn't auto-approve anything." (permissions.md:203)

`/usage` and its aliases (DOC-CONFIRMED):

> "`/cost` | Alias for `/usage`" (commands.md:74) / "`/stats` | Alias for `/usage`. Opens on the Stats tab" (commands.md:141) / "`/context [all]` | Visualize current context usage as a colored grid." (commands.md:72)

> "These totals reset when `/clear` starts a new session, so the next session's total cost starts at \$0." (costs.md:34)

Prompt cache TTL and what invalidates it (DOC-CONFIRMED in full, the most accurate part of the earlier survey):

> "**Main conversation**: the `promptCacheTtl` setting, or the `CLAUDE_CODE_PROMPT_CACHE_TTL` environment variable / **Everything else**: the `subagentPromptCacheTtl` setting, or the `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` environment variable" (prompt-caching.md:273-274)

> "Each control takes `5m` or `1h`, and Claude Code ignores any other value." (prompt-caching.md:271)

All nine invalidating actions at `prompt-caching.md:69-77` match the earlier survey verbatim, and the 6-step priority order at `prompt-caching.md:280-286` matches exactly, including `FORCE_PROMPT_CACHING_5M=1` first and `ENABLE_PROMPT_CACHING_1H=1` fifth.

`.claude/rules` and `@import` (DOC-CONFIRMED):

> "Rules without `paths` frontmatter are loaded at launch with the same priority as `.claude/CLAUDE.md`." (memory.md:199)

> "Imported files can recursively import other files, with a maximum depth of four hops." (memory.md:97)

> "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." (memory.md:81)

> "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation." (memory.md:403)

The Remote Control, web and routines quotes are kept verbatim in §4, where they are used, rather than duplicated here.

---

## Patterns in the wild

Twenty-one patterns, grouped under the four pain points the meta week actually measured. A pattern's evidence tag is the community file's own; where a pattern is built on a lever from §2, the lever's verdict is carried with it, so a pattern standing on an UNCONFIRMED or DOC-REFUTED mechanism says so in the same breath.

### Pain point 1: context size per call

Measured this week: 76,150 deduplicated API requests between Aug 14 and Sep 14, against raw counters of 66.7M output, 315M cache-create and 13.9B cache-read tokens, which is roughly 183k cached tokens re-read on every request. The bill is shaped by what each call carries, not by what it writes.

#### P4. One session per deliverable, and `/clear` at the seam rather than `/compact`

Scope a session to one repo or one deliverable and clear between them. Source #20 states it as "New topic = new chat. No exceptions," and separates the tools cleanly: `/clear` wipes the conversation and suits a complete task switch, `/compact` summarises and suits a long thread you still need. Source #17 has the only A/B in the corpus: a single session with `cd` between repos averaged 42,800 tokens per task at a 31% rework rate, against 18,600 tokens and 8% rework for one session per repo, over a two-week split on a three-repo project. It also names the mechanism: file-cache collisions, `CLAUDE.md` loading only at startup so it never reattaches on a `cd`, and decisions for repo A leaking into repo B.

Evidence: PRACTICE-anecdotal (#17 is self-reported with no raw data, n=3 repos, one team; the mechanism explanation is more convincing than the table). Levers: session-start loading (DOC-CONFIRMED) is what makes the `cd` failure real, since rules load at launch; `/clear` and `/compact` are DOC-CONFIRMED, as is the fact that `/usage` totals reset on `/clear`.

Cost here: a habit, working against the grain. Sessions here are already project-scoped, so the change is ending them at deliverable boundaries instead of letting them run for days (median session span 29 hours, measured this week as carried by the community file). Optionally mechanised with a `SessionStart` hook that prints session age and compaction count.

What would make it wrong here: sessions are not one population. The operator's own figure of 92% of sessions carrying zero operator prompts (measured this week, carried by the community file) means a clear-discipline rule aimed at the human-driven minority is right and means nothing applied to the automation sessions. And `/clear` discards exactly the accumulated fleet state that makes the next sweep cheap, which is what P6 and P10 exist to catch.

#### P5. Budget context as displacement, not as a total

The RCWT preprint (Lelis and Cabral-Carvalho, CloudWalk, arXiv 2607.12216, read through #8) holds the window fixed at W=4096 and sweeps the share given over to coordination payload: shared state, prior agent messages, tool observations, role prompts. Accuracy is flat through a 69% coordination share and then falls off a cliff between 83% and 86%, the point at which residual task evidence is down to a few hundred tokens. The companion ablation is the important half: let the prompt grow instead of displacing, and at a 0.95 coordination ratio (13,262 coordination tokens around a 698-token task) every tested call on three models returns every scored field correctly, with no cliff. Coordination content costs by displacing task evidence under a fixed budget, not by competing with it semantically. Anthropic's "context rot" and "attention budget" framing in #1 is the softer version of the same point.

Evidence: PRACTICE-measured (peer-reviewable preprint) but read here through an AI-synthesised secondary, so second-hand. Levers: none directly; `/context` (DOC-CONFIRMED) is the instrument that makes the ratio observable.

Cost here: no configuration at all. It is a measurement discipline: run `/context` at the point where a session usually starts going wrong and record the split between coordination payload and task evidence.

What would make it wrong here: the experiment used a 4096-token window and a technical-spec recall task. On a 1M window the absolute residual is enormous even at a 90% coordination share, so the cliff may be unreachable and the ratio framing may be the wrong instrument at this scale. That is itself testable and should be tested before any rule is written on it.

#### P9. Subagents as context firewalls, not as personas

Source #11's negative result is the useful part: 100 subagents built, 12 kept, and the survivors are not specialists-by-persona but output quarantines. Their clearest example is a test run, where "mountains of output you don't want in your main thread" stay in the subagent and only "3 tests failed, here's what and why" comes back. Source #6 states the principle ("use subagents to keep research out of it") and #12 supplies the two-sided discipline: a poorly briefed subagent wastes its first turns rediscovering context you already had, and its summary lands back in your conversation and consumes context there, so "the boundary is a filter, not a wall with no cost on either side." #12 also draws the `/fork` line: a named subagent when a short precise brief suffices, `/fork` when context-transfer cost rather than output volume is the problem.

Evidence: PRACTICE-anecdotal, though mechanically obvious and consistent with #4's report that Claude Code caps tool responses at 25,000 tokens by default, meaning the vendor already treats verbose tool output as the thing to bound. Levers: subagent `model` and `effort` frontmatter (DOC-CONFIRMED) for routing the firewalls cheaply; `maxTurns` (field DOC-CONFIRMED, its default UNCONFIRMED) for bounding them.

Cost here: mostly already present. `context-mode` is a firewall of exactly this kind, and `Explore` exists but was used 35 times against `general-purpose`'s 1,040 of 1,348 spawns (measured this week). The change is routing, not building.

What would make it wrong here: if the subagent's returned report is itself long, the firewall leaks and the context is paid for twice. The rule that makes it work is an explicit output contract in the brief, which is the same thing #2 means by giving each subagent "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries."

#### P10. Write subagent output to the filesystem to kill the game of telephone

From #2's appendix: subagents write their artefact to disk and return a pointer, so direct outputs bypass the orchestrator's context entirely. #1 generalises it as structured note-taking: keep lightweight identifiers (file paths, stored queries, links) and load data just-in-time rather than pre-loading, which it names as "the approach Claude Code uses to perform complex data analysis over large databases."

Evidence: PRACTICE-measured (vendor); it is the architecture of a shipped product. Levers: none required, which is part of its appeal; it is a briefing convention, not a setting.

Cost here: already the operator's practice. `docs/meta-week/_data/` holds 2.1MB of aggregates so any figure is recheckable (measured this week, carried by the community file), which is precisely this pattern. The gap is that it is a project habit rather than a standing instruction to dispatched subagents.

What would make it wrong here: a pointer is only cheap if the reader can find it. Writing 26 research files nobody indexes converts a context problem into a discovery problem, which is P11's problem.

#### P12. Trigger-matched context injection instead of a larger `CLAUDE.md`

`remindcc` (#24) stores markdown in `.remindcc/` with trigger patterns, and a `UserPromptSubmit` hook injects a file's content as additional context only when the prompt matches. #29 confirms the primitive: for `UserPromptSubmit`, plain stdout is added as context Claude can see. The complementary half is size discipline on the always-loaded file. #20 says keep `CLAUDE.md` under 200 lines with "three rules and three pointers" because past that length the file stops being followed reliably, and #21 puts it as "a tight 40-line CLAUDE.md beats a sprawling 400-line one that repeats things the model can infer from the code."

Evidence: PRACTICE-none for the injection tool, which is a small repo with no usage data. The 200-line figure, which #20 attributes to Anthropic's docs, is DOC-CONFIRMED at memory.md:81. Levers: `UserPromptSubmit` with `hookSpecificOutput.additionalContext` (DOC-CONFIRMED, one of the few hook shapes the earlier survey got right); `.claude/rules` with `paths` frontmatter (DOC-CONFIRMED) is the built-in alternative that needs no hook at all.

Cost here: one hook plus a directory, and zero project hooks exist today (measured this week), so this would be the first. The real work is the migration: deciding which rules are always-on and which are trigger-scoped. Natural candidates are the archived-repos rule, the Discord tone and credential block, and the starter-track cherry-pick rule.

What would make it wrong here: this repo's `CLAUDE.md` is not padding, it is narrative carrying _why_, and the archived-repo trap has already cost three sessions a completed sweep. A trigger that misses ("do a pass over all the sites" contains neither "sweep" nor "fleet") silently removes the guardrail on exactly the prompt that needed it. Trigger-scoping trades a known cost for an unbounded one, so it should start with rules whose failure is cheap.

#### P14. Move browser work out of the interactive session

Source #43 draws the line between Playwright MCP (tools as named functions, setup and token overhead, structured browser state streamed into context) and Playwright CLI (shell commands, with `--save-storage` and `--load-storage` persisting cookies and session state between runs). The CLI writes browser state to disk instead of streaming it into context on every action, and the same commands that run interactively run inside a pipeline, since Claude Code's headless mode accepts instructions via stdin or flags and exits cleanly.

Evidence: PRACTICE-none, no measurement; the mechanism argument is sound and the storage flags are checkable against Playwright's own docs. Levers: `permissions.deny` with an `mcp__*` glob (DOC-CONFIRMED) is the enforcement half, with the caveat that a settings-file `mcp__` rule containing parentheses is silently skipped.

Cost here: moderate. Existing memory already records browser-layer pain (`networkidle` broke 4 of 14 sites; CI installs no Playwright browser; corpus-refresh starvation). Moving this work off the laptop also removes the local dev-server contention class.

What would make it wrong here: two recorded hazards point the other way. CI here already installs no Playwright browser, so moving more work into CI widens a gap that setup drift can hide; and the corpus-refresh memory records CPU starvation silently degrading checks while exiting 0, which is harder to see in CI than on a laptop. Moving the work wins only if the CI job's own instrument is proven first.

### Pain point 2: fan-out breadth, and stopping it

Measured this week: limit blocks correlate with concurrent subagent breadth at r=0.56, and `general-purpose` accounts for 1,040 of 1,348 subagent spawns, all of them inheriting a global default of a 1M-context model at the highest effort.

#### P1. Scale effort to task complexity, written into the dispatch prompt

Anthropic found their lead research agent could not judge appropriate effort on its own, so they embedded explicit scaling rules in the prompt: "Simple fact-finding requires just 1 agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each, and complex research might use more than 10 subagents with clearly divided responsibilities" (#2). The same post names the failure that motivated it: with vague briefs, one subagent explored the 2021 automotive chip crisis while two others duplicated work on current supply chains. Anthropic's Opus 5 prompting guide, quoted in #8, adds the blunt version: "if one subagent can complete the task, use one rather than several."

Evidence: PRACTICE-measured (vendor), shipped in a production system. The constants are tuned for research, not for a 40-repo fleet, so the shape transfers and the numbers do not. Levers: none; this is prompt text, which is why it is cheap and also why it is not enforcement.

Cost here: a prose block in a dispatch skill, preferably not in `CLAUDE.md`. Zero runtime cost. The measured spawn profile says the current default is "spawn a generalist" with no effort ladder at all.

What would make it wrong here: a 40-repo sweep is genuinely wide, and the right unit is one agent per repo. A flat "use 2-4" rule would make sweeps serial and trade the token problem for a wall-clock problem the operator ranks above token efficiency. The rule has to be written as breadth per independent unit of work, not breadth per message.

#### P2. Deterministic caps in the harness, not guidance in the prompt

Anthropic's prompting guide recommends that harness authors write "deterministic caps on how many agents can be launched," and Claude Code shipped exactly that. Per the CHANGELOG as quoted in #8 (v2.1.200 to v2.1.220, snapshotted 2026-08-03): 200 subagent spawns per session reset by `/clear`, 200 WebSearch calls per session, and 20 concurrently running subagents "so one message can't fan out unbounded background agents." #8 adds two items the docs pass did not confirm: that `--max-budget-usd` denies new spawns and halts running background agents at the cap, and that `workflowSizeGuideline` defaults dynamic workflows to "aim for fewer than 15 agents."

Evidence: PRACTICE-none (a vendor claim reaching us through a secondary quoting a changelog), and two of its four claims collide with the docs. `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` is DOC-REFUTED as a live cap, "Removed in v2.1.224 and now a no-op" (env-vars.md:301), so the 200-per-session ceiling does not exist. `--max-budget-usd` is DOC-REFUTED as anything but a print-mode flag (cli-reference.md:102) and now CHECKED (CLI 2.1.92): the flag exists and its own help text reads "Maximum dollar amount to spend on API calls (only works with --print)". It is a headless cap. Whatever halting behaviour #8 describes applies at most to a `claude -p` run, and an interactive session and the subagents it dispatches do not inherit it, so this pattern offers **no** answer to "stop requests that did not stop dispatched agents" in an interactive session. `workflowSizeGuideline` is UNCONFIRMED. What survives is the 20-concurrent cap (DOC-CONFIRMED) and, more importantly, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` at 10 (DOC-CONFIRMED), which binds first and which neither source discusses. For interactive work the only stop mechanisms left standing are `Ctrl+X Ctrl+K`, `TaskStop` and `x` in `/tasks` (all DOC-CONFIRMED), and a budget wrapper is available only by moving the work into `claude -p`.

Cost here: three or four keys in `~/.claude/settings.json`. The tool-use concurrency cap is the one that binds.

What would make it wrong here: a cap set below the natural width of a fleet sweep turns a 27-site pass into a queue, and the operator ranks work done between prompts above token efficiency. Set the cap at the observed useful width, not the width that feels safe, and prove it by running one real sweep under it.

#### P3. Route workers to cheaper models, and audit `CLAUDE_CODE_SUBAGENT_MODEL` first

Keep the planner on the strategic model and set `model: haiku` or `model: sonnet` in each worker's frontmatter (#9, #10). The load-bearing part is the trap: #9, citing a GitHub issue with a 3-of-3 and 2-of-2 test matrix, reports that `CLAUDE_CODE_SUBAGENT_MODEL` overrides the frontmatter `model` field "with no signal in `tool_result` and no warning in the transcript." Its suggested audit is two lines: echo the variable, then unset it and restart. #9 is unusually honest about its own headline: "Model routing alone cuts the subagent line item roughly 30%. The '2x' is a throughput number... If you read '2x faster' as 'save 50% on tokens,' that is not what ships."

Evidence: PRACTICE-anecdotal for the savings figure; the per-call arithmetic is checkable against published pricing, and the "85% of a heavy session came from subagents" headline is a Reddit `/usage` screenshot quoted by a content site and should not be planned against. The override trap is DOC-CONFIRMED but version-scoped: sub-agents.md:347-352 puts the env var _third_, behind the per-invocation parameter and frontmatter, and notes that "before v2.1.251, `CLAUDE_CODE_SUBAGENT_MODEL` came first in this order and overrode both." So the community's warning is correct for older builds and inverted for current ones, which makes the version check the first step.

Cost here: one env audit plus frontmatter on agent definitions that already exist. #9's measurement protocol fits this repo: snapshot `/usage` (DOC-CONFIRMED), run normally for seven days, snapshot again.

What would make it wrong here: if a cheaper worker produces work that gets redone, routing costs more than it saves, and redo is already a named waste class. Correctness is the operator's first priority, so route the context-firewall agents of P9, where a wrong answer is immediately visible, and leave judgement agents on the strategic model.

#### P13. Know what is actually still running

Source #39 names two built-in self-checks nothing else in the corpus mentions: `claude daemon status` reports whether a background daemon is running, the socket directory, and the worker count from `roster.json` (a clean machine shows `0 workers` and `roster.json: absent`), and `claude agents --json` lists every live session with PID, cwd, `kind` (interactive against background or programmatic) and status. The procedure is to find PIDs whose `kind` is not your interactive session or whose cwd you have left, confirm the daemon's worker count, kill the orphans, and re-run both to confirm.

Evidence: both commands are now CHECKED (CLI 2.1.92) and **neither does what #39 says**. `claude agents` is documented in its own help as "List configured agents", taking `--setting-sources user,project,local`: it enumerates agent _definitions_, not running agents, and so cannot answer the runaway-agent question at all. There is no `claude daemon` subcommand in this build; `claude daemon --help` falls through to the general help, so the `roster.json` worker count has nothing behind it here. #39 also reports an in-product kill-all as `Ctrl+F` pressed twice within 3 seconds, which disagrees with the DOC-CONFIRMED `Ctrl+X Ctrl+K` at interactive-mode.md:22, and reports issues claiming there is "no way to terminate one by task ID", which the docs contradict: `TaskStop` "Stops a running background task by ID" (DOC-CONFIRMED, tools-reference.md:57). Those issue bodies were not read.

The pattern survives; its implementation does not. The claim worth keeping is that "stop did not stop it" should be a checkable fact rather than a suspicion. What remains checkable on this build is `/tasks` (DOC-CONFIRMED) as the enumeration surface, `TaskStop` as the per-agent stop, and `Ctrl+X Ctrl+K` as the session-wide one; an OS-level `ps` sweep is the fallback for anything `/tasks` does not show. The version gap is worth noting before anyone re-runs this: the CLI on PATH is 2.1.92 while transcripts show the VS Code extension bundling 2.1.263 to 2.1.270 (the extension builds seen in transcripts on 2026-09-14, all past the v2.1.251 change to subagent model resolution), so a subcommand absent here may exist there.

Cost here: a habit, and optionally a statusline or `SessionStart` line printing the live-agent count from `/tasks` rather than from the two commands #39 names. Near zero.

What would make it wrong here: any such check reports the local view only. A subagent that has already dispatched an API request has spent those tokens whether or not the process is killed, so this bounds future spend, not sunk spend. It is containment, not a refund.

#### P15. Off-laptop persistence: tmux over a stable address

The minimal stack is consistent across #41 and #42: tmux for session persistence, a stable network address (Tailscale in #41), and SSH or a mobile client on top. #41 is Mac-mini-specific and names the traps: the Remote Control process is a foreground process, so "closing your terminal, rebooting, or losing network for ~10 minutes will kill the session," and macOS "has three things that will kill sessions on a headless Mac, requiring special handling." #40 (`fleet`) is the multi-session layer, tmux-backed with resume via `claude --resume` and idle hibernation because each resumed agent holds about 400MB. #18 reports the practical ceiling from the same constraint: on a Mac mini M4 with 32GB, three full sessions sit at 6-8GB resident and four to five start competing for memory.

Evidence: PRACTICE-anecdotal throughout; the ~400MB figure is the only hard number and comes from a tool author. Levers: Remote Control (DOC-CONFIRMED, §4), including its requirement that `ANTHROPIC_BASE_URL` point at `api.anthropic.com`.

Cost here: hardware plus a day of setup, and a credential decision. This environment's sandbox already denies reads on `~/.ssh`, `~/.aws` and `~/.config/reddoor-maint`, and this repo's `.env` holds the Discord bot token, so a second machine is a credential-distribution question before it is an ops one.

What would make it wrong here: the concurrency ceiling here is a usage-limit ceiling, not a RAM ceiling. Moving to a bigger box removes a constraint that is not binding and may encourage more concurrent breadth, which is the thing measured at r=0.56. Adopt it for persistence, not for parallelism.

#### P16. Coordinate through a claimed shared file, not through messages

Source #14 describes a structured task list in the project directory that every agent reads and writes, so that "rather than messaging each other, agents read and write state." Each task carries pending, in-progress, completed or blocked; an agent claims one by marking it in-progress with its own identifier, so no other agent takes it; on finish it writes output back and unblocks dependents. The stated advantages are no messaging infrastructure, work state that survives a crashed agent, and a file a human can read at any point. The stated cost is latency, since agents learn by re-reading. Its companion design rule is to give each subagent a distinct part of the problem: separate files, separate modules, separate concerns.

Evidence: PRACTICE-none, presented as the common pattern. Levers: none; it is a filesystem convention, and it is P10 applied to coordination rather than to output.

Cost here: low, and the human-level version already exists in this repo's claim protocol for fleet signals. Extending the same protocol one level down, to agents dispatched within a sweep, is a small generalisation of a rule that already works.

What would make it wrong here: the operator's own note that absence of a tracking issue is not absence of a failure applies directly. A claim file answers who is on it and never answers what was never started.

#### P17. Worktree per agent only when the outputs are alternatives

Two cases from #8 invert on the same question. Bun's Zig-to-Rust port (Jarred Sumner, 11 days in a real repo) peaked at 64 concurrent Claudes as 4 workflow shards of 16 agents, one git worktree per shard, and the shape is described as the residue of constraints rather than a design ideal. Two minutes into the first full run on a shared tree, "one Claude ran `git stash` before committing. Another ran `git stash pop`. And then `git reset HEAD --hard`." The fix was a command deny-list in the workflow prompt: never `git stash`, never `git reset`, no git command that does not commit a specific file at once, no `cargo`, "no slow commands at all". Worktree-per-agent was rejected there because 64 checkouts do not fit on disk and because the changes eventually have to compile together. SwarmResearch (UIUC, arXiv 2607.02807) does the opposite, a branch and worktree per agent, because the task is open-ended optimisation and competing solutions are never meant to merge. #8's synthesis is the transferable rule: worktree-per-agent "is scalable exactly when the outputs are alternatives rather than parts."

Evidence: PRACTICE-measured for Bun (a first-hand case study reporting failure modes rather than scores) and PRACTICE-measured for SwarmResearch (an empirical paper), both read through an AI-synthesised secondary. Levers: `permissions.deny` over Bash patterns (DOC-CONFIRMED) and `PreToolUse` with `hookSpecificOutput.permissionDecision` (DOC-CONFIRMED) are the two ways to make the deny-list mechanical.

Cost here: the worktree rule already exists and is obeyed, with 5 live worktrees (measured this week, carried by the community file). What is missing is Bun's other half, the git-command deny-list. This environment's own prompt warns that the stash stack is shared across worktrees and that other sessions may pop it, so the exact command pair that destroyed Bun's tree in two minutes is a known hazard here currently guarded only by prose.

What would make it wrong here: a deny-list implemented as a `PreToolUse` hook on Bash must distinguish `git stash push -u -m "<tag>"`, which this repo's instructions prescribe, from bare `git stash`. Get that wrong and it blocks the sanctioned path while allowing the dangerous one.

#### P20. Effort as a per-task dial

Source #23 ran five everyday coding tasks at High and at Medium effort and reports that Medium completed the same five jobs "while generating 45% fewer output tokens, spending less time processing them, and showing no obvious drop in the quality of the results," while explicitly not recommending Medium for complicated debugging, architectural decisions, or genuinely difficult problems. #20 gives the two controls: `/effort low` per session, or `MAX_THINKING_TOKENS=8000` as a hard cap, noting that extended thinking is billed as output tokens and the default budget "can run into the tens of thousands of tokens per request without notice", with the counterweight "don't under-invest on decisions that matter."

Evidence: PRACTICE-anecdotal and weak (n=5, one author, subjective quality). Levers: `effortLevel` and `/effort` (DOC-CONFIRMED with the refinement that `/effort` writes `modelSettings` for the active model, not `effortLevel`), plus per-subagent `effort` frontmatter (DOC-CONFIRMED) and `maxEffortLevel` (DOC-CONFIRMED, any settings file, not managed-only as previously claimed).

Cost here: one setting, trivially reversible and locally A/B-able. Output tokens are 66.7M against 13.9B cache-read (measured this week), so this is the lowest-leverage item on the numbers. It earns a place because the global default is the highest effort on every call including every subagent, which means the dial is currently welded.

What would make it wrong here: correctness is the first priority and the work is fleet-wide change where a subtle wrong answer propagates to roughly 27 sites. A 45% output saving that costs one bad sweep is a loss. The defensible version is per-agent-type: low effort on the context-firewall workers of P9, unchanged on judgement.

#### P21. Budget caps as a first-class control, kept for the idea only

OpenHands Cloud (#44) exposes an organization budget with threshold alerts, a default user budget applied to new members, per-user overrides, and a `GET /api/organizations/{org_id}/members/financial` endpoint for programmatic per-member spend. Aider's nearest equivalent is `--max-chat-history-tokens` plus provider-side spend limits; Codex CLI has no native per-session budget.

Evidence: PRACTICE-none, and adjacent by construction: the operator is on a subscription, not metered spend. The transferable idea is that a budget should be enforced by the harness and observable programmatically. The community file nominates `--max-budget-usd` as Claude Code's analogue on the strength of P2's halting claim, which is DOC-REFUTED (print mode only, cli-reference.md:102) and CHECKED (CLI 2.1.92) as "Maximum dollar amount to spend on API calls (only works with --print)". A dollar budget is therefore available here only for headless `claude -p` work, which is a real option for scheduled sweeps and no option at all for an interactive session. What remains for interactive work is a budget expressed in concurrent subagents, which is `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (both DOC-CONFIRMED).

Cost here: zero to think with, and nothing to install.

What would make it wrong here: a dollar cap is not a usage-limit cap. On a subscription the two are loosely related at best, and treating `--max-budget-usd` as a proxy for "don't hit the weekly limit" would be one more instrument nobody read.

### Pain point 3: work redone after compaction

Measured this week: 254 compactions in the window, mostly manual, with no instrument on any of them.

#### P6. `PreCompact` writes a handoff, `SessionStart` reads it back

Three independent implementations of one shape (#32, #33, #34), plus a 12-line reference script in #28. `PreCompact`, scoped with `matcher: "auto"` so it catches context-pressure compactions and not manual `/compact`, writes the session's working notes to a durable path; `SessionStart` with source `compact` (or `clear`) reads them back as `additionalContext`. #33 adds the refinement that matters most: the handoff carries a continuation prompt, so the session resumes its work rather than resuming a lossy summary. #34 makes retention tunable (`HANDOFF_MAX_USER_MESSAGES`, `HANDOFF_DEDUP_THRESHOLD`, last 15 user messages, dedup at 0.85) and covers the `/clear` path too. Anthropic's framing supports the shape: compaction preserves "architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs", and "the art of compaction lies in the selection of what to keep versus what to discard" (#1), a selection #6 says can be biased from `CLAUDE.md`.

Evidence: PRACTICE-anecdotal. All three repos describe the mechanism well and none reports a before and after; #32's 92-session provenance is the strongest claim available and is still self-reported. Levers: `PreCompact` (DOC-CONFIRMED as an event, and DOC-REFUTED in the earlier survey's claim that it cannot block), with the critical constraint that `PreCompact` cannot inject: its `systemMessage` and `continue` are discarded and it delivers no `additionalContext` (hooks.md:3030, 1015-1019). So the write half is a hook side effect and the read half must be a separate `SessionStart` hook. `autoCompactWindow` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (DOC-CONFIRMED) decide when it fires.

Cost here: one hook script and one convention. Zero project hooks exist (measured this week), so this would be the first, which is an argument for it being the first: low blast radius and purely additive.

What would make it wrong here: this repo's own rule. A handoff hook that has only ever been observed writing a file is an untested assertion; it has to be proven by deliberately triggering a compaction on a known-good session and reading what came back, or the first time it matters is the first time you learn it captured the wrong 15 messages. The `CLAUDE.md`-instruction variant is guidance, not enforcement, and can be ignored silently.

#### P7. A context meter with a hard stop, not just a warning

#32's `context-monitor.sh` runs on `PostToolUse` with three-tier alerts at 40%, 60% and 70%, and a hard stop at 70% that forces a handoff before in-progress work can be lost to truncation. Its companion `handoff-check.sh` runs on `Stop` and flags an incomplete `session-state.md` that "would cause the next session to start blind." The passive version is the statusline: #37 describes a line showing context-window fill with a colour ramp, 5-hour session use with reset time, and 7-day rolling use with reset time. #38 (`ccusage statusline`) adds burn rate with thresholds (green below 2,000 tokens per minute, yellow 2,000 to 5,000, red above 5,000) and configurable context bands.

Evidence: PRACTICE-anecdotal for the hard stop; the statuslines are readouts, so there is nothing to prove beyond the correctness of their numbers. Levers: the `statusLine` settings key with `type: "command"` and the `context_window`, `prompt_cache` and `rate_limits` fields (DOC-CONFIRMED, with the correction that there is no fixed statusline filename); `PostToolUse` for the hard stop; `/context` (DOC-CONFIRMED) as the manual equivalent.

Cost here: statusline is one settings key and minutes. The hard stop is a `PostToolUse` hook that fires on every tool call, so it has to be genuinely cheap.

What would make it wrong here: the thresholds are calibrated for a roughly 200k window. At 1M, 70% is 700k and the hard stop would effectively never fire; or, if the percentage is computed against an auto-compact threshold rather than the window (one source reports autocompact firing at 76k on a 1M window, PRACTICE-anecdotal), it would fire constantly. This is the clearest case in the corpus for the prove-the-instrument rule: show the monitor emitting a correct green reading on a known-good session before trusting any red it produces.

### Pain point 4: building on an unread mechanism, and re-deriving what exists

This is the waste class the repo's central rule already names, and the one where the community corpus has least to offer: the published practice is behind the house rule.

#### P8. A `Stop`-hook completion gate, written so that it can pass

Source #27 gives the canonical script: read the hook payload, bail immediately if `stop_hook_active` is true, otherwise run the check and emit `{decision: "block", reason: ...}` on failure. Two details appear only in the good sources: Claude Code caps a `Stop` hook at 8 consecutive blocks by default, raiseable with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, so a gate that ignores `stop_hook_active` burns straight through them; and for softer steering you return `hookSpecificOutput.additionalContext` instead of `decision: "block"`, giving the same continuation labelled as feedback rather than as a hook error. #31 states the motivating case plainly: "'Done' is a claim, not a checked result." #29 adds that exit code 2 "creates a feedback loop directly to Claude", making the error message input rather than a user-visible failure.

Evidence: PRACTICE-none for effect; no source reports a measured reduction in false completion claims. The mechanism is DOC-CONFIRMED and is one of the places the earlier survey was most wrong: `Stop` blocks via top-level `decision` and `reason`, not `permissionDecision`, and it receives `transcript_path`, so the "cannot read tool history" objection is DOC-REFUTED. The 8-block cap and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` are UNCONFIRMED against the 37 pages.

Cost here: one hook of roughly 15 lines. The natural gate is not "tests pass" but this repo's own rule: if this turn introduced a new gate, alarm, check or probe, has it been shown to pass on a known-good input? The motivating measurement is that `verification-before-completion` was invoked once in seven weeks (measured this week, carried by the community file) against a repo whose central rule it encodes.

What would make it wrong here: two ways, both already in this repo's history. A `Stop` gate that can only fail is the 2026-08-12 mistake with a new coat of paint and must be demonstrated green on a clean tree first. And a test-running gate on a slow suite adds wall-clock to every turn, trading against time efficiency and work done between prompts, so it has to be scoped to a fast, targeted check.

#### P11. Make read-before-build mechanical with a ranked capability map

Aider (#25) sends a repo map with every request: files with the key symbols each defines, including the critical lines of each definition. Because the whole map will not fit, it runs "a graph ranking algorithm, computed on a graph where each source file is a node and edges connect files which have dependencies", and selects the most relevant portions to fit an active token budget, `--map-tokens`, default 1k, dynamically resized and expanded when no files are in the chat. The stated purpose is exactly this waste class: the map "helps aider write new code that respects and utilizes existing libraries, modules and abstractions found elsewhere in the codebase." #26 states the norm version: make the agent prove it understands the codebase before it changes the codebase.

Evidence: PRACTICE-none for effect (a shipped mechanism with a published design, but no A/B on duplicate-code reduction was found). Levers: Claude Code has no repo map, so the reproducible version is a generated index plus `SessionStart` or `.claude/rules` with `paths` frontmatter (both DOC-CONFIRMED) to bring it in only when relevant, combined with P12 so it enters context only on build-shaped prompts.

Cost here: a generated `docs/CAPABILITIES.md` of exported symbols per package. For a 40-repo fleet the high-value index is not per-repo symbols but the shared-package surface, since that is where fix-once lives.

What would make it wrong here: a stale index is worse than none. It will confidently assert that a helper exists which was renamed, and the agent will build against a ghost. It must be generated, never hand-maintained, and must fail loudly when generation fails.

#### P18. Verify, do not review

Source #45, building on a Simon Willison note, splits the reviewer's job in two: the correctness question, which infrastructure should answer ("tests, smoke checks, conformance suites, sandboxes, quality gates... that proves correctness without requiring you to read every line"), and the comprehension question, which is a real cost to be budgeted rather than pretended away. Its sharpest line: "The AI-blind phenomenon is not a bug, it is your brain correctly identifying that line-by-line reading of AI-generated output is a poor use of cognitive bandwidth." #46 supplies the scale: Faros telemetry across 22,000 developers shows median code-review time up 441.5% while task throughput rose 33.7%; LinearB across 8.1M PRs finds AI-assisted PRs about 2.5x larger and waiting about 5x longer; Sonar's State of Code 2026 finds 96% of developers do not fully trust AI code's functional accuracy while only 48% verify it before committing.

Evidence: PRACTICE-measured at large n, but read through a secondary that cites the studies rather than the studies themselves; the framing itself is argument, not measurement. Levers: `Stop` hooks (DOC-CONFIRMED) are the enforcement layer this framing implies, which is P8.

Cost here: conceptual. It reframes the open question away from "should the operator review more PRs", which contradicts maximising work done between prompts, and toward "which gate is missing, and has it been proven able to fail." The measurement it speaks to is 2.0% of merged PRs carrying any review, with 62% merging within an hour (measured this week, carried by the community file): read through #45's lens that is a PR functioning as a commit-with-CI, which puts the entire correctness burden on the gates.

What would make it wrong here: it licenses not reading the diff, and this repo's history contains at least three cases where the right answer came only from reading raw output, including the setup-node v7 probe whose VERDICT line grepped the wrong command. "Verify, do not review" is safe exactly in proportion to how well the verifier has been proven, and unsafe by the same amount when it has not.

#### P19. RED-GREEN as an executable step, not a principle

`obra/superpowers`' `verification-before-completion` skill (#35) reduces the house rule to a four-beat sequence: write, run and pass, revert the fix, run and it must fail, restore, run and pass again; with the explicit counter-example "I've written a regression test" asserted without red-green verification. It is preceded by a loop of identifying which command proves the claim, running the full command, reading the output and the exit code, and then stating either the claim with evidence or the actual status with evidence.

Evidence: PRACTICE-none. It is a discipline, and its only evidence here is negative: one invocation in seven weeks (measured this week, carried by the community file) against a repo whose `CLAUDE.md` opens with this exact rule. Levers: `Stop` hook blocking (DOC-CONFIRMED) is the only mechanism in §2 that could make it bind, since skills are opt-in.

Cost here: zero to adopt, since it is installed. Non-zero to make it bind. #27's decision test is the relevant one: "what is the cost when the model ignores this once? Annoyance leads to CLAUDE.md. Incident leads to hook." By that test the prove-the-instrument rule is incident-grade and currently lives in the wrong layer.

What would make it wrong here: some instruments cannot be reverted to prove failure, including a credentials check, an external API probe, or a rate-limited endpoint. A hook demanding a red proof for every gate would block the cases where the red proof is the expensive part, and the operator would learn to route around it. Scope it to gates whose inputs are local and cheap to falsify.

---

## Off the laptop (#776)

The docs describe three products, distinguished by where the code runs, and the distinction decides what each can reach.

**Claude Code on the web** runs in the cloud with no local access. "Claude Code on the web runs tasks on Anthropic-managed cloud infrastructure at claude.ai/code, or on your organization's self-hosted environment when routed there" (DOC-CONFIRMED, claude-code-on-the-web.md). The handoff is one-directional: "From the CLI, session handoff is one-way: you can pull cloud sessions into your terminal with `--teleport`, but you can't push an existing terminal session to the web. The `--cloud` flag with a task description creates a new cloud session" (claude-code-on-the-web.md:61). A laptop session cannot be migrated off the laptop; work can only be _started_ in the cloud.

**Remote Control** runs locally with a remote UI, and is the only one of the three that keeps local credentials and files. "When you start a Remote Control session on your machine, Claude keeps running locally the entire time, so your code execution and filesystem access stay on your machine" (DOC-CONFIRMED, remote-control.md), and "your filesystem, MCP servers, tools, and project configuration all stay available". The docs are explicit that "the web and mobile interfaces are a window into that local session." Two requirements matter here: a Pro, Max, Team or Enterprise plan rather than API keys, and it is disabled if `ANTHROPIC_BASE_URL` points anywhere other than `api.anthropic.com` (remote-control.md:30-36).

**Routines** are saved configurations that run on a schedule or a trigger, on cloud infrastructure: "A routine is a saved Claude Code configuration: a prompt, one or more repositories, and a set of connectors, packaged once and run automatically" (DOC-CONFIRMED, routines.md), triggered on a recurring cadence, by an HTTP POST to a per-routine endpoint with a bearer token, or by GitHub repository events, and managed at claude.ai/code/routines or with `/schedule`. The page is `routines`; `scheduled-routines` does not exist and returns 404.

The decisive comparison is the table at scheduled-tasks.md:17-27 (DOC-CONFIRMED). Cloud routines require no machine on and no open session, have a minimum interval of 1 hour, run autonomously with no permission prompts, and have **no access to local files**, working from a fresh clone. Desktop runs on your machine, requires the machine on but no open session, has a 1-minute minimum, and has local file access. `/loop` runs on your machine and additionally requires an open session. Cloud sessions also have no route to a local browser or credential store: "An API credential is an API key or token you store on a cloud environment so Claude can call that API from any session in the environment without seeing the key" (cloud-environments.md:83), and those are "available on Pro and Max plans. They aren't available on Team or Enterprise plans yet" (cloud-environments.md:85). Cloud sessions also "call the Anthropic API from Anthropic-managed infrastructure, not your network" (claude-code-on-the-web.md:353), which matters wherever an IP allowlist is in play.

Practitioners running on a second machine report a consistent minimal stack and one trap. tmux plus a stable address plus SSH or a mobile client is the whole recipe (#41, #42, PRACTICE-anecdotal): start Claude Code in tmux, close the SSH connection, return hours later to everything where you left it. The trap is that the Remote Control process is a foreground process, so "closing your terminal, rebooting, or losing network for ~10 minutes will kill the session", and macOS "has three things that will kill sessions on a headless Mac, requiring special handling" (#41, PRACTICE-anecdotal). Memory is the other constraint: each resumed agent holds about 400MB (#40, PRACTICE-anecdotal, tool author), and on a 32GB Mac mini "three full sessions hover at 6-8 GB resident. Four to five starts competing for memory" (#18, PRACTICE-anecdotal).

That leaves three concrete options.

**Option A: Remote Control from the current laptop.** Reaches the whole local fleet as it stands, all 40 checkouts, the MCP servers, the credentials in `~/.config/reddoor-maint` and the Discord token in this repo's `.env`. Cannot reach anything while the laptop is asleep, off the network for more than about ten minutes, or rebooted (PRACTICE-anecdotal), and cannot run at all if `ANTHROPIC_BASE_URL` is pointed anywhere but `api.anthropic.com` (DOC-CONFIRMED). It buys a phone-shaped window onto the same single machine, nothing more.

**Option B: an always-on second machine running tmux plus Remote Control over a stable address.** Reaches persistence: work continues while the laptop is shut, and sessions are enumerable rather than scattered across terminal tabs. Cannot reach any relief from the binding constraint, because the ceiling here is the plan's usage limit rather than RAM, and adding a machine that makes concurrency easier pushes on the variable measured at r=0.56 (measured this week). It also cannot reach the credential question, which it forces: the sandbox already denies reads on `~/.ssh`, `~/.aws` and `~/.config/reddoor-maint`, and a second machine means copying secrets to a box that is on all the time.

**Option C: routines, or Claude Code on the web, for the scheduled fleet work.** Reaches runs that need no machine powered on at all, triggered on a cadence, by HTTP POST, or by GitHub events, with no permission prompts (DOC-CONFIRMED). Cannot reach local files (a fresh clone only), the local browser, the local MCP configuration, or any credential that is not re-placed as a cloud-environment API credential (Pro and Max only, DOC-CONFIRMED). Cannot run more often than hourly. And cannot take over an in-flight terminal session, since teleport is one-way.

For this fleet, Option C fits work already expressible as a repo checkout plus a prompt, which is most of the nightly sweeps; Option A or B fits anything that has to read `~/.config`, drive a local browser, or touch a checkout that is not on GitHub, which includes `rfp-analyze` (no origin) by construction.

---

## Rejected

**Large-scale agent-team orchestration plugins** (#13, `scaled-agent-orchestration`, 10 to 30-plus parallel agents, a 7-stage pipeline, per-model wave limits of haiku 12, sonnet 8, opus 4). A well-built answer to the opposite problem. Three things point against it here: RCWT's displacement finding (P5), Anthropic's own swarm study in which merge fraction falls as the swarm grows from 10 to 80 agents and newer models "succeed" largely by siloing, and the measured r=0.56 between limit blocks and concurrent breadth. Adding a layer that makes breadth easier is pushing the pedal already measured as the problem. The wave-limit table is worth stealing; the plugin is not.

**Persona subagent zoos.** #11 reached this from the inside: 100 built, 12 kept, and the survivors are context firewalls rather than specialists. The measured spawn profile says the same from the other direction, since `general-purpose` took 1,040 of 1,348 spawns and a library of finely-typed agents would mostly not have been selected. Build the two or three that quarantine verbose output and skip the rest.

**Keeping incident-grade rules in `CLAUDE.md`.** By #27's test, several rules here are in the wrong layer: never commit from the main checkout, never bare `git stash`, never `git merge starter/main`. #28 puts it plainly: `CLAUDE.md` "is guidance... Never rely on it for anything that must not happen." This rejects the current placement, not the rules.

**Docker-containerised always-on stacks** (HolyClaude, claude-remote-server, cli2agent). Named in #41's roundup; the repos themselves were not read, only the paragraph listing them. Rejected on ratio: they add a runtime to maintain for persistence that tmux already provides, and the credential story for a containerised Claude Code with access to 40 local repos is unverified. Worth revisiting only if Option B is taken and macOS session-killing turns out to be the blocker #41 says it is.

**The "85% of usage came from subagent-heavy sessions" figure** (#9). Rejected as a number, kept as a direction. Its provenance is a Reddit screenshot of one user's `/usage` quoted by a content site. Better data on this fan-out already exists locally.

**"Compact rather than clear" as a default.** Rejected in favour of the seam rule (P4). #20's distinction cuts both ways: clearing when you wanted to compact means re-explaining context that was already there, and compacting when you wanted to clear means carrying old context that bloats the new task. With 254 compactions measured and most of them manual, the evidence here is of a compact-by-default habit, and P5 and P6 both suggest the cost lands on the wrong side.

**The single-workspace-root multi-repo setup** (#19). Legitimate for a microservice cluster where cross-repo calls must be understood together. Rejected here because it is the direct opposite of P4, which has the only A/B in the corpus behind it, and because a 40-repo fleet with per-repo `CLAUDE.md` files would load the wrong rules. The sweep failures on record are about repos _differing_ (archived, no remote, directory name not matching remote name), not about them needing to be seen together.

---

## Not found

Absences worth reading as measured rather than as "did not look".

From the community pass: **how cache-read tokens are weighted against subscription usage limits**, which is the most valuable unknown given 13.9B cache-read tokens in the window (measured this week). The API side is documented, with cache reads billing at roughly 10% of input and not counting toward ITPM rate limits, but no source states the weighting for Pro or Max, and several assert that every prompt, tool call, file read and thinking block draws from the same allowance without saying whether a cache hit is charged at full weight, at 0.1x, or at all. Until that is known, "cache-read is where the tokens go" and "cache-read is where the limit goes" are different claims and only the first is established. Also not found: **any before-and-after measurement of a PreCompact-handoff hook**, across all three implementations; **any practitioner account of about 40 repos under one operator with measured before and after**, with #18's 15 repos the closest and self-reported; **any harness mechanism that enforces "prove the gate can pass before trusting its failure"**, where mutation testing is the right idea but is framed everywhere as a CI test-suite quality measure and never as a precondition on an agent's new check, making #35's revert-and-rerun sequence the closest analogue and putting this repo's rule ahead of the published practice; **issue-body detail on the kill-switch defects** (anthropics/claude-code #13996, #21167, #29180, #76807, #27481, #63938, all surfaced in search and none read); **`ccflare` and other proxy-based usage meters**, named in a roundup and not read; and **an Anthropic engineering post specifically on managing many repositories or on long-running sessions as a subject**, with #1's long-horizon section the closest thing that exists. Two pages could not be fetched: `anthropic.com/engineering/claude-code-on-the-web` returned HTTP 404 and the kdnuggets token-reduction article returned HTTP 403.

From the docs pass: **`~/.claude/stats-cache.json`** has zero occurrences across all 37 pages, and the claim that `costs.md` mentions it is false. **The startup token-budget figures** appear nowhere; greps for `4,200`, `4200 tokens`, `280 tokens` and `1,000-3,000` all return nothing. **A stated default for `maxTurns`** does not exist on any page. **Version attributions on `/usage`** ("prompt cache statistics v2.1.251+, attribution v2.1.222+") are not found at those version numbers on the costs page. **`~/.claude/statusline.js`** is not a documented location; statuslines are configured through the `statusLine` settings key with `type: "command"`, and `~/.claude/statusline.sh` appears only as an example path. **Workflow parallelism limits** are acknowledged but never numbered: "Agents that other features run, such as workflow agents and agent team teammates, follow their own limits instead" (sub-agents.md:1024). And `https://code.claude.com/docs/en/scheduled-routines.md` returns 404; the page is `routines`.

---

## Still to verify before building

Each check below is the one that would settle a claim a recommendation might rest on. A claim that fails its check is dropped, not softened. Three have been run already, on the Claude Code CLI **2.1.92** found on PATH; note that transcripts show the VS Code extension bundling 2.1.263 to 2.1.270 (the extension builds seen in transcripts on 2026-09-14, all past the v2.1.251 change to subagent model resolution), so a negative result here is a result for 2.1.92 and not necessarily for every build in use on this machine.

**CHECKED (CLI 2.1.92): `--max-budget-usd` is a headless cap, not a fan-out kill switch.** The flag exists, and its help text reads verbatim: "Maximum dollar amount to spend on API calls (only works with --print)". This confirms the docs (cli-reference.md:102) and refutes the community reading (#8, carried into P2 and P21): whatever halting behaviour the changelog describes applies at most to a `claude -p` run, and an interactive session and the subagents it dispatches do not inherit it. The corpus therefore contains **no** mechanism that halts already-running background agents on a budget, and no recommendation may assume one. What is still open, and worth one experiment before any scheduled-sweep design leans on it: whether the cap halts agents already running inside a `claude -p` invocation or merely declines new spawns. Run a print-mode invocation with a cent-sized budget that fans out, and read whether the running agents die or simply are not replaced.

**CHECKED (CLI 2.1.92): `claude agents` lists definitions, not running agents.** Its help describes it as "List configured agents", with `--setting-sources user,project,local`. It enumerates agent definitions and does not answer the runaway-agent question, so #39's procedure cannot be followed as written and P13's instrument half is unsupported on this build.

**CHECKED (CLI 2.1.92): there is no `claude daemon` subcommand.** `claude daemon --help` falls through to the general help, so `claude daemon status`, the socket directory and the `roster.json` worker count from #39 have nothing behind them here. What remains for P13 is `/tasks` for enumeration, `TaskStop` for a per-agent stop and `Ctrl+X Ctrl+K` for the session-wide one (all DOC-CONFIRMED), plus an OS-level `ps` sweep as the fallback. Re-running both of these against 2.1.263 to 2.1.270 (the extension builds seen in transcripts on 2026-09-14, all past the v2.1.251 change to subagent model resolution) is cheap and would say whether the gap is a version gap or a fiction.

**The kill-all chord.** The docs say `Ctrl+X Ctrl+K`, pressed twice within 3 seconds (DOC-CONFIRMED, interactive-mode.md:22); #39 reports `Ctrl+F` twice within 3 seconds (PRACTICE-none). Start two background subagents, press each chord in turn, and read `/tasks` after each. Document whichever one works and delete the other from any runbook.

**`TaskStop` by ID** (DOC-CONFIRMED at tools-reference.md:57) against the reported "no way to terminate one by task ID" in the issue cluster #13 surfaced but did not read. Call `TaskStop` on one of two running background agents and confirm in `/tasks` that exactly one stopped.

**`workflowSizeGuideline`** (PRACTICE-none via #8's changelog quote, UNCONFIRMED). Grep the settings reference for the key, then set it low and run a dynamic workflow, confirming the cap is reported or enforced. Absent both, do not cite the "fewer than 15 agents" default.

**`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`** (PRACTICE claim of a live 200-per-session cap via #8, DOC-REFUTED as "Removed in v2.1.224 and now a no-op"). Set it to 2 and spawn three subagents. If all three spawn, the community file's per-session cap is dead and only the concurrency caps remain.

**Which concurrency cap binds.** `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` defaults to 10 and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` to 20 (both DOC-CONFIRMED). Dispatch 15 subagents in one message and count how many run simultaneously. Any breadth recommendation has to be written against the cap that actually binds, not the famous one.

**`maxTurns` default** (field DOC-CONFIRMED, default UNCONFIRMED). The cheap half first: set `maxTurns: 2` on a scratch subagent and confirm the output comes back marked partial and is resumable. The expensive half, learning the unset default, requires a task that needs many turns and a read of `agent_transcript_path`; until then, write `maxTurns` explicitly rather than relying on any default.

**Subagent model resolution on the installed version.** Run `claude --version` and echo `CLAUDE_CODE_SUBAGENT_MODEL`. Below v2.1.251 the env var outranks frontmatter and the per-call parameter (DOC-CONFIRMED caveat); at or above it, frontmatter wins. Then prove it: define a scratch agent with `model: haiku`, invoke it with the env var set to something else, and read which model answered. P3's entire routing plan depends on which way this resolves.

**`remindcc`-style prompt injection** (PRACTICE-none, #24). Build the smallest version: one trigger, one file. Prove both directions before trusting it, because only one is obvious: a matching prompt must show the injected text (readable via `/context` or the transcript), and a non-matching prompt must show it absent. A trigger-scoping rule adopted without the negative case proven is the archived-repo trap waiting to happen.

**The `Stop`-hook block cap** (PRACTICE-none via #27; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` and the value 8 are UNCONFIRMED). Install a Stop hook on a scratch repo that always blocks, ignore `stop_hook_active`, and count the blocks before the session is released. Any completion gate has to be written to respect that cap, whatever it turns out to be.

**Percent-of-context semantics at 1M** (P7's 70% hard stop is calibrated for roughly 200k; one source reports autocompact firing at 76k on a 1M window, PRACTICE-anecdotal). Read `/context` immediately before and after an auto-compaction and compare with the effective `CLAUDE_CODE_AUTO_COMPACT_WINDOW` value (DOC-CONFIRMED as settable, 100000 to 1000000, plain integers only). Until the basis of the percentage is known, no threshold rule may be written on "percent of context".

**Statusline field names before any logic is built on them** (DOC-CONFIRMED names, unverified payload). Write a statusline command that dumps the raw JSON it receives and read it once, before writing a single conditional against `context_window.used_percentage`, `prompt_cache` or `rate_limits`.

**Cache-read weighting against the subscription limit** (NOT FOUND anywhere). The only local check available is weak and worth naming as weak: run two comparable sessions, one with `promptCacheTtl: 1h` (DOC-CONFIRMED, requires v2.1.242+), and compare `/usage` before and after each. If the result is ambiguous, say so and leave the 13.9B cache-read figure as a token fact and not a limit fact.

---

## Sources

### Official documentation (verification pass)

Fetched 2026-09-14 as raw markdown from `https://code.claude.com/docs/en/<page>.md`, 37 pages plus the `llms.txt` index. The pages cited above:

| Page                     | Cited for                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `env-vars`               | both concurrency caps, spawn depth, auto-compact window, `ENABLE_TOOL_SEARCH`                                                 |
| `sub-agents`             | concurrent limit, model and effort frontmatter, resolution order, `maxTurns`, resume semantics                                |
| `tools-reference`        | `TaskStop`, `maxTurns` reference                                                                                              |
| `interactive-mode`       | `Ctrl+X Ctrl+K`, `Esc`                                                                                                        |
| `hooks`                  | 33 events, the 16 that block, every JSON contract, `transcript_path`                                                          |
| `settings-reference`     | `autoCompactWindow`, `model`, `effortLevel`, `maxEffortLevel`, `autoMode`, `skillListingBudgetFraction`, `bashOutputMaxChars` |
| `model-config`           | `/autocompact` and `--autocompact`                                                                                            |
| `commands`               | `/compact`, `/usage`, `/cost`, `/stats`, `/context`, `/model`, `/effort`, `/fast`                                             |
| `prompt-caching`         | TTL controls, the 6-step priority order, the nine invalidators                                                                |
| `memory`                 | load order, `.claude/rules`, `paths`, `@import` hops, size guidance, auto-memory limits                                       |
| `permissions`            | `permissions.deny`, glob rules, the `mcp__` parentheses trap                                                                  |
| `costs`                  | `/clear` resetting totals, agent-team token multiple                                                                          |
| `statusline`             | `statusLine` key and its JSON fields                                                                                          |
| `monitoring-usage`       | OTEL `agent.name` on metrics, `agent_type` on events, `"custom"` redaction                                                    |
| `mcp`                    | tool-search deferral behaviour                                                                                                |
| `cli-reference`          | `--max-budget-usd` scope                                                                                                      |
| `claude-code-on-the-web` | cloud execution, one-way teleport, IP allowlist                                                                               |
| `remote-control`         | local execution with remote UI, plan and base-URL requirements                                                                |
| `routines`               | saved configurations, schedule, API and GitHub triggers                                                                       |
| `scheduled-tasks`        | the cloud against desktop against `/loop` comparison table                                                                    |
| `cloud-environments`     | API credentials and their plan availability                                                                                   |

Also fetched and not cited here: `settings`, `hooks-guide`, `common-workflows`, `context-window`, `slash-commands`, `agent-teams`, `checkpointing`, `overview`, `agents`, `agent-view`, `sessions`, `fast-mode`, `web-quickstart`, `analytics`, `overview`. One 404: `scheduled-routines`.

### Community sources (practice pass)

| #   | Source                                                                                                                            | What it is                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents                                                 | Context as a finite resource; compaction, note-taking, just-in-time retrieval                            |
| 2   | https://www.anthropic.com/engineering/multi-agent-research-system                                                                 | Lead/subagent architecture; the 15x multiplier and explicit breadth-scaling rules                        |
| 3   | https://www.anthropic.com/engineering/building-effective-agents                                                                   | Workflow taxonomy; "the simplest thing that works"                                                       |
| 4   | https://www.anthropic.com/engineering/writing-tools-for-agents                                                                    | Tool-response token discipline; the 25,000-token default cap                                             |
| 5   | https://www.anthropic.com/engineering/code-execution-with-mcp                                                                     | Intermediate tool results as the dominant cost; code execution as the fix                                |
| 6   | https://www.anthropic.com/engineering/claude-code-best-practices                                                                  | Now serves the docs "Best practices" page; treat its quotes as docs                                      |
| 7   | https://claude.com/blog/how-anthropic-teams-use-claude-code                                                                       | Internal team workflows                                                                                  |
| 8   | https://www.howardism.dev/articles/parallel-agent-orchestration                                                                   | Richest source; self-declared AI-synthesised, treated as a pointer to its primaries                      |
| 9   | https://youcanbuildthings.com/articles/claude-code-subagents-token-usage/                                                         | Subagent cost anatomy; the `CLAUDE_CODE_SUBAGENT_MODEL` override trap                                    |
| 10  | https://byteiota.com/claude-code-subagent-model-routing/                                                                          | Planner-on-Opus, workers-on-Haiku routing walkthrough                                                    |
| 11  | https://dev.to/suraj_khaitan_f893c243958/i-built-100-claude-code-subagents-these-are-the-12-that-actually-earn-their-context-10nn | 100 built, 12 kept; context firewalls over personas                                                      |
| 12  | https://hidekazu-konishi.com/entry/claude_code_subagents_and_orchestration_guide.html                                             | Subagent isolation as a two-sided cost; `/fork` against named subagents                                  |
| 13  | https://agentskill.sh/plugins/blackdagg3r/scaled-agent-orchestration                                                              | 10-30 agent orchestration plugin with per-model wave limits; rejected                                    |
| 14  | https://www.mindstudio.ai/blog/claude-code-agent-teams-parallel-agents                                                            | Shared-task-list coordination with claim semantics                                                       |
| 15  | https://www.faros.ai/blog/claude-code-token-limits                                                                                | Plan-limit mechanics; per-model pricing                                                                  |
| 16  | https://www.terseai.org/claude-code-rate-limits-explained                                                                         | Rolling windows against credit pool; why bursty runs are penalised                                       |
| 17  | https://dev.to/claudeguide/running-claude-code-across-multiple-repos-without-losing-context-2k83                                  | The only A/B table on one-session-per-repo; self-reported                                                |
| 18  | https://dev.to/neil_agentic/how-i-manage-15-repos-with-claude-code-without-losing-my-mind-2ood                                    | 15-repo operator account; concurrency ceiling from RAM                                                   |
| 19  | https://www.iamraghuveer.com/posts/multi-repo-workspace-claude-code/                                                              | One workspace root with repos as subdirectories; rejected                                                |
| 20  | https://buildtolaunch.substack.com/p/claude-code-token-optimization                                                               | 19-item checklist; CLAUDE.md size, `/effort`, `MAX_THINKING_TOKENS`, clear against compact               |
| 21  | https://www.terseai.org/reduce-claude-code-context-window                                                                         | 8 techniques; duplicate tool-call waste                                                                  |
| 22  | https://techtaek.com/claude-code-context-discipline-memory-mcp-subagents-2026/                                                    | Synthesis of the "context discipline" consensus                                                          |
| 23  | https://www.xda-developers.com/changed-one-setting-in-claude-code-token-burn-dropped/                                             | High against Medium effort on five tasks; 45% fewer output tokens, n=5                                   |
| 24  | https://github.com/JMCodes-Studio/remindcc                                                                                        | `UserPromptSubmit` hook injecting trigger-matched markdown                                               |
| 25  | https://aider.chat/docs/repomap.html                                                                                              | PageRank-ranked symbol map, `--map-tokens` default 1k                                                    |
| 26  | https://dev.to/jackm-singularity/coding-agent-context-engineering-make-agents-read-before-they-edit-19ik                          | Prove comprehension before changing the codebase                                                         |
| 27  | https://blakecrosley.com/blog/claude-code-hooks-explained                                                                         | Best hooks write-up; the Stop-gate script; the hook-against-CLAUDE.md decision test                      |
| 28  | https://hidekazu-konishi.com/entry/claude_code_hooks_complete_guide.html                                                          | Lifecycle reference; matcher discriminators; `PreCompact` checkpoint script                              |
| 29  | https://www.augmentedswe.com/p/guide-to-claude-code-hooks                                                                         | Exit-code-2 as a feedback loop; when JSON beats exit codes                                               |
| 30  | https://github.com/disler/claude-code-hooks-mastery                                                                               | Reference hook collection; flow-control practices                                                        |
| 31  | https://codingwithroby.substack.com/p/the-stop-hook-that-wont-let-claude                                                          | "Done is a claim, not a checked result"                                                                  |
| 32  | https://github.com/shihchengwei-lab/claude-code-session-kit                                                                       | Context monitor with 40/60/70% tiers and a hard stop; from 92 sessions                                   |
| 33  | https://github.com/raichominev/compaction-handoff                                                                                 | PreCompact writes a verified handoff with a continuation prompt                                          |
| 34  | https://github.com/who96/claude-code-context-handoff                                                                              | PreCompact plus SessionEnd plus SessionStart; tunable retention                                          |
| 35  | https://raw.githubusercontent.com/obra/superpowers/main/skills/verification-before-completion/SKILL.md                            | RED-GREEN instrument-proving as an executable step                                                       |
| 36  | https://github.com/obra/superpowers                                                                                               | The framework already installed here                                                                     |
| 37  | https://www.andrewconnell.com/articles/claude-code-cli-statusline/                                                                | Three-line statusline with context, 5-hour and 7-day meters                                              |
| 38  | https://ccusage.com/guide/statusline                                                                                              | Burn-rate colouring and configurable context thresholds                                                  |
| 39  | https://gist.github.com/yurukusa/5b37902731853fcbb40238dd18dde801                                                                 | `claude daemon status` and `claude agents --json` as liveness checks; both refuted on CLI 2.1.92, see §7 |
| 40  | https://github.com/brizzai/fleet                                                                                                  | tmux TUI for parallel sessions; idle hibernation at ~400MB per agent                                     |
| 41  | https://guydevops.com/posts/always-on-claude-code-remote-control-mac-mini/                                                        | Always-on Mac mini plus Remote Control; the macOS session killers                                        |
| 42  | https://lhelge.se/blog/claude-code-tmux/                                                                                          | Minimal persistent-session recipe; SSH straight into tmux                                                |
| 43  | https://www.mindstudio.ai/blog/claude-code-playwright-cli-automation                                                              | Playwright CLI against MCP; browser state to disk rather than to context                                 |
| 44  | https://docs.openhands.dev/openhands/usage/cloud/organizations/budgets                                                            | Org, default-user and per-user budgets; a financial endpoint                                             |
| 45  | https://agentconn.com/blog/verify-dont-review-coding-agents-2026/                                                                 | Separate the correctness question from the comprehension question                                        |
| 46  | https://antoniopagano.com/blog/ai-verification-bottleneck/                                                                        | Review-side telemetry: Faros, LinearB, Sonar State of Code 2026                                          |
