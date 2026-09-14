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
confirmed it. Nothing in the "Candidates" section below has been refuted yet.

Three classes, five kinds:

| class      | kind                      | the heuristic, exactly                                                                                                                                                                      | cost window                                                                       |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **fanout** | `spend-after-stop`        | an operator prompt matching a stop phrase, after which that session's subagents produced at least one request                                                                               | from the stop prompt to the next operator prompt (or +60 min), subagent lane only |
| **fanout** | `continue-after-block`    | a limit block followed within six hours by a prompt containing "contin" — one candidate per resume, paired with the nearest block before it                                                 | the session's spend in the 30 minutes after the continue                          |
| **fanout** | `same-turn-many-sessions` | the same normalized prompt text typed into three or more distinct sessions inside two minutes                                                                                               | none — the cost is operator attention, reported as a session count                |
| **redo**   | `reread-after-compaction` | after a compaction, the same session `Read`s three or more files it had already read, edited or written                                                                                     | the main lane's spend in the hour after the compaction                            |
| **redo**   | `duplicate-agent-prompt`  | an `Agent` dispatch whose prompt has Jaccard word similarity ≥ 0.70 to an earlier dispatch in the same session — one candidate per repeated dispatch, paired with its closest earlier match | the repeated agent's reported `totalTokens`, kept separately as `agentTotal`      |
| **unread** | `corrected-turn`          | an operator prompt matching a correction/evidence-demand phrase                                                                                                                             | the session's spend from the previous operator prompt to the correction           |

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

| kind                      | PASS control (SEEDED)                                                          | FAIL control (CLEAN) |
| ------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| `spend-after-stop`        | found, `cost.out` 25 — the subagent request one minute after "stop, kill them" | nothing nominated    |
| `continue-after-block`    | found, `lagMin` 3, `cost.out` 12                                               | nothing nominated    |
| `same-turn-many-sessions` | found, `sessions` 3, repos alpha/beta/gamma                                    | nothing nominated    |
| `reread-after-compaction` | found, `filesReReadCount` 3, `cost.out` 57 (the whole hour after the boundary) | nothing nominated    |
| `duplicate-agent-prompt`  | found, similarity ≥ 0.70, `cost.agentTotal` 7,000                              | nothing nominated    |
| `corrected-turn`          | found, `cost.out` 40 — main-lane 15 plus subagent 25 inside the corrected turn | nothing nominated    |

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
pass. The file now carries 13 tests and `tests/meta-week` 29.

| correction               | PASS control                                                                                                                                                     | FAIL control                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| system-shaped records    | SHAPED: an IDE-wrapped operator stop survives with the preamble stripped — `prompt` is "stop, kill them", `cost.out` 30                                          | SHAPED: the summarisation request, the compaction continuation and a preamble-only record nominate nothing, and the walker counts 1 prompt, not 4 |
| `continue-after-block`   | LAGGED: a resume five hours after a wall, one candidate for two block records, `blocks` 2, `lagMin` 180 from the nearer block, `cost.out` 12                     | LAGGED: a resume seven hours after a block, past the bound, nominates nothing                                                                     |
| `duplicate-agent-prompt` | TRIPLE: three near-identical dispatches nominate 2 candidates, `matches` 1 and 2, the third paired with its closest earlier prompt (0.86, not the first at 0.71) | the same fixture nominated 3 before the fix — one per pair                                                                                        |
| reverts (`--git`)        | a fixture repo whose one "Revert …" subject is counted                                                                                                           | the same repo's "mentions revert" subject, its "revert" body line, and a linked worktree of it — 6 rows before, 1 after                           |

## Candidates

The corpus walked: 3,336 transcript files, 4,723 operator prompts, 93,080 tool calls,
343 subagent results, 131 interrupts (`census-summary.json`).

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

Filled after the refuter round.

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
- **Whether any of this was waste.** The census nominates. Until the refuter round
  fills the section above, every number here is the cost of a _window_, not the cost of
  a mistake.
