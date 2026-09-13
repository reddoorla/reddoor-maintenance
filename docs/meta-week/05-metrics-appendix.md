# Metrics appendix — 2026-07-30 → 2026-09-12

Everything here is **measured**, not inferred. Each table names the file it came
from so any figure can be recomputed. Where a measurement has a trap in it, the
trap is stated next to the number rather than in a footnote.

> **This document was corrected once during its own construction.** The first
> draft reported 5,692 operator prompts. That number counts the same prompt many
> times, because a resumed or compacted session rewrites its prior history into a
> new transcript file. Keyed on message UUID the real figure is **2,693** — 53%
> of the raw count was replay. Every prompt-derived figure below is on the
> deduplicated basis, and the correction changed two conclusions, both flagged in
> place. The raw number is kept visible rather than quietly replaced, because the
> gap between them is itself a finding: **replay volume tracks compaction**, and
> compaction peaked on exactly the days that looked busiest.

Derived corpus these figures come from (scratchpad, not committed):

| file                     | rows      | what it is                                                |
| ------------------------ | --------- | --------------------------------------------------------- |
| `repos.jsonl`            | 41        | one row per local checkout                                |
| `commits.jsonl`          | 2,622     | every commit on every ref since 2026-07-30                |
| `prs.jsonl`              | 857       | pull requests created in the window                       |
| `runs.jsonl`             | 3,437     | GitHub Actions runs                                       |
| `sessions.jsonl`         | 3,469     | Claude Code sessions                                      |
| `prompts.jsonl`          | 5,692     | operator prompts, **raw — contains replay**               |
| `prompts-unique.jsonl`   | **2,693** | operator prompts, deduplicated by UUID — **use this one** |
| `discord-messages.jsonl` | 688       | Discord traffic across 20 channels                        |
| `airtable-*.json`        | 5 tables  | the fleet's operational record                            |

---

## Five caveats that change how these numbers read

**1. Prompt counts must come from `prompts-unique.jsonl`.** See the correction
note above. 53% of raw prompt rows are replayed history.

**2. Session-hours are not operator-hours.** The corpus records 1,292.7 hours of
session wall-clock over a 45-day window. That is 28.7 hours per day, which does
not exist. The figure is elapsed start→end time summed across sessions that ran
_concurrently_ — it measures how much machine work was in flight, not how long
anyone sat at a keyboard. Treat it as a concurrency index. Any recommendation
built on it as if it were labour hours will be wrong.

**3. 3,186 of the 3,469 sessions contain zero operator prompts.** Only **283
sessions are human-driven conversations**; the remaining 92% are subagent and
automation sessions spawned by those 283. "3,469 sessions" measures delegated
fan-out, not how often Tucker sat down to work.

**4. Transcripts begin 2026-08-10.** The first eleven days of the window
(Jul 30 → Aug 9) have commits, PRs and CI runs but **no sessions and no
prompts**. A zero in the prompts column there means _not recorded_, not _no
work_ — Aug 3 alone carries 173 commits and 78 merged PRs with no transcript
behind it.

**5. Three Discord channels hit the API's 100-message cap** (`#worthe`
truncated before 2026-08-04, `#rd-clients-by-design` before 2026-08-19,
`#vida-legacy-foundation` at the window edge). Their real volume is higher than
recorded. The other 17 channels are complete.

---

## Volume

| measure                      | value                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Checkouts                    | 41 (3 cannot receive a push: `reddoor-mailer`, `the-pointe` archived; `rfp-analyze` no remote) |
| Commits                      | 2,622                                                                                          |
| PRs created                  | 857 — **763 merged**, 32 still open                                                            |
| CI runs                      | 3,437 — 3,283 success, 137 failure, 16 cancelled (**95.5% green**)                             |
| Human-driven sessions        | 283                                                                                            |
| Subagent/automation sessions | 3,186                                                                                          |
| **Unique operator prompts**  | **2,693**                                                                                      |
| Tool calls                   | ~160,000                                                                                       |

### Who opens pull requests

