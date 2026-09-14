# 11 — Wasted-work census

Run 2026-09-14 (Tasks 1–7 of `docs/superpowers/plans/2026-09-15-wasted-work-census.md`;
the plan's filename says 2026-09-15, the run happened on the 14th).
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

| class      | kind                      | the heuristic, exactly                                                                                        | cost window                                                                       |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **fanout** | `spend-after-stop`        | an operator prompt matching a stop phrase, after which that session's subagents produced at least one request | from the stop prompt to the next operator prompt (or +60 min), subagent lane only |
| **fanout** | `continue-after-block`    | a limit block followed within ten minutes by a prompt containing "contin"                                     | the session's spend in the 30 minutes after the continue                          |
| **fanout** | `same-turn-many-sessions` | the same normalized prompt text typed into three or more distinct sessions inside two minutes                 | none — the cost is operator attention, reported as a session count                |
| **redo**   | `reread-after-compaction` | after a compaction, the same session `Read`s three or more files it had already read, edited or written       | the main lane's spend in the hour after the compaction                            |
| **redo**   | `duplicate-agent-prompt`  | two `Agent` dispatches in one session whose prompts have Jaccard word similarity ≥ 0.70                       | the later agent's reported `totalTokens`, kept separately as `agentTotal`         |
| **unread** | `corrected-turn`          | an operator prompt matching a correction/evidence-demand phrase                                               | the session's spend from the previous operator prompt to the correction           |

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

## Candidates

The corpus walked: 3,299 transcript files, 4,988 operator prompts, 92,654 tool calls,
339 subagent results, 131 interrupts (`census-summary.json`).

### fanout

| kind                      | candidates | out   | cacheCreate | cacheRead | agentTotal |
| ------------------------- | ---------- | ----- | ----------- | --------- | ---------- |
| `spend-after-stop`        | 6          | 8,893 | 84,106      | 1,869,175 | 0          |
| `same-turn-many-sessions` | 14         | 0     | 0           | 0         | 0          |
| `continue-after-block`    | 0          | 0     | 0           | 0         | 0          |

`continue-after-block` nominated **nothing on the whole corpus** — a measured zero, and
the heuristic's fault rather than the world's. Its ten-minute window is wrong by two
orders of magnitude. **(one-off probe, 2026-09-14)** The corpus holds 243 limit-block
records (217 subagent lane, 26 main) across 14 distinct sessions, and 201 main-lane
operator prompts containing "contin…" across 51 sessions; 13 of the 14 block-carrying
sessions have one. Measuring block → first same-session main-lane "contin…" prompt over
all 243 blocks gives n = 237, **minimum 57 minutes**, median 212, maximum 1,312. Exactly
one is inside an hour and none inside ten minutes — which is what waiting for a limit to
reset looks like. Widen the window to five hours and this kind fires on 160 of 237; at
ten minutes it can only ever report zero.

Until then, the behaviour surfaces under `same-turn-many-sessions` instead: the four
genuine groups there are all resumes after a wall.

Top 10 by the census's sort:

| #   | kind                      | session  | repo                | timestamp (UTC)          | out   | cacheCreate | cacheRead | evidence                                                      |
| --- | ------------------------- | -------- | ------------------- | ------------------------ | ----- | ----------- | --------- | ------------------------------------------------------------- |
| 0   | `spend-after-stop`        | f82eebd3 | reddoor-website     | 2026-08-26T20:16:07.577Z | 6,943 | 73,425      | 650,888   | `subagentRequestsAfter` 16                                    |
| 1   | `spend-after-stop`        | cbbe6cc4 | Broken              | 2026-08-24T23:50:36.701Z | 1,191 | 2,033       | 230,667   | `subagentRequestsAfter` 1                                     |
| 2   | `spend-after-stop`        | cbbe6cc4 | Broken              | 2026-08-24T23:51:55.603Z | 523   | 7,051       | 759,123   | `subagentRequestsAfter` 3                                     |
| 3   | `spend-after-stop`        | 5867cbc7 | the-bench           | 2026-09-05T17:12:21.510Z | 220   | 0           | 22,037    | `subagentRequestsAfter` 3                                     |
| 4   | `spend-after-stop`        | cb4a3de7 | gallerysonder       | 2026-08-31T17:49:31.614Z | 10    | 1,597       | 184,423   | `subagentRequestsAfter` 1                                     |
| 5   | `spend-after-stop`        | 1c8a1263 | the-bench           | 2026-09-05T17:12:25.379Z | 6     | 0           | 22,037    | `subagentRequestsAfter` 3                                     |
| 6   | `same-turn-many-sessions` | 359d1a6a | dont-lose-your-head | 2026-08-21T21:38:33.753Z | 0     | 0           | 0         | 3 sessions; Broken, dont-lose-your-head                       |
| 7   | `same-turn-many-sessions` | 4938b547 | caldea              | 2026-08-24T18:54:19.118Z | 0     | 0           | 0         | 3 sessions; beachfront-dentistry, caldea, reddoor-maintenance |
| 8   | `same-turn-many-sessions` | 033c6321 | caldea              | 2026-08-24T18:56:31.611Z | 0     | 0           | 0         | 3 sessions; beachfront-dentistry, caldea                      |
| 9   | `same-turn-many-sessions` | cbbe6cc4 | Broken              | 2026-08-24T21:33:18.441Z | 0     | 0           | 0         | 3 sessions; Broken, beachfront-dentistry, reddoor-maintenance |

Some of these are visibly wrong before a refuter opens them, and the failure is in the
_prompt collector_, not the finder. Of the 6 `spend-after-stop` candidates, 1 is an
`<ide_opened_file>` system record (candidate 0, the largest) and 2 are the harness's own
"Context: This summary will be shown in a list…" summarisation request; 3 are genuine
operator stops. Of the 14 `same-turn-many-sessions` groups, 7 are that summarisation
request, 3 are slash commands (`/model`, `/compact` — kept deliberately, and flagged),
and **4 are genuine operator turns** — every one of them a resume after a wall:
"hit a usage limit, continue", "hit a session limit, resume", "hit a session limit,
continue on", "computer crashed because I also opened steam, resume", each typed into
3 or 4 sessions inside two minutes. (Counts from `census-candidates.jsonl`.) See "What
the heuristics cannot see".

### redo

| kind                      | candidates | out       | cacheCreate | cacheRead   | agentTotal |
| ------------------------- | ---------- | --------- | ----------- | ----------- | ---------- |
| `reread-after-compaction` | 19         | 2,340,602 | 5,136,841   | 499,600,021 | 0          |
| `duplicate-agent-prompt`  | 308        | 0         | 0           | 0           | 21,768,941 |

Top 10 by the census's sort — **all `reread-after-compaction`**, because every
`duplicate-agent-prompt` candidate has `out` 0 (its cost lives in `agentTotal`) and so
sorts below all nineteen. A refuter round driven by this sort will never see the 308
duplicate-agent candidates or the 21.8M `agentTotal` behind them.

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
wrote it, so this pass reports counts only. `git log --all --since=2026-08-16 -i
--grep=revert` over every repo under `~/Documents/GitHub`:

| checkout                         | commits matching "revert" |
| -------------------------------- | ------------------------- |
| `reddoor-maintenance`            | 34                        |
| `reddoor-maintenance-e2ebudget`  | 34                        |
| `reddoor-maintenance-turso-spec` | 34                        |
| `reddoor-website`                | 14                        |
| `Broken`                         | 8                         |
| `scriptorium-setup`              | 6                         |
| `beachfront-dentistry`           | 5                         |
| `vida-legacy-foundation`         | 4                         |
| `29-navy`                        | 2                         |
| `songbook`                       | 2                         |
| `caltex-landing`                 | 1                         |
| `the-pointe`                     | 1                         |
| **total rows**                   | **145**                   |

**That total is not 145 reverts, and the table needs two corrections before anything is
read off it.**

- The scan walks **directories**, not repositories. `reddoor-maintenance-e2ebudget` and
  `reddoor-maintenance-turso-spec` are git worktrees sharing
  `reddoor-maintenance/.git`, so `--all` sees one ref store three times: the same 34
  commits are counted thrice. Distinct commits: **77**.
- `--grep=revert` matches the word anywhere in a commit **message**, not the act.
  Of the 145 rows in `census-summary.json`, **2** have a subject that begins with
  "Revert" / "revert(" — `caltex-landing`'s revert of a temporary Prismic probe field
  and `reddoor-website`'s `revert(deps)` pin. The other 143 rows are commits that merely
  mention reverting, this plan's own Task 6 commit among them.

So: the git signal, as specified, is a word-frequency count. Read it as "commits that
talk about reverting", and take the two real reverts as the measured floor.

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
- **System records posing as operator prompts.** `<ide_opened_file>` is injected as a
  `type: "user"` record and is not in the walker's `SYSTEM_SHAPED` list, so it reads as
  a prompt — and it carries whatever text the file contained, which is how it matched a
  stop phrase in candidate 0 and a correction phrase in two `corrected-turn` rows. The
  harness's "Context: This summary will be shown in a list…" summarisation request has
  the same shape and accounts for 7 of the 14 `same-turn-many-sessions` groups (one of
  them 12 sessions) and 2 of the 6 `spend-after-stop` candidates. Slash commands
  (`<command-name>/compact</command-name>`) are kept deliberately, flagged, and 3 more
  groups are those. 2 of the 21 `corrected-turn` rows are `<ide_opened_file>` records as
  well. Adding `<ide_opened_file>` and the summarisation request to `SYSTEM_SHAPED`
  would remove 12 of the 41 fanout-and-unread candidates before a refuter reads one.
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
