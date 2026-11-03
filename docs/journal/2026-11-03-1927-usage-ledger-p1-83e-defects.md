# 2026-11-03 — Three usage-ledger defects from P1-83e

Landed in reddoorla/reddoor-maintenance#1900. Follow-up: reddoorla/reddoor-maintenance#1901.

P1-83e harvested a week of cloud usage by hand, in Python. It did that because the ledger could not produce the figures, and it found three reasons why. This change fixes the three in `scripts/model-bakeoff/`.

**A raw control character cost a whole page.** One `list_events` page in a 10-27 session held a raw control character inside a string. `JSON.parse` refuses that: "Bad control character in string literal in JSON at position 45240". `mcpCalls` kept the call as an `{error}` payload, so every event on the page was lost. The only sign was one stderr line in a long harvest. `scanCcr` already walked the text tracking string state, so it now writes a control character inside a string as its `\u00XX` escape. That is what Python's `json.loads(strict=False)` accepts, and one outside a string still throws. The reviewer ran both parsers on seven edge inputs, including a backslash before a raw control character, surrogate pairs, and `}` inside a string, and they agreed on all seven.

**Sonnet 5.5 cache reads cost half what `PRICES` said.** The card read $0.20/M. The pricing page bills Opus 5.5 and Sonnet 5.5 cache reads at 0.05x input, so Sonnet's is $0.10/M. The server agreed in all 163 Sonnet `modelUsage` entries P1-83e checked.

- _Belief corrected on contact:_ the brief said to confirm against "the current price list (the claude-api skill)". That skill's table, cached 2026-10-06, still says $0.20. It is where the stale card came from, and confirming against it would have kept the defect. The live page settled it.
- `PRICE_SOURCE` now names the page. All four cards were checked against it: Fable 5.1's cache read is 0.025x, and Haiku's is the usual 0.1x.
- Sonnet is mostly cache reads, so P1-83e put Sonnet subagents at $59.99 on the old card against $41.05 at the server's rate. Stored transcript rows are repriced on the next write, because `ingest` rebuilds them from `messages.jsonl`.

**Probe (a) had expired.** The README said the server receives none of a subagent's own messages. It now receives all of them. Each one is an `assistant` event whose body carries `agent_id`, `subagent_type`, `task_description` and `parent_tool_use_id`. Re-checked here on a 10-27 session: 4 subagent and 31 main-thread events, every one with `stop_reason: null`.

- Input and cache tokens are exact. Output is only the stream-start count: one session read 4,945 output tokens from its events against 307,142 in `modelUsage`.
- `assistantEventRows` now keys rows by `agent_id` and names the type, and it counts every request as unfinished, so its cost prints as a floor.
- The server's `agent_id` is bare (`ac417f72a17e384bf`), where a transcript row is named after its file (`agent-ac417f72a17e384bf`). The README says to strip the prefix before joining the two.
- _Not done:_ wiring these rows into `ingest`. That needs a stored union of events, de-duplication against `messages.jsonl`, and a rule in the weekly report. It is a design change, so it went to #1901.

**Mutations.** Six were named before the code, and all six went red but one. That one, escaping control characters outside strings as well, is equivalent: an escape outside a string is still invalid JSON. So it was replaced by dropping such characters outside strings, a real loosening, which went red.

**Review.** One Opus round found minors only:

- `PRICE_SOURCE` seemed to overclaim. It did not, but the README now names Fable's rate.
- The `agent_id` format, now documented.
- The fixture had no raw newline, now added.
- Stored event rows would keep an old price. None exist.

**Accounting.**

- One `t4-plan-task` test fails here and on untouched `main` alike: the container's pnpm is 10.28.0 against a check for 11 or later.
- The first commit's `Claude-Session` trailer names the wrong session. This entry's commit has the right one.

Usage: $4.58, 610/32,576 tokens, 9,249,874/295,587 cache, rate limit allowed