| author                 | PRs | share |
| ---------------------- | --- | ----- |
| `tucksravin`           | 589 | 69%   |
| `app/reddoor-renovate` | 232 | 27%   |
| `smahre`               | 22  | 3%    |
| `bjhogoboom`           | 14  | 2%    |

Renovate authors **more than a quarter of all pull requests** in the fleet. Two
human collaborators appear, both concentrated outside the Reddoor commercial
repos.

---

## Cadence

### Pull request cycle time

| percentile | time to merge       |
| ---------- | ------------------- |
| p50        | **0.3 h** (~20 min) |
| p75        | 3.9 h               |
| p90        | 17.9 h              |
| p99        | 115.8 h (4.8 days)  |

**62% of merged PRs (475 of 763) merge within one hour of being opened.** The PR
is functioning as a commit-with-CI, not as a review checkpoint — consistent with
a single-operator fleet running auto-merge-on-green, but it does mean the p99
tail (five days) is where anything genuinely contested ends up.

### Pull request size

| percentile | lines changed |
| ---------- | ------------- |
| p50        | 139           |
| p90        | 917           |
| max        | 48,664        |

### Session length

| percentile | duration | tool calls |
| ---------- | -------- | ---------- |
| p25        | 0 min    | 2          |
| p50        | 3 min    | 13         |
| p75        | 7 min    | 28         |
| p90        | 15 min   | 50         |
| p99        | 825 min  | 301        |

Extremely bimodal: half of all sessions are under three minutes, while **50
sessions ran longer than six hours**. There is almost no middle. Short sessions
are subagent fan-out; the long tail is where the real work happens.

---

## Rhythm

### By weekday — unique prompts

| day     | unique prompts | commits | session-hours |
| ------- | -------------- | ------- | ------------- |
| Mon     | 410            | 552     | 236.2         |
| Tue     | 529            | 516     | 335.0         |
| Wed     | 537            | 511     | 200.2         |
| **Thu** | **549**        | 260     | 213.2         |
| Fri     | **174**        | 258     | 93.4          |
| Sat     | 261            | 335     | 98.8          |
| Sun     | 233            | 190     | 116.0         |

> **Corrected conclusion.** On raw counts Tuesday looked like the clear peak. On
> deduplicated counts **Thursday is the busiest day for operator input** (549)
> and Monday–Thursday are nearly flat (410–549). The real signal is not a
> mid-week peak but a **Friday cliff**: 174 prompts, less than a third of
> Thursday and lighter than either weekend day.

**There is no rest day.** Saturday and Sunday together carry 494 unique prompts,
525 commits and 838 sessions.

### By day

`day | dow | sessions | unique prompts | commits | session-hours | repos touched`

```
2026-07-30 Thu    0     -    15    0.0   -   no transcript coverage
2026-07-31 Fri    0     -    84    0.0   -   no transcript coverage
2026-08-01 Sat    0     -     3    0.0   -   no transcript coverage
2026-08-02 Sun    0     -    36    0.0   -   no transcript coverage
2026-08-03 Mon    0     -   173    0.0   -   no transcript coverage — 78 PRs merged
2026-08-04 Tue    0     -    26    0.0   -   no transcript coverage
2026-08-05 Wed    0     -    46    0.0   -   no transcript coverage
2026-08-06 Thu    0     -    14    0.0   -   no transcript coverage
2026-08-07 Fri    0     -    15    0.0   -   no transcript coverage
2026-08-08 Sat    0     -     4    0.0   -   no transcript coverage
2026-08-09 Sun    0     -     0    0.0   -   TRUE ZERO DAY
2026-08-10 Mon   26    46    61   33.5   1
2026-08-11 Tue   22    27    33   31.8   2
2026-08-12 Wed   93    63    81   40.7   4
2026-08-13 Thu  149   104    12   28.9   3
2026-08-14 Fri   58    28    11   33.1   2
2026-08-15 Sat    5    19    14   24.0   1
2026-08-16 Sun  145   127    87   23.0   4
2026-08-17 Mon   96    70    21   52.4   4
2026-08-18 Tue   58    98    84   81.6   4
2026-08-19 Wed   96   126    95   12.2   3
2026-08-20 Thu  187    94    49   20.0   4
2026-08-21 Fri   28    22    54   24.4   3
2026-08-22 Sat   74    83   123    5.5   1
2026-08-23 Sun   28    56    28   53.4   4
2026-08-24 Mon  213   178   179   75.2   6
2026-08-25 Tue  331   140   185   51.0   4
2026-08-26 Wed   45   112   109   25.6   4
2026-08-27 Thu    8    53    15    1.0   1   <- collapse begins
2026-08-28 Fri    5     3     1    0.1   2
2026-08-29 Sat    4     1     3    0.0   1
2026-08-30 Sun    1     1     1    1.4   1
2026-08-31 Mon  143    83    79   71.2   6   <- Turso flip
2026-09-01 Tue  186   190   106   86.0  11   <- PEAK prompts; 11 repos in one day
2026-09-02 Wed  210   145   114   79.2   7
2026-09-03 Thu  239   152    85   71.6   7
2026-09-04 Fri  169    77    55   31.9   4
2026-09-05 Sat  357   138   177   41.3   6
2026-09-06 Sun  196    49    38   38.2   3
2026-09-07 Mon   25    33    39    3.9   1
2026-09-08 Tue   75    74    82   84.5   6
2026-09-09 Wed   81    91    66   42.5   4
2026-09-10 Thu   75   146    70   91.7   7
2026-09-11 Fri   13    44    38    3.8   2
2026-09-12 Sat   28    20    11   28.0   4
```

