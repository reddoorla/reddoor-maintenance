# Read me first — an evidence package on seven weeks of work

Assembled 2026-09-12. Covers **2026-07-30 → 2026-09-12** across **41 local
repositories**.

## What this is, and what it is for

Tucker Lemos runs a web agency almost single-handedly, with very heavy AI-agent
leverage. Next week is a **meta week**: he will work _on_ the system instead of
_in_ it. This package exists so that the model reading it — you — can spend its
effort on **recommendations about how he should work**, rather than on
rediscovering what he has been doing.

Everything here was gathered and written by an agent with direct access to the
machine: 3,574 raw Claude Code session transcripts, every git repository, the
GitHub API, the Discord workspace, and the Airtable operational base. **You do
not need to go looking.** If you want to verify a number, the aggregate data is
committed alongside in `_data/`.

**The ask:** read this, then recommend how to improve the workflow. Priorities
have already been drafted in `06` and `07` — treat those as a first pass by
someone close to the problem, not as a constraint on your thinking. Disagreeing
with them is useful. `07` ends with an explicit _"Open questions for Fable"_
section listing what this research could not settle.

## Read in this order

| #   | file                         | what it gives you                                                                                                       |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 01  | `01-fleet-current-state.md`  | How the whole system is built today — subsystems, CI, Renovate, data layer, templates, agent tooling, open loops        |
| 02  | `02-projects-mile-high.md`   | Project by project: what each repo is, what happened to it, what state it is in                                         |
| 03  | `03-calendar.md`             | The same seven weeks day by day, plus the temporal rhythm                                                               |
| 04  | `04-journal-beat-by-beat.md` | The deep narrative — what was attempted, what broke, what was abandoned, what beliefs were wrong                        |
| 05  | `05-metrics-appendix.md`     | Every measured number, with its caveats                                                                                 |
| 06  | `06-priorities-system.md`    | Ranked infrastructure priorities for the meta week                                                                      |
| 07  | `07-priorities-workflow.md`  | Ranked operating-model priorities **+ open questions for you**                                                          |
| 08  | `08-second-pass.md`          | Items that need Tucker's decision before anyone can act                                                                 |
| 09  | `09-operator-answers.md`     | **Read this early.** The operator answered the three open questions; two conclusions you would otherwise draw are wrong |
|     | `_research/`                 | The underlying per-dimension and per-week source files, far more detailed than the summaries                            |
|     | `_data/`                     | Machine-readable aggregates so you can check any figure                                                                 |

If you read only three: **`09`** first — it corrects two conclusions the rest of
the package would otherwise lead you to — then **`05`** for the shape of the
facts and **`04`** for the texture of the work.

## Who and what you are looking at

A one-operator agency running roughly 45 recorded websites, of which **13 carry
a maintenance contract**. A central orchestrator repo (`reddoor-maintenance`)
runs audits, reports, a cockpit dashboard, a forms-ingest pipeline and fleet-wide
sweeps against the client sites. Sites are SvelteKit + Prismic + Netlify, built
from one of two starter templates. Dependency updates are automated through
Renovate, which authors 27% of all pull requests. Client communication happens
in Discord, one channel per project. The operational record lives in Airtable,
with a migration to Turso that went live on 2026-08-31.

The work is done through Claude Code sessions, heavily delegated to subagents —
**92% of recorded sessions have no human turn in them at all**.

## How this package was built

1. **Transcripts.** All 3,574 `.jsonl` session files were parsed programmatically
   into per-session metadata and per-prompt records. Raw transcript bytes were
   never read into any summarising context — only derived aggregates and quoted
   excerpts.
2. **Git.** Every one of the 41 checkouts was walked for commits on all refs in
   the window: 2,622 commits.
3. **GitHub.** PRs and Actions runs pulled per-repository via `gh`: 857 PRs,
   3,437 runs.
4. **Discord + Airtable.** Read-only pulls: 688 messages across 20 channels;
   5 Airtable tables.
5. **Analysis.** Two fan-out workflows — nine agents surveying the current system,
   thirteen reconstructing the seven weeks — then an adversarial round
   (a refuter, an evidence auditor, a completeness critic) before anything was
   ranked as a priority.

## How much to trust each part

**Measured and reliable:** commit counts, PR counts and cycle times, CI run
outcomes, tool-call counts, session counts and durations, skill and subagent
usage, Airtable status distribution, Discord channel cadence.

