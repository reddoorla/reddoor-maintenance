# 12 — Startup cost

Run 2026-09-14 (Tasks 1–2 of `docs/superpowers/plans/2026-09-15-startup-cost-addendum.md`).
`node scripts/meta-week/token-meter.mjs --startup`. Every token number below comes from
`_data/tokens-startup.json`; the inventory in "What is configured to load" was read
straight off disk on 2026-09-14 with the commands in that plan, and names no
credentials.

## What the first call carries

Before the operator types anything, a session's first API call already carries the
system prompt, the global and project `CLAUDE.md`, the memory index, the skill listing,
every MCP server's tool definitions and instructions, and the first message. The meter
measures that as **`in + cacheCreate + cacheRead` of the earliest deduplicated usage
event per (sessionId, lane)** — and per `agentId` in the subagent lane, so each spawn
counts once.

All three counters are summed **because the question is size, not price**. A prefix
already cached by a sibling session arrives as `cacheRead` instead of `cacheCreate`; it
is billed differently but it is the same number of tokens occupying the same context
window. Everywhere else in this package the counters are kept apart precisely because
they are not commensurable in cost — here they are added because they are commensurable
in _size_, and that is the only claim made.

The corpus: 3,299 transcript files, 751,025 lines, 76,627 deduplicated requests.
282 main-lane sessions and 2,682 subagent spawns carry a first call.

## Per repo, main lane

Sorted by p50 descending (`tokens-startup.json` → `startup.byRepoLane`, main rows).

| repo                          | sessions | p50    | p90    | max    |
| ----------------------------- | -------- | ------ | ------ | ------ |
| `29-navy`                     | 4        | 59,811 | 60,618 | 60,618 |
| `invitations`                 | 2        | 55,874 | 55,874 | 55,874 |
| `-Users-tuckerlemos`          | 1        | 53,824 | 53,824 | 53,824 |
| `gallerysonder`               | 10       | 53,258 | 64,427 | 64,427 |
| `a-budget`                    | 2        | 52,878 | 52,878 | 52,878 |
| `octagonal-led-turn-counter`  | 3        | 46,440 | 56,423 | 56,423 |
| `songbook`                    | 8        | 46,104 | 51,898 | 51,898 |
| `reddoor-starter`             | 5        | 42,888 | 64,750 | 64,750 |
| `reddoor-website`             | 38       | 29,021 | 57,084 | 59,073 |
| `the-bench`                   | 13       | 28,542 | 41,956 | 51,847 |
| `reddoor-maintenance`         | 32       | 27,681 | 65,872 | 77,728 |
| `scriptorium-setup`           | 18       | 25,415 | 52,840 | 57,632 |
| `beachfront-dentistry`        | 13       | 24,455 | 53,116 | 53,412 |
| `caldea`                      | 64       | 24,183 | 51,503 | 58,302 |
| `Broken`                      | 24       | 22,418 | 51,336 | 52,650 |
| `welcome-to-the-flower-court` | 14       | 21,664 | 52,431 | 52,515 |
| `vida-legacy-foundation`      | 21       | 21,400 | 58,555 | 62,402 |
| `dont-lose-your-head`         | 5        | 21,228 | 52,986 | 52,986 |
| `revogen`                     | 5        | 20,260 | 50,985 | 50,985 |

**The p50 column is not the number to quote, and the gap between p50 and p90 says why.**
Every busy repo shows a p50 near 21–29k against a p90 near 52–66k, which is not a spread
— it is two populations. See "Per model": 194 of the 282 main-lane first calls are
`claude-haiku-4-5` (p50 20,457), the harness's own cheap opening call, and only 88 are a
frontier model (p50s 52,840–57,689). **Read the p90 as the cost of a real session's
first turn, and the p50 as an artefact of which call happened to be first.** The repos
at the top of the table — `29-navy`, `invitations`, `gallerysonder` — are the ones with
too few sessions for a haiku call to land in the middle.

`-Users-tuckerlemos` is not a repo; it is the project-directory fallback for a session
whose `cwd` was outside `~/Documents/GitHub`.

## Per subagent type

`startup.byAgent` — one row per spawn, keyed by `attributionAgent`.

| agent type                             | spawns | p50    | p90    | max     |
| -------------------------------------- | ------ | ------ | ------ | ------- |
| `workflow-subagent`                    | 1,793  | 36,031 | 55,997 | 166,284 |
| `subagent:unknown`                     | 543    | 10,968 | 11,102 | 43,204  |
| `general-purpose`                      | 269    | 41,290 | 53,308 | 58,327  |
| `superpowers:code-reviewer`            | 53     | 43,474 | 53,302 | 53,684  |
| `Explore`                              | 15     | 22,220 | 25,965 | 26,299  |
| `episodic-memory:search-conversations` | 7      | 8,175  | 12,631 | 12,631  |
| `claude-code-guide`                    | 2      | 38,196 | 38,196 | 38,196  |

`subagent:unknown` is the walker's label for a sidechain record carrying no
`attributionAgent`; at 543 spawns it is the second-largest row and its cost profile
(p50 10,968, p90 11,102) matches the cheap harness models in the next table, so it is
almost certainly harness-issued rather than a mis-attributed `Agent` call.

## Per model

`startup.byModel` — the lane and model of each first call.