> **Corrected conclusion.** On raw counts Aug 24–26 looked like a singular spike
> (1,470 prompts). Deduplicated it is 430 — real, but **September 1–5 is an
> equally intense stretch** (190/145/152/77/138 = 702 over five days). The
> original "spike" was amplified by replay, and replay is a compaction artifact,
> so the apparent peak was partly a _measurement of context thrash_ rather than
> of work.

**The crash is real regardless of basis.**

> **Superseded in part by `09-operator-answers.md`.** The cause of the
> 2026-08-27 collapse is now known: a hard weekly account limit, blocked at
> 21:00 and resetting Aug 30 at 2am. The shape described below is accurate;
> the speculation about its cause is not.
> Aug 24–26 carries 430 unique prompts
> and 473 commits. The four days that follow carry **58 prompts and 20 commits** —
> a 90% drop in input and 96% in output. The same shape recurs, smaller, after
> Sep 10 (146 → 44) and Sep 06→07 (49 → 33 with one repo touched).

---

## What the prompts themselves say

Measured across all 2,693 unique prompts. Median prompt length is **170
characters**; **37% are under 80 characters**. This is a terse, high-frequency
steering style, not a long-specification style.

| signal                  | count | share     | regex family                                                                   |
| ----------------------- | ----- | --------- | ------------------------------------------------------------------------------ |
| approval / go-ahead     | 529   | **19.6%** | `yes`, `go ahead`, `do it`, `ship it`, `perfect`                               |
| **demand for evidence** | 348   | **12.9%** | `prove`, `show me`, `are you sure`, `verify`, `did you actually`, `check that` |
| scope pull-back         | 188   | 7.0%      | `too much`, `just do`, `only do`, `keep it simple`, `smaller`                  |
| correction              | 180   | 6.7%      | `that's wrong`, `you didn't`, `you missed`, `not what i`                       |
| negation / stop         | 110   | 4.1%      | `no,`, `nope`, `stop`, `hold on`, `wait,`                                      |
| revert / undo           | 93    | 3.5%      | `revert`, `undo`, `roll back`, `restore`                                       |

_(Keyword families over-count slightly — "wrong" appears in discussion as well as
in correction — so treat these as upper bounds on rates, and as reliable for
comparison between categories.)_

**One in eight prompts asks an agent to prove something.** That is the single
loudest pattern in the corpus, and it is the behavioural counterpart of the
project's top rule ("prove the instrument before you trust its verdict"). One in
five prompts is pure approval — the operator acting as a merge gate.

Representative, verbatim:

> _"phew ok, what just happened? my system got overloaded and you didn't stop
> your agents when i asked you to"_ — 2026-08-24, the peak day

