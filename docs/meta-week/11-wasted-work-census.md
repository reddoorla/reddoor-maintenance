# 11 — Wasted-work census

Run 2026-09-14 (Tasks 1–7 of `docs/superpowers/plans/2026-09-15-wasted-work-census.md`;
the plan's filename says 2026-09-15, the run happened on the 14th), then **re-run the same
day** after the first run's own numbers exposed four defects in the census — see
"Corrections on first contact". Every number below is from the second run.
`scripts/meta-week/census.mjs`, over every Claude Code transcript on this machine.

Counts and costs below come from `_data/census-summary.json`. The per-candidate
**evidence** fields come from `census-candidates.jsonl`, which is **not committed** —
it carries operator prompt text. It is left at `$TMPDIR/census-candidates.jsonl` for
the refuter round, and the committed summary has every candidate stripped to
`{kind, sessionId, repo, ts, window, cost}`.

## What a candidate is, and is not

A candidate is a **nomination**. The heuristics below can only see shapes in a
transcript; none of them can see whether the work was wasted. A candidate counts as
wasted work only after a refuter has read its window — `scripts/meta-week/transcript-window.mjs
--session ID --from ISO --to ISO` prints it as a compact chronological script — and
confirmed it. The "Confirmed" section below holds the refuter round's verdicts; the
"Candidates" tables are nominations, before that reading.

Three classes, seven kinds:

| class      | kind                      | the heuristic, exactly                                                                                                                                                                             | cost window                                                                                                                         |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **fanout** | `spend-after-stop`        | an operator prompt matching a stop phrase, after which that session's subagents produced at least one request                                                                                      | from the stop prompt to the next operator prompt (or +60 min), subagent lane only                                                   |
| **fanout** | `continue-after-block`    | a limit block followed within six hours by a prompt containing "contin" — one candidate per resume, paired with the nearest block before it                                                        | the session's spend in the 30 minutes after the continue                                                                            |
| **fanout** | `orphaned-agent`          | a subagent whose OWN transcript ends in a kill record — `quotaLimits.status: "rejected"`, or a `[Request interrupted…]` record it never answered — and which the parent never reported `completed` | that agent's own spend from its own transcript, deduped by `requestId` as the meter does, with `agentTotal` the four counters added |
| **fanout** | `same-turn-many-sessions` | the same normalized prompt text typed into three or more distinct sessions inside two minutes                                                                                                      | none — the cost is operator attention, reported as a session count                                                                  |
| **redo**   | `reread-after-compaction` | after a compaction, the same session `Read`s three or more files it had already read, edited or written                                                                                            | the main lane's spend in the hour after the compaction                                                                              |
| **redo**   | `duplicate-agent-prompt`  | an `Agent` dispatch whose prompt has Jaccard word similarity ≥ 0.70 to an earlier dispatch in the same session — one candidate per repeated dispatch, paired with its closest earlier match        | the repeated agent's reported `totalTokens`, kept separately as `agentTotal`                                                        |
| **unread** | `corrected-turn`          | an operator prompt matching a correction/evidence-demand phrase                                                                                                                                    | the session's spend from the previous operator prompt to the correction                                                             |

Costs are the token meter's raw counters (`out`, `cacheCreate`, `cacheRead`) summed
over the stated window. They are never added together into one number. A cost is what
the window **cost**, not what was wasted: a window contains the good work as well as
the bad, which is exactly what the refuter is for.

Candidates sort by `out` descending, then `cacheCreate` descending — the two counters
that are not cache hits. There is no invented weighting.

## Controls

Every heuristic was proven on a seeded fixture before it touched real data, and shown
to stay silent on a clean one. Both fixtures are built in `tests/meta-week/census.test.ts`:
SEEDED carries exactly one episode of every kind; CLEAN carries the same session
shapes with none of them.

| kind                      | PASS control (SEEDED)                                                                                                                                                                                                                                                             | FAIL control (CLEAN)                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spend-after-stop`        | found, `cost.out` 25 — the subagent request one minute after "stop, kill them"                                                                                                                                                                                                    | nothing nominated                                                                                                                                 |
| `continue-after-block`    | found, `lagMin` 3, `cost.out` 12                                                                                                                                                                                                                                                  | nothing nominated                                                                                                                                 |
| `same-turn-many-sessions` | found, `sessions` 3, repos alpha/beta/gamma                                                                                                                                                                                                                                       | nothing nominated                                                                                                                                 |
| `reread-after-compaction` | found, `filesReReadCount` 3, `cost.out` 57 (the whole hour after the boundary)                                                                                                                                                                                                    | nothing nominated                                                                                                                                 |
| `duplicate-agent-prompt`  | found, similarity ≥ 0.70, `cost.agentTotal` 7,000                                                                                                                                                                                                                                 | nothing nominated                                                                                                                                 |
| `corrected-turn`          | found, `cost.out` 40 — main-lane 15 plus subagent 25 inside the corrected turn                                                                                                                                                                                                    | nothing nominated                                                                                                                                 |
| `orphaned-agent`          | ORPHANS: the quota-killed agent found, `cost.out` 1,000 over **2** deduped requests (one `requestId` was written twice, out 50 then 900 — the meter keeps the larger), `agentTotal` 1,002, `redispatched` `t31`; and the never-re-sent interrupt found with `redispatched` `null` | ORPHANS: an agent that finished, one the parent reported `completed`, and one that stops mid `tool_use` nominate nothing; CLEAN nominates nothing |

The walker's `full` mode has its own control in the same file: on SEEDED it collects 6
operator prompts, 9 tool calls and 2 agent results — the two `tool_result` records are
counted as agent results and **not** as prompts. The token meter's own 15 tests still
pass unchanged, and on the real corpus the two modes agree: walking
`~/.claude/projects` with and without `full` both yield 243 limit blocks and 107
compactions **(one-off probe, 2026-09-14)**. `full` is opt-in and the default walk is
untouched.

The corrections below added three more transcript roots — SHAPED, LAGGED and TRIPLE — and
a two-directory **git** fixture (a repo with one real revert, one commit that mentions
reverting, one that mentions it only in the body, and a linked worktree of that repo).
Each was written to FAIL against the code as it stood, watched fail, and then watched
pass. The file now carries 13 tests and `tests/meta-week` 29. A fourth root, ORPHANS, was added
later with `orphaned-agent` — 16 and 32.

| correction               | PASS control                                                                                                                                                     | FAIL control                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| system-shaped records    | SHAPED: an IDE-wrapped operator stop survives with the preamble stripped — `prompt` is "stop, kill them", `cost.out` 30                                          | SHAPED: the summarisation request, the compaction continuation and a preamble-only record nominate nothing, and the walker counts 1 prompt, not 4 |
| `continue-after-block`   | LAGGED: a resume five hours after a wall, one candidate for two block records, `blocks` 2, `lagMin` 180 from the nearer block, `cost.out` 12                     | LAGGED: a resume seven hours after a block, past the bound, nominates nothing                                                                     |
| `duplicate-agent-prompt` | TRIPLE: three near-identical dispatches nominate 2 candidates, `matches` 1 and 2, the third paired with its closest earlier prompt (0.86, not the first at 0.71) | the same fixture nominated 3 before the fix — one per pair                                                                                        |
| reverts (`--git`)        | a fixture repo whose one "Revert …" subject is counted                                                                                                           | the same repo's "mentions revert" subject, its "revert" body line, and a linked worktree of it — 6 rows before, 1 after                           |

## Candidates

The corpus walked: 3,387 transcript files, 4,768 operator prompts, 93,830 tool calls,
344 subagent results, 131 interrupts, **353 subagent transcripts** and 531 task
notifications (`census-summary.json`).

`census-summary.json` was regenerated when `orphaned-agent` was added, so its header
counts are from that later run and not from the 12:06 one the prose above quotes — the
corpus is live and grew by 51 files, all of them this session's own transcripts. **Every
pre-existing kind's candidate count and cost is byte-identical across the two runs**
(11 / 4 / 8 / 19 / 100 / 21; `out` 1,504,133 / 8,667 / 0 / 2,340,602 / 0 / 432,001;
`agentTotal` 4,557,286), which is the check that the walker's new collection changed
nothing it already did. One number did move and it is not the code's: the `--git` revert
row fell 2 → 1, because the commit in `caltex-landing` is no longer reachable in that
checkout.

### Corrections on first contact

The first run's own output was the evidence that four of its heuristics were wrong. All
four are fixed, each with a fixture that failed first. The before/after below is one
corpus walked **twice, minutes apart, by the old code and the new** — 3,336 files both
times — so the deltas are the code's and not the corpus's.

| kind                      | before | after | why                                                                                                        |
| ------------------------- | ------ | ----- | ---------------------------------------------------------------------------------------------------------- |
| `spend-after-stop`        | 6      | 4     | two were the harness's summarisation request, not a stop                                                   |
| `continue-after-block`    | 0      | 11    | the ten-minute window could not span a five-hour reset; at six hours, 151 raw pairs collapse to 11 resumes |
| `same-turn-many-sessions` | 14     | 8     | seven summarisation-request groups out, one genuine group in (it had been masked)                          |
| `reread-after-compaction` | 19     | 19    | untouched                                                                                                  |
| `duplicate-agent-prompt`  | 309    | 100   | one candidate per repeated dispatch instead of per pair; `agentTotal` 21,768,941 → 4,557,286               |
| `corrected-turn`          | 21     | 21    | unchanged, including cost — see the IDE note below                                                         |
| reverts (rows)            | 148    | 2     | worktrees skipped, and only subjects that begin with Revert                                                |

Operator prompts collected fell 5,026 → 4,723 (−303).

1. **Two harness records were read as operator prompts.** Both are written as
   `type: "user"` and neither contains an operator turn: the summarisation request
   (`Context: This summary will be shown in a list…`, 195 in the corpus) quotes the
   transcript it is summarising, and the compaction continuation (107 of them, starting
   `This session is being continued from a previous conversation…`) quotes its own
   summary. That is how a
   stop phrase reached the finders — one summarisation request quoted an agent saying the
   plan has six `"stop and ask the user to compile"` points. Both are now in the walker's
   `SYSTEM_SHAPED`.

2. **The `<ide_opened_file>` diagnosis in the first run was wrong, and the opposite fix
   was needed.** The first write-up said the record "carries whatever text the file
   contained". It does not: it carries the file's **path** and one boilerplate sentence.
   Nor is it a system record — it is a **preamble on the operator's own turn**. Of the 140
   preamble-carrying prompts in the corpus (`<ide_opened_file>` 133, `<ide_selection>` 7),
   **133 + 7 = 140 had a real operator turn after the preamble and 0 were preamble-only**,
   and **0 had a stop or correction phrase inside the preamble itself** — every match was
   in the operator's own words. Excluding the shape, as the first write-up proposed, would
   have deleted 133 genuine prompts and suppressed 3 genuine candidates. The preamble is
   stripped and the turn kept, which is why `corrected-turn` stayed at 21 and why the
   largest `spend-after-stop` candidate survived. That candidate is still a false
   positive, but of a different kind: it matched `STOP_RE` on "no more" inside the
   sentence "citation share is **no more** within our control". `STOP_RE` matching
   ordinary prose is a separate problem this pass did not fix.

3. **`continue-after-block` was blind by two orders of magnitude, and then double.**
   Widening the window from ten minutes to six hours turned a measured zero into 151
   candidates — for **11 actual resumes**. A single wall writes a block record into every
   lane that hit it, and one resume was nominated by 70 separate block records. Resumes
   are now keyed by the continue prompt and paired with the nearest block before it;
   `blocks` in the evidence keeps the record count, and the bound stays at six hours so
   the finder cannot pair a block with any later "continue" the session happens to
   contain. Measured lags across the 11: 57 to 211 minutes.

4. **`duplicate-agent-prompt` counted pairs, not repeats**, so one dispatch resembling
   three earlier ones became three candidates carrying the same `agentTotal` — which is
   also why the summed `agentTotal` was 4.8× too large. One candidate per repeated
   dispatch now, paired with its highest-similarity earlier prompt, with `matches`
   recording how many earlier prompts cleared the bar. Across the 100, `matches` runs 1
   to 13 (39 of them 1, 25 of them 2).

5. **The revert count over-counted twice**, in the `--git` pass — see "Reverts".

The prompt-collector fixes live in the walker, so `transcript-window.mjs` — the refuter's
view — inherits them: a window now shows the operator's turn without the IDE preamble in
front of it, and no longer shows the harness's own records as operator prompts.

### fanout

| kind                      | candidates | out       | cacheCreate | cacheRead   | agentTotal |
| ------------------------- | ---------- | --------- | ----------- | ----------- | ---------- |
| `continue-after-block`    | 11         | 1,504,133 | 10,169,023  | 170,570,637 | 0          |
| `orphaned-agent`          | 13         | 433,849   | 2,188,939   | 86,786,915  | 89,411,221 |
| `spend-after-stop`        | 4          | 8,667     | 84,106      | 1,825,101   | 0          |
| `same-turn-many-sessions` | 8          | 0         | 0           | 0           | 0          |

`continue-after-block` reported a measured zero on the first run, and the zero was the
heuristic's fault rather than the world's. **(one-off probe, 2026-09-14)** The corpus
holds 243 limit-block records (217 subagent lane, 26 main) across 14 distinct sessions,
and 201 main-lane operator prompts containing "contin…" across 51 sessions; 13 of the 14
block-carrying sessions have one. Measuring block → first same-session main-lane "contin…"
prompt over all 243 blocks gives n = 237, **minimum 57 minutes**, median 212, maximum
1,312. Exactly one is inside an hour and none inside ten minutes — which is what waiting
for a five-hour session window to reset looks like. At six hours the kind fires, and the
243 block records resolve to **11 resumes** in 10 sessions, lags 57 to 211 minutes.

It is now the most expensive fanout kind — 1,504,133 `out` against `spend-after-stop`'s
8,667, a factor of 173 — which is a statement about
the window and not yet about waste: a resume is followed by a fresh session re-reading
its way back to where it was, and the 30 minutes after it are charged whole.

Top 10 by the census's sort:

| #   | kind                   | session  | repo                   | timestamp (UTC)          | out     | cacheCreate | cacheRead  | evidence                  |
| --- | ---------------------- | -------- | ---------------------- | ------------------------ | ------- | ----------- | ---------- | ------------------------- |
| 0   | `continue-after-block` | 4fc94047 | songbook               | 2026-08-25T01:34:31.962Z | 466,241 | 2,499,208   | 14,043,523 | `blocks` 8, `lagMin` 77   |
| 1   | `continue-after-block` | 04ebfa83 | reddoor-maintenance    | 2026-08-24T20:14:09.037Z | 240,038 | 1,329,419   | 25,219,090 | `blocks` 6, `lagMin` 79   |
| 2   | `continue-after-block` | 3384a925 | vida-legacy-foundation | 2026-09-02T18:29:48.825Z | 140,362 | 644,465     | 14,746,007 | `blocks` 13, `lagMin` 168 |
| 3   | `continue-after-block` | 6257e022 | reddoor-website        | 2026-09-05T23:28:53.329Z | 131,456 | 1,904,780   | 13,420,126 | `blocks` 70, `lagMin` 211 |
| 4   | `continue-after-block` | f82eebd3 | reddoor-website        | 2026-08-25T01:32:48.231Z | 129,329 | 1,437,360   | 15,283,185 | `blocks` 1, `lagMin` 79   |
| 5   | `continue-after-block` | 5a73f238 | Broken                 | 2026-09-02T18:28:04.935Z | 98,686  | 477,317     | 15,839,776 | `blocks` 47, `lagMin` 169 |
| 6   | `continue-after-block` | cbbe6cc4 | Broken                 | 2026-08-24T20:21:22.320Z | 93,814  | 179,196     | 5,744,376  | `blocks` 1, `lagMin` 72   |
| 7   | `continue-after-block` | f5a358f1 | reddoor-website        | 2026-09-02T18:29:42.304Z | 82,100  | 503,148     | 8,333,522  | `blocks` 2, `lagMin` 168  |
| 8   | `continue-after-block` | f82eebd3 | reddoor-website        | 2026-08-24T20:37:18.678Z | 69,496  | 665,815     | 39,141,200 | `blocks` 1, `lagMin` 57   |
| 9   | `continue-after-block` | 88807007 | beachfront-dentistry   | 2026-08-24T20:13:24.021Z | 43,064  | 367,583     | 16,831,231 | `blocks` 1, `lagMin` 80   |

Every one of the eleven is a `session` block, not a `weekly` one. Four of them
(`blocks` 8, 13, 47, 70) show what the per-block loop was doing before the fix: one wall,
dozens of records, one resume.

The four remaining `spend-after-stop` candidates are all genuine operator prompts, but
only three are genuine stops — the largest (reddoor-website, `out` 6,943) matched on
"no more" inside "citation share is no more within our control". The 8
`same-turn-many-sessions` groups are 3 slash commands (`/model`, `/compact` — kept
deliberately, and flagged) and **5 genuine operator turns**, each typed into 3 or 4
sessions inside two minutes: "hit a usage limit, continue", "hit a session limit,
resume", "hit a session limit, continue on", "computer crashed because I also opened
steam, resume", and "switched you onto fable…". The fifth is new — it was not in the
first run's 14, because the summarisation-request groups had claimed prompts out from
under it. Removing false candidates uncovered a true one. (Counts from
`census-candidates.jsonl`.)

### orphaned-agent

A subagent that was **dispatched and never returned**, priced by its own spend. Both
refuter rounds landed on the same point: the cost of an account-limit block is not the
resume, it is the **agents that were in flight when the block landed** — and no
prompt-shaped heuristic can see them, because nothing the operator typed records it. The
structure does.

**Two obvious tells do not work, and each would have nominated most of the corpus.** The
parent's `tool_result` for an async dispatch is written **at launch**, carrying
`toolUseResult.status: "async_launched"` and the `agentId`, so "no `tool_result`" is
evidence of nothing — all 344 agent results in the corpus are `async_launched`. And "no
`<task-notification>` for this agentId" is worse: **202 of the 353** subagent transcripts
have no notification of any status, because a synchronous dispatch never produces one.

**The definition, as implemented.** Every subagent writes its own transcript at
`<project>/<sessionId>/subagents/agent-<agentId>.jsonl`, with a sibling
`agent-<agentId>.meta.json` = `{agentType, description, toolUseId, spawnDepth}` whose
`toolUseId` is the id of the parent's `Agent` `tool_use` block (351 of 353 have one). The
tell is how that transcript **ends** — four states, `agentEndState` in `walk.mjs`:

| the last record in the file                                                                                                                                             | n   | nominated |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------- |
| an assistant turn carrying a text block — the agent finished and reported                                                                                               | 338 | no        |
| `quotaLimits.status: "rejected"` — the account limit answered instead of the model: `stop_reason` `"stop_sequence"`, usage all zero, the "You've hit your … limit" text | 5   | **yes**   |
| a `user` record reading `[Request interrupted…]` that the agent never answered                                                                                          | 9   | **yes**   |
| the file simply stops, mid `tool_use` or mid `thinking`                                                                                                                 | 1   | no        |

The last row is why the fourth state is **not** nominated, and the demonstration is in the
table itself: that same count was **2** when the census ran at 12:45 and **1** when the
state table was measured at 12:48, because one of this session's own agents finished in
between. A file that merely stops is indistinguishable from an agent still in flight, so
nominating it would make the detector's verdict depend on when it was run.

One guard sits on top of both tells: a `<task-notification>` in the parent reporting
`completed` for that agentId wins, because that agent returned however its file ends. It
is not decoration — it fires once on the real corpus, on `ac9ba72a53bd98b32` ("Implement
task 5 save endpoint", `d2b6a2f6`, 2026-09-11), whose transcript ends on an interrupt and
which the parent nevertheless reported both `failed` and `completed`. 14 kill-record files
become 13 candidates.

**Cost** is the agent's own spend, read from its own transcript and deduped by `requestId`
exactly as the token meter does, with `agentTotal` the four counters added.
**Evidence** is `{agentId, toolUseId, description, agentType, spawnedAt, lastAt,
lastStatus, redispatched}`. `redispatched` is the `toolUseId` of the nearest later dispatch
in the same session whose `description` is **byte-identical** — not prompt Jaccard, which
would confuse a re-send with a merely similar task.

#### Positive control: the three #569 lenses, 2026-08-24

The critic priced this episode by hand from the three orphaned transcripts. The detector
was run against that number before anything else it found was read.

| agent               | description                        | spawned (UTC)            | killed (UTC)             | requests | out        | cacheCreate | cacheRead     | `redispatched`                   |
| ------------------- | ---------------------------------- | ------------------------ | ------------------------ | -------- | ---------- | ----------- | ------------- | -------------------------------- |
| `ae3ffd42915dedb3b` | Review #569: security lens         | 2026-08-24T20:10:23.932Z | 2026-08-24T20:13:13.556Z | 9        | 11,353     | 70,309      | 579,593       | `toolu_01YPwb6vTKBDFj9BSM6g2rPm` |
| `ab15833871b85c793` | Review #569: data/consistency lens | 2026-08-24T20:10:37.269Z | 2026-08-24T20:12:58.880Z | 5        | 9,410      | 66,010      | 276,216       | `toolu_01NgKX3U8cTrV3B1aiKrLYfb` |
| `a9546d32800e37e67` | Review #569: test-vacuity lens     | 2026-08-24T20:11:12.084Z | 2026-08-24T20:14:08.011Z | 9        | 11,966     | 63,236      | 515,696       | `toolu_013jMLh3hxe3Uhm81iSd1bNF` |
| **total**           |                                    |                          |                          | **23**   | **32,729** | **199,555** | **1,371,505** |                                  |

- **`out` 32,729 against the critic's 32,729 — difference 0.**
- **Context 1,571,106** (`in` 46 + `cacheCreate` 199,555 + `cacheRead` 1,371,505) against
  the critic's "~1.57M" — agreement to three significant figures.
- The three `redispatched` values are the three 21:33–21:34 re-sends the critic named,
  resolved from byte-identical descriptions with nothing else supplied.
- **One correction.** The critic's "26 requests" is not the deduped request count for the
  three; that is **23**. 26 is the number of non-zero-usage assistant **records** in one of
  them (`agent-ae3ffd42915dedb3b`, which holds 27 such records, the 27th being the
  all-zero rejection). Across the three there are 73 such records and 23 distinct
  `requestId`s. The token totals are unaffected — they were already deduped.

#### The corpus

13 candidates: **5** killed by the account limit, **8** killed by an interrupt. Only
**3 of 13** carry a `redispatched` — the three #569 lenses. Nothing else in the corpus was
ever sent again.

| by repo                     | n      | out         | agentTotal     |
| --------------------------- | ------ | ----------- | -------------- |
| Broken                      | 6      | 342,919     | 84,308,377     |
| reddoor-maintenance         | 4      | 34,981      | 1,929,834      |
| 29-navy                     | 1      | 26,548      | 2,069,651      |
| welcome-to-the-flower-court | 1      | 28,515      | 701,028        |
| vida-legacy-foundation      | 1      | 886         | 402,331        |
| **total**                   | **13** | **433,849** | **89,411,221** |

| by month | n   | out     | agentTotal |
| -------- | --- | ------- | ---------- |
| 2026-08  | 9   | 375,648 | 85,912,212 |
| 2026-09  | 4   | 58,201  | 3,499,009  |

All nine August candidates fall on a single day, **2026-08-24**; September's four are one
each on the 2nd, 5th, 9th and 11th.

Top 10 by `agentTotal`:

| #   | session  | repo                        | spawned (UTC)            | ended         | requests | out    | cacheCreate | cacheRead  | agentTotal | re-sent | description                                        |
| --- | -------- | --------------------------- | ------------------------ | ------------- | -------- | ------ | ----------- | ---------- | ---------- | ------- | -------------------------------------------------- |
| 1   | cbbe6cc4 | Broken                      | 2026-08-24T23:15:20.140Z | interrupted   | 103      | 69,311 | 239,141     | 16,596,997 | 16,905,655 | —       | Indie platformer controls screens                  |
| 2   | cbbe6cc4 | Broken                      | 2026-08-24T23:15:35.851Z | interrupted   | 95       | 70,779 | 269,048     | 16,161,654 | 16,501,671 | —       | AAA and console controls diagrams                  |
| 3   | cbbe6cc4 | Broken                      | 2026-08-24T23:17:44.180Z | interrupted   | 123      | 52,678 | 196,221     | 15,061,009 | 15,310,154 | —       | Controls screens C                                 |
| 4   | cbbe6cc4 | Broken                      | 2026-08-24T23:17:20.699Z | interrupted   | 95       | 58,379 | 224,723     | 14,150,971 | 14,434,263 | —       | Controls screens A                                 |
| 5   | cbbe6cc4 | Broken                      | 2026-08-24T23:17:31.512Z | interrupted   | 93       | 46,526 | 198,915     | 11,534,910 | 11,780,537 | —       | Controls screens B                                 |
| 6   | cbbe6cc4 | Broken                      | 2026-08-24T23:27:36.828Z | interrupted   | 76       | 45,246 | 212,021     | 9,118,678  | 9,376,097  | —       | Find Astro Bot + Minecraft console pad screenshots |
| 7   | 99991f90 | 29-navy                     | 2026-09-09T07:22:25.634Z | interrupted   | 25       | 26,548 | 389,548     | 1,653,505  | 2,069,651  | —       | BC Task 5 census.sh consumes read layer            |
| 8   | 4566f58b | welcome-to-the-flower-court | 2026-09-05T23:16:37.169Z | quota-blocked | 8        | 28,515 | 136,148     | 536,139    | 701,028    | —       | Implement Task 7: playbook deck with secrets       |
| 9   | 04ebfa83 | reddoor-maintenance         | 2026-08-24T20:10:23.932Z | quota-blocked | 9        | 11,353 | 70,309      | 579,593    | 661,273    | yes     | Review #569: security lens                         |
| 10  | 04ebfa83 | reddoor-maintenance         | 2026-08-24T20:11:12.084Z | quota-blocked | 9        | 11,966 | 63,236      | 515,696    | 590,916    | yes     | Review #569: test-vacuity lens                     |

The three below the cut are `aa1ab1b947ea33fb4` (vida-legacy-foundation, quota-blocked,
`agentTotal` 402,331), `ab15833871b85c793` (the third #569 lens, 351,646) and
`af436d528ff891598` (reddoor-maintenance, interrupted, 325,999).

The shape of the list is the finding. **Six of the ten most expensive orphans are one
episode** — `cbbe6cc4` in Broken, six research agents dispatched between 23:15 and 23:27
on 2026-08-24 and all six cut off within a second of each other at 23:52:07–23:52:09.
Together they are 84.3M of the 89.4M `agentTotal` and 342,919 of the 433,849 `out`, and
not one of them was re-sent. The kind's headline counter is `cacheRead` (86.8M against
433,849 `out`), which is what a long-running research agent's context re-reads look like —
a reason to read `agentTotal` as "what this agent had spent when it died", not as a
recoverable saving.

The `orphaned-agent` costs do **not** double-count `continue-after-block`, which measures
the session's spend in the 30 minutes **after** the resume; these agents died before it.
They may overlap `spend-after-stop`, which charges subagent-lane spend after a stop prompt
— the interrupt that killed the six Broken agents is exactly such an event.

**The two secondary controls in the brief do not appear, and both were checked
individually.** Neither is a miss by the detector:

- **songbook `4fc94047`, "8 corpus verifiers died on the limit" around 2026-08-25T01:34Z.**
  That session has 18 subagent transcripts and **every one of them ends in a finished
  assistant turn**; the earliest starts at 04:47Z, three hours after the block. Whatever
  died at 01:34Z left no subagent transcript — it was not an `Agent` dispatch.
- **Broken `5a73f238`, "a fifth pass died" around 2026-09-02T18:28Z.** That session has 6
  subagent transcripts, all finished. The corpus's only orphan at that minute is
  `aa1ab1b947ea33fb4`, spawned 18:26:35Z and killed 18:27:42Z — but in session `3384a925`,
  repo **vida-legacy-foundation**, not in Broken. The same wall, a different session.

Both are candidates the earlier rounds nominated from the **parent's** view of a block;
this detector only sees a dispatch that wrote its own transcript. That gap is real and is
the kind's stated limit.

### redo

| kind                      | candidates | out       | cacheCreate | cacheRead   | agentTotal |
| ------------------------- | ---------- | --------- | ----------- | ----------- | ---------- |
| `reread-after-compaction` | 19         | 2,340,602 | 5,136,841   | 499,600,021 | 0          |
| `duplicate-agent-prompt`  | 100        | 0         | 0           | 0           | 4,557,286  |

Top 10 by the census's sort — **all `reread-after-compaction`**, because every
`duplicate-agent-prompt` candidate has `out` 0 (its cost lives in `agentTotal`) and so
sorts below all nineteen. A refuter round driven by this sort will never see the 100
duplicate-agent candidates or the 4.6M `agentTotal` behind them.

| #   | session  | repo                | timestamp (UTC)          | out     | cacheCreate | cacheRead  | trigger | preTokens | filesReRead |
| --- | -------- | ------------------- | ------------------------ | ------- | ----------- | ---------- | ------- | --------- | ----------- |
| 10  | 5fe60bbc | Broken              | 2026-08-18T22:27:13.451Z | 188,976 | 303,661     | 17,695,716 | manual  | 478,394   | 3           |
| 11  | e83b35c6 | Broken              | 2026-08-31T22:40:32.953Z | 158,906 | 340,568     | 35,205,151 | manual  | 564,944   | 8           |
| 12  | 4fc94047 | songbook            | 2026-08-25T19:00:10.470Z | 156,072 | 297,319     | 46,341,933 | manual  | 470,340   | 6           |
| 13  | cbbe6cc4 | Broken              | 2026-08-25T18:56:52.458Z | 153,332 | 301,970     | 33,796,072 | manual  | 485,168   | 8           |
| 14  | 432e8c1f | reddoor-maintenance | 2026-08-25T22:33:02.733Z | 152,019 | 335,972     | 60,112,773 | manual  | 743,885   | 4           |
| 15  | cbbe6cc4 | Broken              | 2026-08-26T23:57:30.103Z | 147,332 | 318,707     | 36,109,777 | manual  | 532,494   | 13          |
| 16  | f82eebd3 | reddoor-website     | 2026-08-27T00:14:28.686Z | 141,770 | 378,111     | 30,617,643 | manual  | 477,889   | 10          |
| 17  | cbbe6cc4 | Broken              | 2026-08-25T22:25:43.586Z | 141,141 | 273,151     | 25,210,324 | manual  | 704,767   | 6           |
| 18  | cbbe6cc4 | Broken              | 2026-08-26T15:16:08.287Z | 132,704 | 272,050     | 21,284,944 | manual  | 752,522   | 9           |
| 19  | 5fe60bbc | Broken              | 2026-08-19T21:53:21.177Z | 132,615 | 308,033     | 34,239,588 | manual  | 486,549   | 3           |

Every one of the nineteen has `trigger: "manual"`. Not one automatic compaction in the
corpus produced a re-read of three or more already-seen files — the compactions that
cost a re-read are the ones the operator asked for.

### unread

| kind             | candidates | out     | cacheCreate | cacheRead   | agentTotal |
| ---------------- | ---------- | ------- | ----------- | ----------- | ---------- |
| `corrected-turn` | 21         | 432,001 | 3,293,829   | 114,333,856 | 0          |

Top 10 by the census's sort:

| #   | session  | repo                       | timestamp (UTC)          | out     | cacheCreate | cacheRead  | minutes |
| --- | -------- | -------------------------- | ------------------------ | ------- | ----------- | ---------- | ------- |
| 20  | a55e35eb | octagonal-led-turn-counter | 2026-09-05T00:58:46.766Z | 109,174 | 542,207     | 17,526,558 | 156     |
| 21  | 3384a925 | vida-legacy-foundation     | 2026-09-04T19:41:19.055Z | 104,497 | 1,112,144   | 43,848,854 | 37      |
| 22  | 6257e022 | reddoor-website            | 2026-09-04T18:27:59.816Z | 33,143  | 550,726     | 13,756,325 | 969     |
| 23  | 5fe60bbc | Broken                     | 2026-08-20T20:27:30.238Z | 31,418  | 42,558      | 5,383,359  | 111     |
| 24  | cbbe6cc4 | Broken                     | 2026-08-25T04:09:55.001Z | 26,607  | 35,177      | 6,965,720  | 30      |
| 25  | 5a73f238 | Broken                     | 2026-09-02T21:24:59.837Z | 25,457  | 310,052     | 2,126,236  | 8       |
| 26  | 5fe60bbc | Broken                     | 2026-08-18T21:39:34.903Z | 13,137  | 15,806      | 2,636,457  | 7       |
| 27  | 5fa00f25 | caldea                     | 2026-08-24T19:49:52.688Z | 12,500  | 26,849      | 1,216,565  | 6       |
| 28  | 157136b2 | reddoor-maintenance        | 2026-08-17T16:06:22.936Z | 11,265  | 16,205      | 1,228,896  | 8       |
| 29  | cbbe6cc4 | Broken                     | 2026-08-25T03:00:17.911Z | 10,832  | 495,072     | 2,003,949  | 8       |

`minutes` is the width of the costed window, not a duration of wasted work. Candidate
22's window is 969 minutes — sixteen hours, an overnight gap between two prompts — and
its cost is therefore an upper bound on anything the correction could have been about.
The refuter's first job on the long-window rows is to narrow them.

## Reverts (uncosted)

Reverts cannot be costed from transcripts without linking a commit to the session that
wrote it, so this pass reports counts only. `git log --all --since=2026-08-16
--grep=^[Rr]evert`, subject re-tested in the census, over every **repository** under
`~/Documents/GitHub`:

| repo              | reverts | subject                                                                                      |
| ----------------- | ------- | -------------------------------------------------------------------------------------------- |
| `caltex-landing`  | 1       | `Revert "test(prismic): temporary probe field to prove headless model delivery (#54)" (#55)` |
| `reddoor-website` | 1       | `revert(deps): stay on maintenance 0.83 — the 0.87 bump breaks CI's a11y job`                |
| **total**         | **2**   |                                                                                              |

Skipped as linked worktrees: `reddoor-maintenance-e2ebudget`,
`reddoor-maintenance-turso-spec`.

**The first run reported 145 rows here, and every one of the two corrections below was
needed before anything could be read off it.** Re-run against the same disk minutes
apart, the old command returns 148 rows and the new one returns 2. It had grown by 3
since the first run, from a **single** commit — the one fixing this very defect, whose
message says the word "revert" — counted once in each of the three directories.

- The scan walked **directories**, not repositories. `reddoor-maintenance-e2ebudget` and
  `reddoor-maintenance-turso-spec` are git worktrees sharing `reddoor-maintenance/.git`,
  so `--all` saw one ref store three times and its 35 rows were counted thrice. A linked
  worktree marks its `.git` as a **file** rather than a directory, which is the only
  thing that distinguishes it from a repository of its own from the outside; the census
  now skips those and names them.
- `-i --grep=revert` matched the word anywhere in a commit **message**, not the act.
  The pattern is now `^[Rr]evert` — but the instrument was probed before it was trusted,
  and git anchors that `^` **per line of the message, not to the subject**: a commit
  whose body starts a line with "revert" still comes back. So the parsed subject is
  re-tested in the census, and that is what decides. Both rules are in the fixture at
  `tests/meta-week/census.test.ts`, which goes 6 rows → 1 on a repo with one real
  revert, one "mentions revert" subject, one "revert" body line and a linked worktree.

Two reverts in a month across the fleet is the measured floor for this signal, and the
"commits that talk about reverting" number is gone rather than corrected — it was never
a count of anything.

## Confirmed

Refuter round run 2026-09-14; verdicts and the critic's output are in
`_data/census-refute.json` (Workflow run `wf_5995dc02-1a5`). Selection: after dropping
the two collector-noise shapes (`<ide_opened_file>` and the harness's summarisation
request), the top candidates **per kind** — by `out`, or `agentTotal` for
`duplicate-agent-prompt`, or `sessions` for `same-turn-many-sessions`: 8
`reread-after-compaction`, 8 `duplicate-agent-prompt`, 8 `corrected-turn`, 3
`spend-after-stop` (all that remained), 4 `same-turn-many-sessions` — 31 in all. Each
window was printed by `transcript-window.mjs --max 300` (cut at 400 lines) and handed
to one Opus skeptic told to **default to refuted**; four ran at a time; then one
completeness critic read every verdict. Cost of the round: 32 agents, 1,981,897
subagent tokens, 79 tool calls, 7m54s wall.

**4 confirmed, 27 refuted, 0 unclear.** The four's waste shares of their own windows:
0.60, 0.35, 0.20, 0.10. Two of the four were confirmed under a different kind than the
one nominated, and a third on a different anchor than the one cited.

| kind                      | nominated | confirmed | why the rest fell                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reread-after-compaction` | 8         | 0         | every counted re-read was a file the session had just edited (read-before-edit, or a second region of a 1,600–1,900-line file) or a render it had just regenerated (PNG study sheets); the windows open on fresh operator instructions, not on re-orientation. Caveat on the reasons given: `transcript-window.mjs` does not print the `compact_boundary` record, so "no compaction in the window" is the renderer, not a finding — the refutations stand on the re-reads alone. |
| `duplicate-agent-prompt`  | 8         | 0         | all eight pairs come from one `Broken` session (2026-08-19) executing a 10-task plan subagent-driven; Jaccard ≥ 0.70 came entirely from the per-task brief template ("You are implementing **Task N** of a 10-task plan. Tasks 1–N−1 are done"); the payloads were different tasks and nothing was dispatched twice. As written, the heuristic measures template reuse.                                                                                                          |
| `corrected-turn`          | 8         | 2         | six trailing prompts were acceptances or next instructions ("the arrow is better", "3 would be great", "show me? on desktop"); in two windows the real correction was the prompt that _opened_ the window, so the costed span held the verification that answered it.                                                                                                                                                                                                            |
| `spend-after-stop`        | 3         | 1         | one "stop" was a scope correction about screenshots; one was honoured with a `TaskStop` 17 seconds later. In both, the single counted request was already in flight when the stop was typed.                                                                                                                                                                                                                                                                                     |
| `same-turn-many-sessions` | 4         | 1         | three of four were `/model`, `/compact` and a post-crash "resume" typed into every open session — per-session configuration or unavoidable recovery, zero tokens. The fourth was confirmed as a different kind.                                                                                                                                                                                                                                                                  |

The four confirmed, in the critic's order of evidence quality:

1. **`spend-after-stop`, `Broken`, 2026-08-24T23:51Z — wasteShare 0.6.** "kill them",
   then three subagent requests at +8, +11 and +12 seconds, two returning 2 output
   tokens, ~759k cache-read for output that was discarded. The operator's next turn:
   "my system got overloaded and you didn't stop your agents when i asked you to stop."
   The session had issued six `TaskStop` calls within 14 seconds of the prompt (four of
   them spent on a `ToolSearch` to load the schema), so the window holds the compliant
   tail; the avoidable decision — six parallel agents on a shared machine — sits before
   it. This is the overload behind #776, on the record.
2. **`corrected-turn`, `vida-legacy-foundation`, 2026-09-04T19:41Z — wasteShare 0.1.**
   The nominated prompt ("show me A B and C please") was a routine follow-up. The real
   correction is in the assistant's own text: "The user is right, and I was wrong:
   dadb073 … Airtable is a legacy mirror" — after a 19:05–19:06 attempt to write a URL
   into Airtable that the #539 Turso flip had already superseded; the permission
   classifier stopped the write. This is the unread class in its true shape: a
   **stale mechanism**, not an operator correction, and the detector that found it
   matched the wrong line.
3. **`corrected-turn` → `continue-after-block`, `Broken`, 2026-09-02T21:24Z —
   wasteShare 0.2.** The closing question agreed with the assistant. The episode opens
   the window: "hit a session limit, continue on", then five python/Bash passes over
   the session's own JSONL (21:17:37–21:19:02) digging killed verify-lane findings back
   out of the transcript. `continue-after-block` never fired on the real corpus because
   of its ten-minute rule; here is one of its episodes, caught by a different net.
4. **`same-turn-many-sessions` → `continue-after-block`, `Broken`, 2026-08-24T21:33Z —
   wasteShare 0.35, recorded cost 0.** The repeated turn was `/model opus[1m]`; the
   next line is "hit a session limit continue" and five Godot scripts re-read to rebuild
   state. The weakest of the four; a caution, not an exhibit.

Against the spec's success criterion (one confirmed episode per class, or a documented
null): **fanout** has one (the 2026-08-24 overload); **unread** has one (the Airtable
write after the Turso flip); **redo, as nominated, is a documented null** — 16
candidates across its two kinds, none confirmed, because both detectors match the shape
of normal editing and of template reuse. The two block-then-reorient episodes are
re-derivation by nature, though the kinds table files `continue-after-block` under
fanout; the critic's first two blind spots below are how redo would actually be found.

**Second round, on the fixed detector.** After the four fixes, `continue-after-block`
nominates 11 resumes (lag 57–211 min). The same skeptic read all 11
(`_data/census-refute-cab.json`, 12 agents, 751k subagent tokens, 7m29s): **1
confirmed, 10 refuted.** In ten windows the resume cost one or two tool calls — the
`git status; git log -3` that CLAUDE.md's "re-verify after any pause" mandates — and
the assistant's first line named the task in flight ("Picking up where the loop spec
went green"); the thirty minutes the heuristic charges are the session's actual
output. The one that stood (`reddoor-maintenance`, 2026-08-24T20:14Z) is not
re-orientation either: three #569 review lenses dispatched at 20:10 were killed by the
block at 20:14:09 and re-dispatched at 21:33 — "All three #569 reviewers were killed
mid-flight, so the review must re-run." The critic priced the loss exactly, from the
three orphaned agent transcripts: 32,729 output tokens and ~1.57M context over 26
requests — the discarded prefix, not the re-run (whose findings changed the merge
decision). Two refuted windows carry the same loss unnominated ("8 corpus verifiers
died on the limit"; "a fifth pass died on the session limit", 33 findings rescued by
mining the transcript). So the class is real and the detector is wrong: **the cost of
a block is the agents in flight when it lands**, and the right instrument is
structural — an `Agent` tool call whose result never returns — not a prompt shape.
That detector — `orphaned-agent`, in the Candidates section above — was then built
with the three orphans as its positive control and passed it exactly: 32,729 output
tokens, difference 0, all three `redispatched` ids resolving to the 21:33–21:34
dispatches. On the corpus it finds 13 orphans (5 quota-killed, 8 interrupted), 3 of
them re-sent; six of the top ten are one episode — the six research agents that "kill
them" cut off within two seconds on 2026-08-24T23:52Z, never re-sent — the overload's
dead spend, priced at last. `continue-after-block` stays in the doc as a documented
false-positive generator (10 of 11); the structural detector is the class's instrument.

What the round says about the instrument: **the heuristics found the remediation, not
the defect.** Every window is forward-looking from a marker (compaction, block, stop) or
bounded by the correcting prompt, so it contains the recovery — the `TaskStop`s, the
re-derivation, the corrected write-up — while the decision that cost (the six-way
dispatch, the wrong claim, the stale mechanism) precedes it. And 27 of 31 nominations
were shapes of ordinary work: read-before-edit, template reuse, a configuration command,
an acceptance. The "Candidates" costs above are window costs; the confirmed waste in
this round is a fraction of four windows — roughly 0.6 × 759k cache-read, 0.2 × 25k
output, 0.1 × 104k output, and one at zero — which is not a number to build a budget
on. What survives is the **shape**: the three confirmed classes are the two the
operator named (fan-out onto a shared machine; building on a mechanism that had
changed) plus block-then-reorient, and each was found by a detector aimed at something
else.

## What the heuristics cannot see

- **Re-derived components.** A thing rebuilt from scratch because the agent did not
  know it existed leaves no compaction, no duplicate prompt and no revert. The package
  names episodes of this; only a refuter reading the window can cost one.
- **Work abandoned without a revert.** A branch dropped, a PR closed, a file deleted
  before commit — none of it reaches `git log`, and the transcript shows it as ordinary
  work.
- **Corrections not phrased as corrections.** `CORRECTION_RE` is a word list. An
  operator who silently re-prompts with a better spec, or types "ok now do it properly",
  is invisible. The 21 corrected turns are a lower bound and nothing else.
- ~~**System records posing as operator prompts.**~~ **Fixed.** Two harness records —
  the summarisation request (195 in the corpus) and the compaction continuation (107) —
  were read as prompts and quoted transcript text at the finders; both are now in the
  walker's `SYSTEM_SHAPED`, which removed 2 of the 6 `spend-after-stop` candidates and 7
  of the 14 `same-turn-many-sessions` groups (one of them 12 sessions), and took the
  collected prompt count from 5,026 to 4,723, a drop of 303. (The 195 and 107 come from a
  probe a few minutes before the run; the corpus is live and gains records while you read
  it, which is where the extra one comes from.) Slash commands
  (`<command-name>/compact</command-name>`)
  are still kept deliberately and flagged — 3 groups are those.
  The `<ide_opened_file>` half of that first diagnosis was **wrong** and is corrected in
  "Corrections on first contact": it carries the file's path, not its contents, and it is
  a preamble on a real operator turn (140 of 140 carried one), so it is stripped rather
  than excluded. The exclusion the first run proposed would have deleted 133 genuine
  prompts.
- **Stop and correction phrases inside ordinary prose.** Still open, and now the visible
  one. `STOP_RE` matched "no more" in "citation share is no more within our control" —
  the largest surviving `spend-after-stop` candidate. The word lists cannot tell an
  instruction from a sentence that contains the same words.
- **The prompt count is not a count of operator turns.** 600 of the prompts the walker
  collects are the literal text `"Warmup"`, every one of them in the **subagent** lane,
  so no finder ever sees them — every finder filters to `lane === "main"`, which is 1,765
  of 4,738 **(one-off probe, 2026-09-14, minutes after the run above: the corpus is live
  and grew by 15 prompts in between)**. They were left in rather than filtered out on a
  guess about which mechanism emits them.
- **Sessions the retention boundary has eaten.** The corpus holds roughly the last 34
  days. Anything older is not a zero; it is unmeasured.
- **Subagent files without an `agentId`.** A subagent whose records carry no id folds
  into `subagent:unknown` and cannot be attributed to the `Agent` call that spawned it,
  so its spend cannot be costed against a stop request.
- **Which session wrote a commit.** Nothing links a git commit to a transcript, which
  is why the revert pass is uncosted.
- **Whether any of this was waste.** The census nominates; the refuter round above read
  31 nominations and kept 4. Every number in the "Candidates" tables is the cost of a
  _window_, not the cost of a mistake, and the confirmed waste is a fraction of four
  windows.

Added by the completeness critic after the refuter round (each with how it could be
measured instead):

- **The defect sits before the window.** 27 refutations came from windows that caught
  the remediation. Anchor backwards: from a retraction, match its subject to the
  earliest turn that asserted it and charge that span; from a `TaskStop`, walk back to
  the `Agent` calls it killed and charge the dispatch.
- **Corrections in the assistant's own text.** `unreadCandidates` matches only USER
  text, so "The user is right, and I was wrong" was missed while a routine follow-up was
  flagged. Match ASSISTANT text ("I was wrong", "I overstated", "let me verify rather
  than assert") and charge back to the claim retracted.
- **Subagent-internal waste.** Every detector filters to `lane === "main"`; a
  subagent's own re-reads, dead ends and loops are invisible and only its `totalTokens`
  is charged. Run the same detectors over subagent lanes, and compare each agent's
  `totalTokens` with how much of its result the parent ever quotes or acts on.
- **Output produced and never kept.** No detector asks whether anything survived: a
  deleted branch, a discarded agent result, a rewritten spec all score zero. Measure
  diff-survival — for each file written in a window, does its content exist at HEAD
  seven days later; for each branch, was it merged; for each `Agent` result, is it ever
  quoted afterwards.
- **Autonomous stretches with no prompt to anchor on.** `/loop` runs, routines and
  background tasks are structurally unreachable. Anchor on artifacts: spend between
  two commits, tokens per surviving diff line, any span with high spend and no durable
  output.
- **Slash commands and tool-generated lines counted as turns.** All three refuted
  `same-turn-many-sessions` nominations were `/model`, `/compact` or a crash-resume.
  Exclude slash-command, hook and IDE-generated prompts before grouping, and require a
  substantive instruction.
- **Real cross-session duplication.** Exact prompt text inside two minutes cannot see
  two sessions doing the same job worded differently hours apart — the six duplicate-fix
  PRs of 2026-07-09. Measure overlap of touched paths, branch prefixes and PR titles
  across concurrent sessions in one repo within a day.
- **Instrument-blind waste.** Work that is finished, green and useless — a gate that
  can never pass, a VERDICT grepping the wrong command — emits no stop, no compaction and
  no correction, and it is this repo's signature failure. Measure per-check pass/fail
  history: any gate that has only ever passed, or only ever failed, since introduction
  is unproven; pair with whether any mutation ever made it bite.
- **Time and cache cost as distinct from tokens.** `minutes` includes idle (one refuted
  window held a 13-hour gap), polling sleeps cost wall-clock with no tokens, and
  `cacheRead` lands in whatever window it falls in. Split sessions into active spans
  (gap > 10 min = idle), report blocked-on-polling separately, and use cache-read per
  unit of new output rather than raw cache-read.
- **Redundant re-verification.** A full suite re-run, or a screenshot retaken, with
  nothing changed in between is never flagged. Measure: identical Bash command with an
  identical result and no `Edit` to the files under test between the two runs.
- **Killed-in-flight agent prefixes (second critic).** Every heuristic looks at prompts;
  the loss is an `Agent` whose result never came back. Join each `Agent` tool_use id
  to its tool_result in the parent transcript; any subagent file with no matching
  result is dead spend, priced by its own usage — and it also catches Ctrl-C,
  `TaskStop`, crashes and orphaned background agents.
- **Fan-out redundancy on outputs, not prompts.** Two runs of the literally identical
  lens scored Jaccard 0.46–0.55 while deliberately different lenses can be highly
  redundant. Normalise each agent's returned findings (file, line, claim), dedupe
  across the fan-out, and report unique-finding yield per agent — the yield curve
  behind "one adversarial round beat eight parallel lenses" has never been plotted.
- **Self-caught dead ends.** "Real input has been a no-op all along" — no operator
  correction, so no prompt to key on. Detect assistant self-negation and charge the
  span back to the first tool call on that approach.
- **Cross-session rework.** A defect shipped by session A and paid for by session B:
  link fix/revert commits and the journal's forward pointers back to the introducing
  commit.
- **Polling spend.** Repeated `gh run watch` and status calls on one resource id; one
  window watched the same run backgrounded and then foregrounded.
- **The census has no positive control on real data.** 10 of 11 second-round
  nominations were refuted and the survivor was right for a different reason; by the
  repo's own rule the instrument is the suspect. Every detector needs a seeded real
  episode it must flag before its FAILs are reported — the three 20:14:08 orphans are
  the first.