| lane     | model                       | first calls | p50    | p90    | max     |
| -------- | --------------------------- | ----------- | ------ | ------ | ------- |
| subagent | `claude-opus-5`             | 1,250       | 39,631 | 56,174 | 166,284 |
| subagent | `claude-fable-5`            | 462         | 30,306 | 40,438 | 48,587  |
| subagent | `claude-opus-4-5-20251101`  | 353         | 10,980 | 11,106 | 11,217  |
| subagent | `claude-fable-5-1`          | 298         | 43,265 | 46,994 | 109,015 |
| subagent | `claude-haiku-4-5-20251001` | 197         | 10,968 | 10,999 | 38,196  |
| main     | `claude-haiku-4-5-20251001` | 194         | 20,457 | 34,629 | 50,416  |
| subagent | `claude-sonnet-5`           | 121         | 43,457 | 49,048 | 53,867  |
| main     | `claude-opus-5`             | 52          | 53,262 | 62,402 | 71,930  |
| main     | `claude-fable-5`            | 19          | 53,258 | 63,366 | 65,872  |
| main     | `claude-fable-5-1`          | 12          | 52,840 | 64,750 | 77,728  |
| main     | `claude-sonnet-5`           | 5           | 57,689 | 64,427 | 64,427  |
| subagent | `claude-opus-4-8`           | 1           | 31,197 | 31,197 | 31,197  |

A frontier main-lane session opens at **52,840–57,689 tokens at the median** whatever
the model — the payload is the same, and it is the payload that sets the floor.

## What is configured to load

Read off disk 2026-09-14. MCP servers are listed by name only.

| what                                     | measured                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| global `~/.claude/CLAUDE.md`             | 27 lines, 1,239 bytes                                                                                                                                                                                                                         |
| project `CLAUDE.md` files                | 40 repos carry one; largest `29-navy` 341 lines / 17,422 bytes, `vida-legacy-foundation` 315 / 19,738, `reddoor-starter` 255 / 13,392, `a-budget` 221 / 11,127, `reddoor-maintenance` 213 / 11,261; the median repo is 76 lines / 3,959 bytes |
| memory index (loaded every session here) | `…/reddoor-maintenance/memory/MEMORY.md`, 100 lines, 15,681 bytes                                                                                                                                                                             |
| memory files on disk                     | 373 `.md` across all projects (only the index loads by default)                                                                                                                                                                               |
| MCP servers, global                      | `prismic`, `figma`                                                                                                                                                                                                                            |
| MCP servers, project                     | `reddoor-maintenance`: `airtable`. No repo carries a `.mcp.json`.                                                                                                                                                                             |
| plugins enabled                          | 8: `superpowers`, `episodic-memory`, `superpowers-chrome`, `superpowers-developing-for-claude-code`, `claude-session-driver`, `context-mode`, `claude-mem`, `figma`                                                                           |
| skills exposed                           | 7 personal (`~/.claude/skills`) + 114 from plugin caches                                                                                                                                                                                      |
| default model / effort                   | `claude-fable-5-1[1m]`, `effortLevel: xhigh`                                                                                                                                                                                                  |

The largest single item any repo contributes is its own `CLAUDE.md` at up to ~19.7 KB —
perhaps 5k tokens — against a measured frontier opening of ~53k. **The bulk of the
startup cost is not the repo's own instructions.** The skill listing (121 skills) and
three MCP servers' tool definitions are the candidates, and this run does not separate
them; doing so needs a controlled A/B, not a transcript scan.

## The fixed cost of a spawn

The tempting arithmetic — subagent p50 × request counts from `tokens-by-agent.json` —
**is wrong**, and would inflate the answer several-fold: those are _requests_, and one
spawn makes many. The startup cost is paid once per spawn, so multiply by the **spawn**
counts in `byAgent`, which is what that table's `sessions` column is.

| agent type                             | spawns    | p50    | p50 × spawns   |
| -------------------------------------- | --------- | ------ | -------------- |
| `workflow-subagent`                    | 1,793     | 36,031 | 64,603,583     |
| `general-purpose`                      | 269       | 41,290 | 11,107,010     |
| `subagent:unknown`                     | 543       | 10,968 | 5,955,624      |
| `superpowers:code-reviewer`            | 53        | 43,474 | 2,304,122      |
| `Explore`                              | 15        | 22,220 | 333,300        |
| `claude-code-guide`                    | 2         | 38,196 | 76,392         |
| `episodic-memory:search-conversations` | 7         | 8,175  | 57,225         |
| **all spawns**                         | **2,682** | —      | **84,437,256** |

**≈84.4M tokens of injected context across 2,682 spawns**, against 7,946,645 across the
282 main-lane sessions — the spawn side is **10.6×** the session side. That is the
median-times-count estimate, not a sum of the actual first calls; it is stated this way
because a median is what `byAgent` reports.

## Caveats

- **A warm cache makes the first call cheap to bill, not small.** `cacheRead` is folded
  in deliberately. Nothing here is a price.
- **"First call" is whatever the harness sent first.** For 194 of 282 main-lane
  sessions that is a `claude-haiku-4-5` call, not the operator's first turn. This is why
  the main-lane p50s read low; the p90 is the honest figure for a working session.
- **`--startup` reads `laneEvents`, not the date-filtered events**, so a session's true
  first call is found even under `--from`. It therefore ignores `--from`/`--to` by
  design: these numbers are the whole retained corpus, roughly 31 days.
- **A resumed session is a new session id** and pays a new first call, so "sessions" here
  counts session _files_, not working sessions. The 282 is an upper bound on how many
  times the operator sat down.
- **This measures size, not attribution.** Which of the system prompt, the skill
  listing, the MCP tool definitions, `CLAUDE.md` or the memory index accounts for the
  ~53k is not answered here and cannot be answered from transcripts alone.