> _"fix the wrong gate, did you ship the new changes for the controls and params
> ui?"_ — 2026-08-20

> _"changed the subdomain, should be all set, where do we stand, tell me what you
> made before you run off again"_ — 2026-09-04

---

## Where the effort went

| repo                                      | sessions | unique prompts | commits | active days | session-hours |
| ----------------------------------------- | -------- | -------------- | ------- | ----------- | ------------- |
| `reddoor-website`                         | 701      | **677**        | 254     | 22          | 239.1         |
| `reddoor-maintenance`                     | 334      | 344            | 413     | 16          | **240.1**     |
| `Broken` _(personal)_                     | 642      | 438            | 359     | 14          | 152.4         |
| `beachfront-dentistry`                    | 95       | 203            | 249     | 7           | 69.9          |
| `vida-legacy-foundation`                  | 452      | 141            | 100     | 8           | 125.6         |
| `caldea` _(personal)_                     | 222      | 117            | 56      | 16          | 54.6          |
| `dont-lose-your-head` _(personal)_        | 94       | 117            | 178     | 3           | 31.7          |
| `songbook` _(personal)_                   | 342      | 105            | 117     | 5           | 89.4          |
| `29-navy`                                 | 85       | 98             | 66      | 4           | 52.5          |
| `gallerysonder`                           | 27       | 93             | 53      | 5           | 46.1          |
| `welcome-to-the-flower-court`             | 62       | 83             | 75      | 3           | 25.9          |
| `reddoor-starter`                         | 90       | 80             | 44      | 2           | 46.7          |
| `scriptorium-setup`                       | 75       | 69             | 89      | 6           | 39.1          |
| `octagonal-led-turn-counter` _(personal)_ | 104      | 56             | 0       | 3           | 50.9          |

**Personal projects take 38% of unique operator prompts** (1,015 of 2,693).
`Broken` alone (438) is second only to `reddoor-website` and ahead of the central
orchestrator.

`octagonal-led-turn-counter` shows zero commits against 50.9 session-hours and 56
prompts — and the reason is worth stating precisely, because "zero commits" reads
like abandoned work and it is not: **the directory is not a git repository at
all.** There is no `.git` at either the top level or nested inside it. Three days
of work exist only as files on one disk, with no version control and therefore no
remote, no history and no recovery. It is the only directory in
`~/Documents/GitHub` in that state.

_(Checked while correcting this line: no other repository was missed by nesting —
every other directory under `~/Documents/GitHub` carries its `.git` at the top
level, so the commit census covers them all.)_

---

## Tooling

### Tool calls

| calls   | tool                  |
| ------- | --------------------- |
| 114,747 | `Bash`                |
| 13,101  | `Read`                |
| 11,401  | `Edit`                |
| 3,822   | `Write`               |
| 3,119   | `ctx_execute`         |
| 1,854   | `StructuredOutput`    |
| 1,774   | `chrome__use_browser` |
| 1,348   | `Agent`               |
| 1,084   | `ToolSearch`          |
| 727     | `WebSearch`           |
| 653     | `AskUserQuestion`     |
| 547     | `WebFetch`            |
| 541     | `ctx_batch_execute`   |
| 525     | `SendUserFile`        |
| 352     | `TodoWrite`           |
| 349     | `SendMessage`         |
| 336     | `Skill`               |
| 268     | `Artifact`            |
| 260     | `Workflow`            |

**Bash is 72% of all tool calls** — roughly nine Bash invocations per Read and
ten per Edit.

### Subagent types

| spawns | type                                   |
| ------ | -------------------------------------- |
| 1,040  | `general-purpose`                      |
| 249    | `superpowers:code-reviewer`            |
| 35     | `Explore`                              |
| 20     | `episodic-memory:search-conversations` |
| 4      | one-off named agents                   |

**`general-purpose` is 76% of all subagent spawns**, against 35 uses of the
purpose-built read-only `Explore` agent — 30:1 in favour of the least-specified
option.

### Skills invoked

