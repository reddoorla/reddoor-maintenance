# Meta week 2026-09-14 — measuring and changing how the work gets done

**Status:** design, awaiting operator review. Written by Fable 5.1 on
2026-09-14 after reading `docs/meta-week/` (PR #774) and the operator's
answers in this session.

**Charter, as agreed in session.** Two lanes, four days (Mon–Thu), one
session, Fable judges and Opus works. Lane 1 is the how-you-work track: measure,
research, recommend, ship the mechanical changes. Lane 2 is the system track
from `06-priorities-system.md`, run as Opus workers in Appendix B's order.
Deliverable: a recommendations document you approve, then the concrete changes
shipped with proof. The weekly limit resets Sunday and the week is untouched, so
the heavy mining runs on Day 1.

---

## 1. The problem, stated once

You are hitting session and weekly token limits, and a visible share of the
tokens goes to agents working down wrong paths. The evidence package measured
the shape of the work but **counted tool calls, not tokens**, so the primary
pain point has never been measured in its own unit. Two blockers the package
put in front of every context-management recommendation are already cleared:
compaction is mostly you clicking it, and Aug 27 was the weekly cap.

The two kinds of waste you named as hurting most:

1. **Fan-out overload and redo.** Concurrent subagents hit the account ceiling
   (limit blocks correlate with sessions-per-day at r=0.56, with operator
   prompts at 0.32); stop requests that did not stop 13 dispatched agents;
   "continue" typed into four windows in ninety seconds; work re-done after
   compaction or resume; components re-derived three times in one day.
2. **Building on an unread mechanism.** Confident conclusions from a flag,
   gate, or output nobody opened; instruments that could only ever pass; the
   2026-08-12 morning and its rule.

Priorities, in your order, with two additions you accepted in principle and
one flagged:

| rank | priority                                | note                                                                                    |
| ---- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| 1    | correctness of outcome                  | includes **instrument verifiability**: a gate must be able to fail _and_ to pass        |
| 2    | quality and simplicity of code          |                                                                                         |
| 3    | ergonomics for future humans and agents | includes **recoverability**: config on one laptop, stashes, `.claude/` unversioned      |
| 4    | maximise work done between prompts      | includes **operator attention cost**: turns that carry no decision                      |
| 5    | token efficiency                        |                                                                                         |
| 6    | time efficiency                         |                                                                                         |
| —    | rest                                    | flagged once: zero rest days in 45 is a correctness risk; the personal split is settled |

Every recommendation is scored against this list, in this order.

---

## 2. Lane 1 — how you work

### 2.1 Monday evening into Tuesday: measure

This session's first tool call ran at 16:48 on Monday, so "Day 1" is an
evening plus Tuesday morning, and the schedule below says so.

Three instruments. **Each must pass on a known-good input before any figure it
produces is reported.** Scripts live in `scripts/meta-week/`; narrative
outputs in `docs/meta-week/10-*.md` onward; aggregates in
`docs/meta-week/_data/`. Raw prompts, transcript text and Discord content are
not committed, same policy as the package.

#### 2.1.1 Token meter

**Sources.**

- `~/.claude/projects/**/*.jsonl`. Every `assistant` record carries
  `message.usage` with `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, plus `model`,
  `effort`, `attributionSkill`, `attributionPlugin`. Subagent transcripts sit at
  `<project>/<sessionId>/subagents/agent-*.jsonl`, carry `agentId`,
  `isSidechain: true` and `attributionAgent`. Counted on 2026-09-14: 876
  top-level files, 2,075 subagent files, 337 files at an intermediate depth
  still to be classified. Oldest transcript is now 2026-08-16; retention is
  ~30 days and moves every day, so the derived corpus is snapshotted on Day 1.
- `~/.claude/stats-cache.json`: `dailyModelTokens` per day per model since
  2026-03-11, and `modelUsage` aggregates. Its "tokens" unit is not documented;
  it is treated as an independent series to reconcile against, not as truth.

**Dedupe rule.** By message `uuid`, never by text (memory:
`transcript-replay-inflates-prompt-counts`). Resumed and compacted sessions
replay history into new files; a usage record counted twice is spend invented.

> Corrected the same day by `docs/superpowers/plans/2026-09-14-token-meter.md`
> ("Facts", item 1): one API response is written as several assistant records
> sharing a `requestId`, each with a partial `output_tokens`, so **usage**
> dedupes by `requestId` keeping the final snapshot. The `uuid` rule stays
> correct for operator prompts, and also dedupes the compaction and limit-block
> markers.

**Dimensions.** day · ISO week · repo · session · main thread vs subagent ·
model · effort · agent type (`attributionAgent`) · skill attribution. Each
cell reports the four usage counters separately; nothing is pre-weighted.

**Calibration (the PASS control).** The meter's per-day, per-model sums must
reconcile with `stats-cache.json`'s `dailyModelTokens` for the overlap window
to within a stated tolerance, and the reconciliation table is published with
the meter. If they do not reconcile, the discrepancy is the first finding and
no other figure from the meter is quoted until it is explained.

**Budget line.** The weekly limit is a fixed window, not rolling: the
2026-08-27 21:00 block said "resets Aug 30 at 2am", and you confirm the reset
is Sunday. So the empirical weekly ceiling is the spend inside
**Sun 2026-08-23 02:00 → Thu 2026-08-27 21:00**, summed from the transcripts
per usage counter and per model. The meter reports that number first, before
anything else, because the week's soft cap in §4 is derived from it. The
stats cache is a cross-check only: a first look shows it has no row for
Aug 22 or Aug 27, so it is already known to be incomplete, and its "tokens"
unit is undocumented. The session ceiling is characterised the same way from
09-02, 09-05 and 09-06 (67, 73 and 53 session-limit blocks, no weekly block):
tokens in the rolling five-hour window at the moment of each block.

**Output.** `docs/meta-week/10-token-meter.md`: method, calibration table,
the weekly series, spend by repo and by main/subagent, spend by model and
effort, the empirical ceilings, and a one-line daily-spend command the
operator can run. Plus `_data/tokens-*.json`.

#### 2.1.2 Wasted-work census

Heuristics find **candidate** episodes; a refuter reads the raw transcript
window for each candidate before it is counted; only confirmed episodes carry
a token cost into the table. Three classes, one Opus worker each.

| class            | candidate heuristic (transcripts)                                                                                                                                                                                                                                         | cost method                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| fan-out overload | subagents alive concurrently per session (first/last timestamps); account-limit block messages; operator "continue" within 10 min of a block; stop/kill prompts followed by subagent activity continuing; the same operator turn hitting several repos inside two minutes | tokens spent by subagents after a stop request; tokens spent re-prompting and re-orienting after a block |
| redo             | same files re-read or re-edited by the same session across a compaction marker; near-duplicate subagent prompts; commits/PRs reverted or closed unmerged; components re-derived that exist in `$lib` (the three 09-11 episodes are the seed)                              | tokens of the repeated stretch, measured from the first duplicate action to the point of convergence     |
| unread mechanism | an operator correction prompt (the package's regex family: `that's wrong`, `did you actually`, `are you sure`, `prove`, `show me`) walked back to the claim it corrects; journal- and memory-named false greens with their fix PRs                                        | tokens from the claim to the correction, plus the fix PR's session cost where one exists                 |

**Output.** `docs/meta-week/11-wasted-work-census.md`: confirmed count and
tokens per class, share of window, top ten episodes with session ids and the
refuter's note, and a "not found" section that says which heuristics returned
nothing, so absence reads as measured rather than unlooked-for.

**The PASS control.** Each heuristic is first run against an episode the
package already names with its date and repo (the 08-24 four-window
"continue", the 09-11 slider re-derivation, the 08-12 GA-credentials gate). A
heuristic that cannot find its known instance is not used.

#### 2.1.3 Startup-cost census

What every session pays before you type. Two measurements, one of them
direct.

- **Direct.** For each repo, the first assistant record of each fresh
  (non-resumed) session: its `cache_creation_input_tokens` is the injected
  context — system prompt, both CLAUDE.md files, MEMORY.md index, MCP
  instructions, skill listing, plugin text. Reported as a per-repo median, and
  the same for the first turn of each subagent.
- **Inventory.** CLAUDE.md size for all 41 repos (measured 2026-09-14: 54 to
  341 lines, central repo 213), global CLAUDE.md, MEMORY.md entry count, MCP
  servers configured and their tool counts, plugins enabled and skills
  exposed, the memory-layer census (the package counts five layers, one
  dead).

**Output.** `docs/meta-week/12-startup-cost.md` with the per-repo table and
the fixed-cost estimate per session and per subagent spawn.

### 2.2 Tuesday: research and refute

#### 2.2.1 Verify the levers

A survey agent produced an inventory of Claude Code's own controls
(scratchpad `research/claude-code-levers-inventory.md`, 737 lines). It is
treated as a list of claims. Each lever below is confirmed against the
current official docs with its exact name, location and caveats, or marked
UNCONFIRMED and not built on:

- concurrency cap on subagents; Workflow parallelism cap
- default model and effort for subagents; per-agent `model`/`effort`
  frontmatter; the Agent tool's model override
- `maxTurns` for subagents; how a running fan-out is stopped and whether
  dispatched agents can be recalled
- auto-compact threshold; `PreCompact` hook; `/compact` with instructions
- the full hook event list and what each can block or inject
  (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`,
  `PreCompact`, `SessionStart`)
- prompt-cache TTL and what invalidates the cache mid-session
- what loads at session start; `.claude/rules/`; `@import`
- `permissions.deny` semantics
- `/usage`, `/context`, statusline token display, OpenTelemetry export

#### 2.2.2 Community research

What other people running many repos through Claude Code do about breadth,
context hygiene and budgets: Anthropic's published guidance, engineering
write-ups, hook and agent-definition patterns in public repos, and the
equivalent controls in adjacent harnesses for ideas worth porting. Fetched and
indexed, not pasted; the research note cites what it used.

**Output.** `docs/meta-week/13-research.md`: verified levers table, patterns
found in the wild with sources, and patterns explicitly rejected with reasons.

#### 2.2.3 Generate, judge, refute

For each measured pain point (from 2.1) two or three candidate mechanisms,
each scored against the priority table in §1. A judge panel ranks them. Then
the round that found the most last time: a **refuter** (tries to kill each
survivor), an **evidence auditor** (re-derives every number the candidate
quotes), and a **completeness critic** (what is missing — a pain point with
no candidate, a lever unverified, a claim unread). Items the refuter kills are
kept in the document with the reasoning, as the package does.

### 2.3 Wednesday into Thursday: recommend and ship

**The recommendations document** is written as
`docs/superpowers/specs/<date>-operating-model-recommendations.md`, dated the
day it is written, ranked, each entry carrying: the measured pain it addresses, the mechanism,
the proof plan (what PASS and FAIL controls look like), effort, and "what
would make this a mistake". You approve it before anything ships.

**Candidate mechanisms on the table now**, listed so you can see the space,
not as a ranking — the evidence decides:

- a concurrency cap on subagents, if the lever exists, set where every
  session inherits it
- cheaper default routing for subagents, with named agents overriding upward
  (subagent models observed 2026-09-14 in a 200-file sample: Opus 3,136
  messages, Sonnet 2,239, Fable 535, Haiku 127)
- hooks that travel: a `UserPromptSubmit` capability-index hook and
  `PreToolUse` guards shipped via the starter, which needs the `.claude/`
  gitignore policy decided (A9 in `08-second-pass.md` §4)
- a CLAUDE.md diet with path-scoped rules, measured by the startup census
  before and after
- a compaction handoff: a `PreCompact` hook that writes state to a file, and
  the free practice of reading the summary before continuing
- a budget line in the statusline or a nightly report, from the meter
- a kill switch for a running fan-out, if no native recall exists
- session scoping by deliverable rather than by project, as a cheap A/B
  rather than a rule (open question 5 in `07`)
- the global default (`claude-fable-5-1[1m]`, effort `xhigh`) as the
  starting point of every session, against the 95 manual `/model` switches

**Shipping.** One Opus worker per change, in a worktree, as a PR whose body
carries the proof (the PASS control and the FAIL control, both shown). Fable
reviews every PR against the recommendation it implements before the
head-SHA merge gate. Changes to `~/.claude/` (global settings, hooks) are not
in any repo and the sandbox denies writes there, so they are handed to you as
a diff to apply, or applied only with your explicit permission through the
settings skill, one file at a time.

### 2.4 Thursday: close

The journal entry for the week (the rule: last act of the session, not first
act of the next). The continuity page (`07` §2.3). The meter run over the
meta week itself, reported in the journal — the instrument proving itself on
the week it was built in. What slipped, named.

---

## 3. Lane 2 — system items

Opus workers in worktrees, **at most two concurrent**, Appendix B's order,
Fable reviewing every merge. Each item's "done looks like" and "what would
make it a mistake" from `06-priorities-system.md` is the worker's brief.

| order | item                                                                                                                                | source | operator involvement                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| 1     | tick the `unschedule-branch` checkbox on `reddoor-starter` #97                                                                      | App. B | none                                                                   |
| 2     | S1: merge the 18 `sharp` PRs, **one repo proven end-to-end first**, merge-main-into never rebase                                    | S1     | none, unless a deploy preview looks wrong                              |
| 3     | S2: `--limit` on all 24 tracking-issue queries; close #652 by hand; the stubbed-`gh` gate test with its positive control            | S2     | none                                                                   |
| 4     | five-minute riders (forward pointers, `rfp-analyze` remote, dead credential keys)                                                   | 06/07  | none                                                                   |
| 5     | S3 instrument half: `openSecretAlerts` clause with both controls; enable scanning on the two public repos; org-wide validity checks | S3     | **GCP console** for the three Maps keys; the `whsec_` fixture question |
| 6     | S5: `fleet-form-e2e` `wrote=0 → exit 1`, `skipped=N`, release-health close-side rider                                               | S5     | none                                                                   |
| 7     | S4: one quarterly maintenance report through to delivered; `--preview --enrich` on the five due 2026-10-05                          | S4     | reads the delivered report                                             |
| 8     | S6: #645 lead-path items and the synthetic dead-letter round trip                                                                   | S6     | none                                                                   |
| 9     | S7 outcome metric; continuity page                                                                                                  | S7, 07 | none                                                                   |

Out of Lane 2 unless you say otherwise: **Phase 6 (#646)**, the fleet-wide
staging rollout (#545), the identity implementation for #623. Each is a
decision or a migration, not a meta-week task.

**Decisions only your hands can make**, collected once:

1. GCP console: are the three Maps keys HTTP-referrer restricted? Rotate,
   restrict, or both?
2. #623: identity option A, B or C, or "the head-branch gate is enough for
   now".
3. Phase 6: before or after the 2026-10-05 quarterly batch. One sentence.
4. `src/blux`, `src/webflow`, `canvas-starter`: keep, fold, or archive (A2,
   A3, A8).
5. `.claude/` into version control: yes or no (A9). This one gates Lane 1's
   hooks recommendation.

---

## 4. Guardrails

- **Concurrency.** Lane 1 workflows cap at four concurrent agents; Lane 2 at
  two workers; six total. The census and research fan-outs are pipelines, not
  barriers, so the cap is the only thing holding breadth down.
- **Budget.** The meter is built and calibrated before any fan-out starts.
  The week's soft cap is **60% of the Aug 23–27 ceiling** it reports, in
  transcript units. Spend is reported each evening; if Monday plus Tuesday
  cross half the cap, Wednesday's fan-out is halved and the shipping list is
  cut rather than the proofs.
- **Worktrees and PRs.** Every worker in its own worktree under
  `.claude/worktrees/`; every change a PR; nothing merges without the
  head-SHA gate; `main` is strict, so `BEHIND` means update-branch and
  re-gate on the new SHA.
- **Prove the instrument.** No FAIL is reported from any instrument that has
  not passed on a known-good input in this session. Applies to the meter, the
  three census heuristics, the gate tests in Lane 2, and every hook that
  ships.
- **Read the artifact.** Every number a subagent reports is checked against
  the file it came from before it is quoted. (The levers survey described
  itself as "2,300+ lines"; it is 737.)
- **Stay in lane.** One session this week, but Lane 2 workers still check
  for fresh `fix/*` branches and open PRs on a target repo before touching it.
- **Stop means stop.** If you say stop, running workers are killed before
  anything else is said. The census will tell us whether that has ever
  worked; the guardrail applies regardless.

---

## 5. Deliverables

| #   | artifact                                                                              | lane | day     |
| --- | ------------------------------------------------------------------------------------- | ---- | ------- |
| 1   | `scripts/meta-week/token-meter.mjs` + `docs/meta-week/10-token-meter.md`              | 1    | Mon     |
| 2   | `docs/meta-week/11-wasted-work-census.md`                                             | 1    | Mon–Tue |
| 3   | `docs/meta-week/12-startup-cost.md`                                                   | 1    | Tue     |
| 4   | `docs/meta-week/13-research.md`                                                       | 1    | Tue     |
| 5   | `docs/superpowers/specs/<date>-operating-model-recommendations.md` (you approve)      | 1    | Wed     |
| 6   | PRs implementing the approved mechanical changes, each with proof                     | 1    | Wed–Thu |
| 7   | Lane 2 PRs merged, in order, plus a decisions log for the five items in §3            | 2    | Mon–Thu |
| 8   | `docs/workJournal.md` entries; the continuity page; the meter's read of the meta week | both | Thu     |

Scripts are plain Node `.mjs` with no dependencies, matching
`scripts/capability-index.mjs` and `fmt.mjs`, so they run in any checkout
without an install.

---

## 6. Success criteria

- The meter reconciles with the stats cache and reports the week's spend in
  one command.
- The census produces a costed table with at least one confirmed episode per
  class, or a documented null for that class.
- The recommendations document is approved, and every shipped change carries
  a PASS and a FAIL control in its PR.
- S1 and S2 are done by end of Tuesday or the reason they are not is written
  down.
- The meta week's own spend stays under the soft cap, and the number is in
  the journal.

---

## 7. Risks and what would make this design wrong

- **This plan's own fan-out is the pain point.** Mitigation: the caps in §4,
  pipelines over barriers, Opus for workers, Fable only for judgment. If the
  Monday evening number says otherwise, Tuesday shrinks.
- **Heuristics over-count.** A "continue" is not always post-block; a
  re-read is not always redo. Mitigation: the refuter reads the raw window
  for every counted episode, and unconfirmed candidates are reported
  separately.
- **The stats-cache unit is unknown.** If it does not reconcile with the
  transcript sums, the budget line is stated in transcript units only and
  the cache is dropped as a source.
- **Retention moves daily.** The corpus is snapshotted on Day 1 into
  `_data/` (aggregates only) so Day 2 does not re-derive against a shorter
  window.
- **The docs may not name a lever the survey claims exists.** Nothing
  UNCONFIRMED is built on; it is listed as such in `13-research.md`.
- **Operator time.** Five decisions and one console visit are yours. They
  are listed in §3 so they are asked once, not discovered mid-task.

---

## 8. Out of scope

- The personal/commercial split (settled 2026-09-12).
- Executing Phase 6, the fleet-wide staging rollout, or a second GitHub
  identity.
- Review ceremony on ordinary PRs (`07` §4.4).
- Any new alarm-filing instrument beyond the count Lane 2's S2 decision
  allows.
- Editing the evidence package's history; corrections go in new documents or
  forward pointers, per the journal rule.