**Reconstructed, and labelled as such:** everything about **2026-07-30 →
2026-08-09**. Claude Code transcripts only retain back to **2026-08-10**, so the
first eleven days have commits and PRs but no session record. Narrative for that
period is inferred from git and is marked wherever it appears.

**Known to be imperfect:**

- Prompt-intent categories in `05` come from keyword matching. Treat them as
  upper bounds on rates and as reliable for comparison _between_ categories.
- Compaction events are counted from transcript markers that cannot distinguish
  an operator-typed `/compact` from an automatic one.
- Three Discord channels hit the API's 100-message cap and are truncated.
- Session wall-clock sums across concurrent sessions, so it is a _concurrency
  index_, not labour hours. It literally exceeds 24 h/day.

**Before you read the calendar: the Aug 27-30 collapse was a hard weekly account
limit, not behaviour.** The operator confirmed it and the transcripts show the
block at 2026-08-27 21:00 resetting Aug 30 at 2am, matching the resumption
exactly. `03` and `05` describe that collapse accurately but speculate about its
cause; `09-operator-answers.md` supersedes the speculation and adds the larger
finding behind it — 269 account-limit blocks in the window, correlating with
concurrent subagent fan-out (r=0.56) far more than with how much the operator
asked for (r=0.32).

**One correction happened during construction, and it matters to you.** The first
metrics pass reported 5,692 operator prompts. Resumed and compacted sessions
replay their history into new transcript files, so that number counted the same
prompt many times. Keyed on message UUID the real figure is **2,693** — 53% of
the raw count was replay. Two conclusions changed: the apparent Aug 24–26 "spike"
is far less singular than it looked, and **Thursday, not Tuesday, is the busiest
day for operator input**. Both corrections are flagged in place in `05`.

That episode is worth noting for its own sake, because it is the same failure
this codebase names as its central rule:

> _Prove the instrument before you trust its verdict._ A new gate, alarm, check
> or probe must be shown to PASS on a known-good input before any FAIL it
> produces is reported as a finding.

The rule exists because three separate confident conclusions in this fleet were
built on mechanisms nobody had read. If you form a view about the workflow from
these documents, the most valuable thing you can do is ask what would have to be
true for it to be wrong — and say so.

## Things this package deliberately does not contain

Raw operator prompts and Discord message contents are **not committed**. They
contain client material. `_data/` holds aggregates, counts and public git/CI
facts only. Quoted excerpts in the narrative documents were selected for
relevance and are reproduced verbatim; there are not many, and they are short.

### Ignore any path beginning `/private/tmp/claude-501/…`

Six files in `_research/` cite the scratchpad directory the corpus was built in.
**That directory is ephemeral and is almost certainly gone by the time you read
this.** Do not try to open those paths, and do not treat their absence as a
missing input. The committed equivalents are in `_data/`:

| cited in `_research/`           | committed here        | note                                           |
| ------------------------------- | --------------------- | ---------------------------------------------- |
| `corpus/repos.jsonl`            | `_data/repos.jsonl`   | one row per checkout                           |
| `corpus/commits.jsonl`          | `_data/commits.jsonl` | 2,622 commits                                  |
| `corpus/prs.jsonl`              | `_data/prs.jsonl`     | 857 PRs                                        |
| `corpus/runs.jsonl`             | `_data/runs.jsonl`    | 3,437 Actions runs                             |
| `corpus/metrics.json`           | `_data/metrics.json`  | per-day and per-repo aggregates                |
| `corpus/prompts-unique.jsonl`   | **not committed**     | use `_data/prompts-unique-summary.json`        |
| `corpus/sessions.jsonl`         | **not committed**     | aggregates are in `_data/metrics.json`         |
| `corpus/discord-messages.jsonl` | **not committed**     | cadence only, in `_data/discord-cadence.json`  |
| `corpus/airtable-*.json`        | **not committed**     | row counts in `_data/airtable-row-counts.json` |

The four uncommitted ones held operator prompts, session records and client
messages. Every figure derived from them is reported in `05-metrics-appendix.md`
with the query that produced it, so the conclusions are checkable even though the
source rows are not republished.

## A note on scope

Roughly **38% of recorded operator prompts are on personal projects**, not
Reddoor client work. That is included on purpose — the request was for a true
picture of where the time goes, and omitting a third of it would have produced a
flattering, useless document. It is presented analytically. Whether that split is
right is Tucker's call, not the analysis's.