| uses   | skill                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------ |
| 58     | `superpowers:brainstorming`                                                                      |
| 45     | `superpowers:writing-plans`                                                                      |
| 40     | `superpowers:subagent-driven-development`                                                        |
| 37     | `artifact-design`                                                                                |
| 31     | `figma:figma-design-to-code`                                                                     |
| 22     | `superpowers:test-driven-development`                                                            |
| 19     | `evening-review`                                                                                 |
| 12     | `superpowers:systematic-debugging`                                                               |
| 12     | `figma-slices`                                                                                   |
| 11     | `superpowers-chrome:browsing`                                                                    |
| 10     | `claude-api`                                                                                     |
| 8      | `new-site`                                                                                       |
| 6      | `code-review` · 6 `markup-review`                                                                |
| 5      | `finishing-a-development-branch`                                                                 |
| 4      | `executing-plans`                                                                                |
| 3      | `using-git-worktrees`                                                                            |
| 1 each | `verification-before-completion`, `run`, `workflow-authoring`, `design`, `artifact-capabilities` |

`brainstorming` → `writing-plans` → `subagent-driven-development` is the spine of
the workflow, in that order and roughly that ratio. Note
`verification-before-completion` was invoked **once** in seven weeks, and
`using-git-worktrees` **three times** — against a project rule mandating a
worktree before any commit in the central repo.

### Models

| sessions | model              |
| -------- | ------------------ |
| 1,531    | `claude-opus-5`    |
| 530      | `claude-fable-5`   |
| 389      | `claude-haiku-4-5` |
| 351      | `claude-opus-4-5`  |
| 313      | `claude-fable-5-1` |
| 297      | `<synthetic>`      |
| 136      | `claude-sonnet-5`  |
| 10       | `claude-opus-4-8`  |

### Interruptions and context pressure

| measure                           | count   |
| --------------------------------- | ------- |
| User interruptions (ESC mid-turn) | **212** |
| Compaction events                 | **288** |
| `/model` switches                 | **95**  |
| Other slash commands              | 31      |

Compaction clusters on the heaviest days — 41 on Aug 25, 37 on Aug 19, 27 on
Aug 24, 25 on Sep 3. _Caveat:_ the extraction counts `<command-name>` markers
and cannot distinguish an operator-typed `/compact` from an auto-triggered one,
so read 288 as "compaction events", not "times Tucker chose to compact". Either
way it is the most frequent non-work action in the record, and — per the
correction at the top of this document — it is what inflated the raw prompt
counts by 53%.

---

## CI health

| workflow     | runs  | failures | rate     |
| ------------ | ----- | -------- | -------- |
| `renovate`   | 1,629 | 3        | 0.2%     |
| `ci`         | 1,522 | 132      | **8.7%** |
| `lighthouse` | 103   | 1        | 1.0%     |
| `release`    | 41    | 1        | 2.4%     |

Nearly all fleet CI failure is concentrated in one workflow. Renovate runs more
often than anything else and essentially never fails.

---

## The operational record (Airtable)

`Websites` — 45 rows:

| status        | count  |
| ------------- | ------ |
| `maintained`  | **13** |
| `archived`    | 12     |
| `external`    | 9      |
| `building`    | 7      |
| `hosted-only` | 2      |
| `launching`   | 2      |

Only **13 of 45 sites carry `maintained`**, and `status=maintained` gates every
fleet sweep — so two-thirds of the recorded fleet sits outside the automation's
reach by configuration.

Other tables: `Submissions` 48 rows, `Reports` 17, `Digest State` 1,
`Spam Screenouts` 0.

## Client communication (Discord)

688 messages across 20 active channels, 2026-07-30 → 2026-09-11, **all
human-authored — zero bot messages**. Busiest: `#worthe` (100+, capped),
`#vida-legacy-foundation` (100+, capped), `#rd-clients-by-design` (100+,
capped), `#rd-website` 67, `#revogen` 57, `#beachfront-dentistry-website` 40,
`#hedloc-web` 35, `#trinity-law-school` 33, `#sonder` 29.

Two active channels — `#worthe` and `#trinity-law-school` — have **no
corresponding repository** in `~/Documents/GitHub`, suggesting prospective or
externally-hosted work the fleet's tooling cannot see.
