# Model bake-off

This directory measures which model and effort can do a recurring task as well as the gold
standard, and what each run costs. The method, the routing table and every result live in
[reddoorla/reddoor-workspace#1](https://github.com/reddoorla/reddoor-workspace/issues/1). The
30-day spend ledger that motivated it is
[reddoorla/reddoor-workspace#2](https://github.com/reddoorla/reddoor-workspace/issues/2).

| File                                          | What it does                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bakeoff.mjs`                                 | `prepare` freezes a task's inputs, `collect` reads the run's transcripts, `score` scores and reports                                       |
| `.claude/workflows/model-bakeoff.workflow.js` | Runs the gold and every arm on one prompt and schema (`mode: "extract"`), or the referee (`mode: "referee"`), each as `bakeoff-readonly`   |
| `ledger.mjs`                                  | Token and cost ledger over Claude Code transcripts, by `message.model` and `effort`                                                        |
| `lib/arms.mjs`                                | Arm validation and the agents' rules; the workflow carries a copy identical apart from `export` (tested)                                   |
| `lib/score.mjs`                               | Deterministic normalisation and scoring, disagreement grouping, rulings                                                                    |
| `lib/ledger.mjs`                              | Dedup by `message.id`, LF-only line splitting, the price list, the long-prompt card                                                        |
| `lib/transcripts.mjs`                         | Reads one subagent transcript: its marker, what ran, its structured output, its writes, tools outside the allowlist and forbidden commands |
| `tasks/*.mjs`                                 | One file per task type; `t4-plan-task` edits a repository and is scored on the tree it leaves                                              |
| `tasks/seeded-review/`                        | `key.json` (the seeded defects and controls), `build.mjs` (rebuilds `cases/` from git), `cases/` (frozen diffs and files)                  |
| `results/*.json`                              | One file per measured run, copied by hand from `<run>`: scores, what ran, cost per arm, rulings                                            |

## The recipe

These are workspace#1's nine steps, with where each one happens.

1. **Freeze the input.** `prepare` copies the task's sources into `<run>/input`, sets every file
   to mode 444 and every directory to 555, and records a manifest of each file's mode and sha256
   and the mode of the folder and each directory in it. A cloud container runs as root, so the
   permission bits alone do not stop a write. `score` therefore re-reads the folder and reports
   any change as a problem. Each agent also gets its own scratch directory, `<run>/work/<id>`,
   and is told to write nowhere else. On 2026-10-19 the first row-4 run gave no such directory,
   and all four Haiku runs wrote the same `census/census.py` at once, so one ran another's script. `score` now reports any
   Write or Edit outside an agent's own directory. It cannot see a Bash redirect.
2. **One prompt, one schema.** The task file supplies both. Every arm gets the same text. Only the
   gold run gets the task's `goldAddendum` on top.
3. **Build the gold mechanically.** The gold runs on Opus at `high` and is told to verify every
   field with scripts. When the task can compute its own truth (`truth(dir)`), the arms are scored
   against that truth, and so is the gold, which verifies the gold by script. When it cannot, the
   arms are scored against the gold's output.
4. **Arms.** Run at least two of each cheap arm. Every arm names a `model` and an `effort`, and
   both `validateRun` and the workflow refuse one without an `effort`, because an arm with none
   inherits the session's effort (`xhigh` on the operator's laptop). "The default effort" means
   the model's documented default, written out: Haiku 5.5 and Opus 5.5 default to `medium`.
5. **Score deterministically**, with the normalisation below.
6. **Referee every disagreement.** `score` groups the distinct arm-versus-reference
   disagreements and writes `<run>.referee-args.json`, numbered as the next referee round. Run the
   workflow with it, `collect` again, and `score` again. Rulings from every round are kept. A
   ruling can credit an arm, and can refute the reference. An arm that agreed with a refuted
   reference loses that check. A value the arm left out is never credited.
7. **Check what actually ran.** `collect` reads `message.model` and the per-line `effort` field
   from each subagent transcript, and the agent type from the `.meta.json` beside it. `score`
   lists every arm and every referee whose transcripts disagree with what it asked for, or that
   did not run as `bakeoff-readonly`.
8. **Cost from usage, counted once per `message.id`.** Transcript lines repeat a message's
   usage, so summing every line roughly doubles the count. A request whose last line has no
   `stop_reason` kept only its stream-start usage, so its output tokens (thinking included)
   are undercounted; every cost that counts one prints as a lower bound,
   `≥$x (n of m unfinished)` (#1435). The figure is still the transcripts'; a true one needs
   a source that carries final usage, such as OpenTelemetry `claude_code.api_request` events.
9. **Report the ceiling.** If every arm scores perfectly, the run bounds the error rate. It does
   not rank the models.

## Running a task

The `/bakeoff <task id>` skill in
[reddoorla/claude-skills](https://github.com/reddoorla/claude-skills/tree/main/skills/bakeoff) runs
the steps below for you. It refuses arms without an explicit effort, proves the scorer first, loops
the referee rounds, prices the run with `ledger.mjs`, and drafts the workspace#1 comment without
posting it. By hand:

```sh
node scripts/model-bakeoff/bakeoff.mjs prepare --task t5-census --out <run>
```

`prepare` writes the task's truth (or `null`) to `<run>.truth.json`, beside the run directory
and never inside it: the arms are told `<run>/input` and `<run>/work/<id>`, so a `cat <run>/*.json`
or a Grep over the run does not reach the truth file (#1492). `score` reads it there, and refuses
a run prepared before the move, whose `truth.json` is still inside it. Copy or move the two
together. A file outside the run is still readable by an arm that goes looking; for a task that
lists it in `secrets` (below; refute-repo does), `score` reports a read that names it. For the
same reason `collect` writes the agents it read to `<run>.runs.json`, and `score` writes the
referee's args to `<run>.referee-args.json` and its result to `<run>.result.json`, all beside the
run: they hold the gold's output, every disagreement's REFERENCE value, and each arm's errors with
the expected value, which an arm launched after a `collect` or an interim `score` (the per-arm
`only` flow) could otherwise read (#1540). Both steps refuse a run that still holds `runs.json`,
`referee-args.json` or `result.json` inside it; move or delete it first. `prepare` refuses an
`--out` that any of these sibling files already sits beside.

Then run the workflow with `<run>/workflow-args.json` as its `args`. The Workflow tool takes
`scriptPath: ".claude/workflows/model-bakeoff.workflow.js"`, and its launch message names the
transcript directory: `~/.claude/projects/<project>/<session>/subagents/workflows/<run id>/`.

```sh
node scripts/model-bakeoff/bakeoff.mjs collect --run <run> --transcripts <transcript dir>
node scripts/model-bakeoff/bakeoff.mjs score --run <run>
```

If `score` reports unruled disagreements, run the workflow again with `<run>.referee-args.json`,
then `collect` (with that run's transcript directory) and `score` again.

`collect` refuses, and writes nothing, when:

- two transcripts claim the same marker;
- a transcript's marker names no arm of this run;
- a prompt does not name this run's input folder and that agent's work dir, which catches a
  transcript directory from another run passed by mistake;
- a prompt holds a marker but not exactly one, at its end (a prompt with no marker is skipped);
- a referee marker is not `r<round>-<chunk>`.

`score` exits non-zero on any of these problems, and `<run>.result.json` holds the full result:

- `args.dir` is not `<run>/input`, or the input changed;
- the reference lists one item twice (the first entry is used), or has an item with no key (it
  is not scored);
- an arm or the gold has no transcript, or no accepted structured output;
- an arm, the gold or a referee ran on a model or effort it did not ask for;
- a disagreement is still unruled, or a referee chunk returned nothing while one is;
- the referee's rulings disagree about whether the reference is right on one check, or a
  `(present)` or `(extra)` ruling calls both sides right or both wrong;
- the referee ruled an extra item real, so the reference is missing it and that item's field
  values went unscored: fix the reference (the truth function, or a gold that missed it) and
  score again;
- an agent ran as an agent type other than `bakeoff-readonly`, or has none recorded because its
  `.meta.json` is missing, unreadable or names none (below, "The agent type");
- an agent wrote outside its own directory (paths resolved; a relative path counts as outside),
  used a tool outside the allowlist (`Read`, `Bash`, `Glob`, `Grep`, `Write`, `Edit`,
  `NotebookEdit`, `StructuredOutput`, `ToolSearch`: the agent type's six tools, the
  `StructuredOutput` its schema adds, and `NotebookEdit` and `ToolSearch` kept from before it),
  or ran a forbidden Bash command.

It also exits non-zero when there is no reference at all: no truth, and no gold output.

The Bash check finds the command word of every simple command and judges that word alone. It
sets heredoc bodies aside and drops `#` comments, then reads the command with a small
quote-aware lexer: a quoted string becomes one token holding its text (`"gh"` is `gh`,
`-X 'POST'` is `POST`), and segments end at newlines, `;`, `&&`, `||`, `|`, `&`, `$(`, backticks,
parentheses and braces outside quotes. In each segment it skips redirections, shell keywords
(`do`, `then`, `if`, `!`, `time` and the like), variable assignments, `command`/`exec`/`builtin`
with their options, and wrappers (`sudo`, `nohup`, `stdbuf`, `nice`, `timeout`, `xargs`, `env`)
with their options, skipping a value only after the options that take one (`xargs -n 1`,
`sudo -u bob`, `timeout -s KILL 5`). The command word is then forbidden when it is:

- `gh`;
- `git` with a subcommand that writes, after any global options: `push`, `pull`, `commit`, `rm`,
  `add`, `merge`, `rebase`, `reset`, `init` and the like, but not the read forms `tag -l`,
  `stash list`, `apply --stat`, `config --get`, `worktree list`, `branch -a` or `--help`;
- `curl` with a write method (`-X POST` in any case, inside a cluster such as `-sX PUT`, or
  `--request`), `--form`, `--json`, `--upload-file`, `-F` or `-T`, whatever else is set; or with
  `--data` or `-d` unless `-G`/`--get` (alone or in a cluster such as `-sG`) makes that a GET.

It repeats the check on every `$(…)` and backtick body, inside double quotes too; on the body of
`sh -c`, `bash -c` (options such as `-euo pipefail` allowed before `-c`) or `eval` when that is the
command; and on a heredoc body fed to a shell (`sh <<EOF`, `cat <<EOF | bash`). So
`grep -n curl f | cut -d: -f1`, `echo "$f $(grep -c x "$f")"` and a heredoc written to a file that
mentions `gh api` pass, and so do lookups such as `which gh` and `command -v gh`, which run
nothing. `for r in a; do gh api $r; done` and `a="$(gh api x)"` fail. Not seen: commands run
inside another interpreter (`node -e`, `python3 -c`, `python3 - <<EOF`), a resolved path such as
`$(which gh) api`, text piped into a shell's stdin (`echo 'git push' | sh`), substitutions inside
an unquoted heredoc body, and `find -exec`. It is a tripwire, not a sandbox.

The check is frozen as it is (Operator decisions 133). Nothing blocks a command during the run;
a flagged one faults the arm in `score`. Seven review rounds of hardening (#1444, closed
unmerged) kept finding forms it missed, and these are known and stay as they are:

- flagged though read-only: `git tag --merged HEAD`, `git tag -n5 'v1.*'`, `git tag -v v1.0`,
  `git config -f .gitmodules submodule.foo.path`, `git clean -n`, `git rm --dry-run`, a read
  with a redirect such as `git config user.email 2>/dev/null`, and a heredoc body line ending in
  `\`, as in `cat <<EOF⏎x \⏎EOF⏎gh pr create⏎EOF`, where bash joins `x \` with the first `EOF`,
  so `gh pr create` is heredoc text and never runs (#1419, #1456);
- local git writes not flagged: `git remote add`, `git config --unset`, `git notes add`,
  `git submodule update`, `git branch --no-color newb` (#1419);
- not seen: an `echo` inside a group or loop piped into a shell (`{ echo 'git push'; } | sh`,
  `for …; do echo …; done | sh`, `echo … | cat | sh`), an `echo` whose arguments hold a `$(…)` or
  backtick piped into a shell (#1438, #1456), and a redirect where the lexer does not strip one:
  `>| out git push`, `<<< x git push`, `{fd}>` after the command name, `<>`,
  inside `find -exec`, and among wrapper options (`timeout 2>/dev/null 5 git push`) (#1486);
- `curl -X $M`, `wget --post-data`, and the forms in the paragraph above (#1419).

`--arms <file>` on `prepare` replaces the task's default arms with a JSON array.

`figma-inventory` (row 2) reads Figma connector output that is not in this repo. The output is
a client's design, and the repo is public. Its `--root` is a folder holding one
`metadata-<node>.json` and one `design-context-<node>.json` per page frame. Each file is the
connector's own response, `{ tool, input, fetchedAt, text }`, copied byte for byte out of the
session transcript that called `get_metadata` and `get_design_context`, so no arm ever calls
Figma. The truth parses both files and refuses a page whose top-level children differ between
the two tools. Drop any `text` entry that Claude Code added rather than the connector, such as
the `[OUTPUT TRUNCATED]` note it appends when a response is too long to show in full; the note
would tell the arms that the data is incomplete when it is not.

The truth refuses what it cannot read rather than guess. It refuses:

- a JSX expression other than a plain string or template literal, and a literal with `${…}` or
  an escape in it;
- a capitalised tag it found no `function` for;
- an `<img>` whose `src` is not an asset constant;
- an `href={…}` expression;
- an unknown entity;
- a metadata tag it cannot parse;
- a field or slice id rendered more than once, on one page or across pages, which the prompt
  does not say how to list.

## The agent type

Every arm, the gold and every referee runs as `.claude/agents/bakeoff-readonly.md` (Operator
decisions 133). Its `tools` are Read, Grep, Glob, Bash, Write and Edit, so it has no MCP, web or
agent tools (the sub-agents docs make `tools` an allowlist, and the probe found no ToolSearch);
a workflow `agent()` without an agent type has all of them, and the one read-only rule a real
run broke was an MCP call (`refute-repo`, 2026-10-19). It keeps Bash because the gold and the
referee verify with scripts and `pnpm-update` and `t4-plan-task` run pnpm.

It cannot deny `gh`, `git push` or `curl` inside Bash. A `disallowedTools` entry with a
specifier, such as `Bash(gh *)`, removes the whole Bash tool, in the agent file and in a
workflow `agent()`'s own `disallowedTools` alike. On 2026-10-20 an arm of this type with
`Bash(gh *)` in its file reported that it had no Bash tool, a probe agent of it was answered
`No such tool available: Bash`, and the Claude Code sub-agents docs say the same. A settings deny
rule does bind a subagent, but it applies to the whole session. So Bash commands are still only
read after the run, by the Bash check in "Running a task".

`score` holds every agent to the type. `collect` reads the agent type from the
`agent-<id>.meta.json` the harness writes beside each transcript, and `score` reports an agent
that ran as anything else, or whose file is missing, unreadable or names no type. A `runs.json`
collected before 2026-10-20 has no type at all: collect it again, and a run launched before then
will show as the default agent, which only a new launch clears. A launcher that `split` wrote
before then embeds the old workflow and runs the default agent, so split again.

The type resolves from the agent registry the session read when it started, so run the
workflow from a session started in this repo. A session started elsewhere (the workspace, by
default) does not have it after `add_repo` and `register_repo_root`. There every `agent()`
throws `agent type 'bakeoff-readonly' not found` before any agent runs (measured), so the run
returns no transcripts, and `score` reports each one missing, or refuses for want of a
reference when the gold is the reference.

Results from before 2026-10-20 were measured with the default workflow agent, which had every
tool and a different system prompt. Production fan-outs, such as
`.claude/workflows/refute-claims.workflow.js`, still launch the default agent, so a result
measured under the type is a result for the type.

## Item tasks: one agent per item

A task that exports `items(dir)` (an array of `{ id, prompt, schema }`) and
`assemble(outputs, dir)` runs as production fans out: one agent per arm and item, not one
agent per arm. `prepare` puts the items in `workflow-args.json`; the workflow marks each prompt
`(BAKEOFF-ARM: <arm> ITEM: <item>)` and gives it the work dir `<work>/<arm>/<item>`. `collect`
keys each transcript `<arm>/<item>` and refuses an item that is not in the run, or an arm
marker without one. `score` checks each item agent on its own (model, effort, agent type, output, writes),
reports a missing item, and then scores the arm on `assemble` of the outputs it has, with cost
and requests summed over its items. `task.prompt(dir)` is then what the referee is shown as
the task.

`args.only` (a list of arm ids, `gold` included) runs a subset of the arms. A workflow runs at
most `min(16, CPUs - 2)` agents at once, two in a 4-CPU cloud container, so a large item run is
launched as one workflow per arm with `only`, and `collect` is run once per transcript
directory: it merges into the run's `<run>.runs.json`.

A task may also export `secrets` (strings, such as its answer key's file name): `score` reports
any agent whose Bash commands or Read, Grep or Glob inputs name one. It sees names only: a glob
or a directory-wide Grep that reaches the file gets past it. And `decision(records,
dir, ctx)`, whose `lines` `score` prints under the table. `ctx` holds the run's `arms` (gold
first), the arm ids `score` found a problem in (`invalid`), the referee's `referenceErrors`, the
`unruled` count, `blockers` (problems that are no one arm's, such as a changed input), and the
raw `checksByArm` and the referee's `rulings`, so a decision can say where it parts from the
score column.

### `refute-repo` (row 5, second control)

The `refute-claims` skeptics on 36 claims about six repo files pinned at one commit of main
(`tasks/refute-repo.data.json`): 18 false, 16 true documentary claims and 2 behaviour claims
labelled `untested`. The false ones include dropped conditions, wrong defaults and a field given
to the wrong event, hook or list. Every label names the line that decides it, and the test
checks that line's text at the pin with `git show`, so the evidence can always be re-fetched.
Each arm gets the production `refutePrompt` and per-kind `verdictSchema`, and its verdicts go
through `enforceQuoteRule` as the workflow records them.

```sh
git worktree add --detach <scratch>/pin "$(node -p "require('./scripts/model-bakeoff/tasks/refute-repo.data.json').pin")"
node scripts/model-bakeoff/bakeoff.mjs prepare --task refute-repo --root <scratch>/pin --out <run>
```

The decision rule is `TOLERANCE` in the task file, committed before the first run. A run passes
with at most 1 false claim missed, 1 true claim refuted, 2 true documentary claims unconfirmed,
and both `untested` labels returned. A config pools its two runs; it qualifies to replace
production (Opus at `xhigh`) only if both runs pass and its pooled errors and misses are within
2 and 1 of production's. The control may rank only when production passes both runs, the
referee upholds every label it rules on, no disagreement is unruled, `score` found no problem
outside one arm, and pooled errors spread by at least 3 across the configs with two runs and no
faulted run.

The rule counts against the key, as registered, but the score column applies the referee's
rulings. So a ruling that credits a run (an "unclear" ruled fine against a "confirmed" label)
shows there as correct and in the decision as an error, and can fail the run next to a perfect
score. The decision prints a line naming every check where that happened ("Referee rulings this
rule does not apply …", or "none"), and `<run>.result.json` keeps them as `decision.rulingChanges`
(#1493). A ruling that refutes the key is already a reason the control may not rank.

The 2026-10-19 run (`results/2026-10-19-refute-repo.json`) saturated. Production passed both
runs at 36/36, and so did every other run but two: Sonnet `medium` run 2 confirmed r33, though
its own reason said the order was the opposite, and a Haiku skeptic made one MCP call it was told
not to make. Pooled errors spread by 1, so the rule does not rank the arms. About 80% of an Opus
run's cost is each fresh skeptic's cache write, so effort barely moves the cost and the model does.

## Scoring

Each field has a kind. The kinds apply these rules before comparing:

| Rule          | What it does                                             | Kinds                                       |
| ------------- | -------------------------------------------------------- | ------------------------------------------- |
| `dashes`      | U+2010 to U+2015 and U+2212 become `-`                   | `string`, `text`, `name`                    |
| `whitespace`  | Runs of whitespace become one space; ends trimmed        | `string`, `number`, `boolean`, `file`       |
| `casefold`    | Lower case                                               | `string`, `text`, `name`, `file`, `boolean` |
| `punctuation` | Everything but `a-z` and `0-9` removed                   | `text`, `name`                              |
| `titlePrefix` | A leading Det., Detective, Dr., Mr., Mrs. or Ms. removed | `name`                                      |
| sets          | Order ignored; duplicates and empty members dropped      | `set:<kind>`                                |

`number` takes a number, or a string of decimal digits with an optional minus sign, fraction and
exponent. A blank, a null, `+5` and `0x10` are not numbers. `boolean` takes `true` and `false`,
or those words. `file` keys an item by its base name, so `workflows/ci.yml` and `CI.yml` are the
same item.

Each reference item gets a `(present)` check, so an item the arm left out goes to the referee like
any other disagreement. If the referee rules that the reference item does not exist, that item's
field checks are dropped for every arm, and an arm that listed it loses its `(present)` check.
Every item that some arm listed and the reference lacks gets an `(extra)` check, and every arm
gets that check, whether it listed the item or not, so all arms share one denominator. The
referee rules on each extra item once. If it rules that the item really exists, the arms that
left it out fail that check, and `score` reports the item as a problem, because the reference
lacks it and its field values are not scored until the reference is fixed. An extra check is
named by the item's normalised key, so adding or reordering arms keeps its rulings, and the
referee is shown each arm's own spelling. Each collection also gets a `(well-formed)` check per
arm: no item listed twice, no item without a key, and an output at all. These are mechanical
faults, so they never go to the referee, and where an item appears twice the first entry is the
one scored. An arm that returned no output fails every check mechanically, without a referee
round. The 2026-10-19 t5-census run had
no extra items, so each run had 228 checks: 188 fields, 38 `(present)` and 2 `(well-formed)`.

## Adding a task type

Add `tasks/<id>.mjs` exporting:

- `id`, used in the run's files. `title` and `row` (the row of workspace#1's "What to test next"
  table) are for people; the code does not read them.
- `sources`: an array of `{ from, match, to }`. Each copies the files directly in `from`, not its
  subdirectories, whose names pass the RegExp `match`, into `input/<to>`. `from` is relative to
  the repo root, or to `--root`.
- `prompt(dir)` and `goldAddendum`.
- `schema`: the JSON schema for the structured output.
- `collections`: `[{ name, key, keyKind, fields: { field: kind } }]`. These are the arrays to
  score, the field that identifies an item, and each field's kind.
- `kinds`: optional, `{ name: (value) => comparable }`. Each one adds a field kind for this task,
  for instance a rounding tolerance, and works inside `set:` too.
- `observe(work, structured, agent, reference)`: optional. When a task is an action rather than an extraction,
  `score` scores what this returns for each agent instead of its structured output. It gets the
  agent's work dir, its structured output (or `null`), its collected transcript (`bash`, `writes`
  and the rest) and the reference, so it can read what the agent left on disk and what it ran. Return `null` for an
  agent with no output. A task with `observe` must have a `truth`. A collection marked
  `mechanical: true` never goes to the referee; use it for values a referee shown only the prompt
  could not settle.
- `truth(dir)`: optional, the script-computed reference. Leave it out when no script can compute
  the answer, and the gold run becomes the reference.
- `arms`: an array of `{ id, model, effort }`, the cheap arms. No arm id may be `gold` or start
  with `referee`. `--arms` on `prepare` replaces this list only.
- `gold`: one `{ id: "gold", model, effort }`, exported on its own.
- `scoreRun`, `referenceFaults`, `extraCandidates`: optional, each replacing the function of that
  name in `lib/score.mjs` for this task. A task whose metric is not field equality, such as
  `seeded-review`'s recall of seeded defects, returns checks in the same shape, so the referee,
  `groupDisagreements` and `finalScores` work unchanged.
- `summarize({ reference, checksByArm, rulings, outputs, arms })` and `formatSummary(summary)`:
  optional. `arms` is every arm `score` should have scored (the gold too when a truth exists),
  so a task can count an arm with no transcript (which `checksByArm` leaves out) instead of
  judging its group without it. `score` stores the summary in `<run>.result.json` as `summary` and
  prints it under the table.

Arms run in the repository checkout, and the Bash check reports writes, not reads. A task built from
this repository's own history, as `seeded-review` is, can be answered by `git log -S` on a line
from its input, or by reading the task's key. The prompt forbids it; after the run, search every arm
transcript for a git command and for a read outside `<run>/input`, and record the result. The
2026-10-19 seeded-review run found none in any of its 11 arm transcripts.

### `seeded-review` (row 3)

A finding in a seeded case is a candidate for a seeded defect when it names the defect's file
and its range overlaps the defect's or comes within `NEAR_LINES` (10) of it, and the referee
rules on every candidate. A finding near two seeded defects (r07's d5 and d6 are 8 lines apart)
is a candidate for both and can count for both, but each defect's referee item names the other
one and says to credit the finding only if it identifies this defect: a finding that names both
bugs, as three did on 2026-10-19, is credited for both (Operator decisions 137 (k), answered (b);
#1465). On a clean control, findings are grouped by file (the control's own
file under any path form, `src/x.ts`, `r02.after.x.ts` or `./x.ts`), and findings that all share
a line are one false positive: one finding restated three ways is one, not three (#1462). A
chain of ranges (1-3, 3-5, 5-7) or one wide range does not merge findings that never meet. The
referee sees every wording of a merged finding, sorted, so the same findings in another order
make the same check.

`build.mjs` rebuilds `cases/` from git byte for byte, and a test holds it to the committed
files. No user, system or environment git config reaches it, and from git 2.40 the checkout's
own `.gitattributes` does not either (`GIT_ATTR_SOURCE` is the empty tree). One input still
does: `$GIT_DIR/info/attributes`, which nothing turns off (checked with git 2.43). A local
entry there such as `*.ts -diff` changes all 11 rebuilt diffs (measured 2026-10-20 in a fresh
clone, which rebuilt 0 of 22 files differently without it) and turns the byte-for-byte test
red. That is accepted (#1464): no clone of this repo has one unless someone adds it by hand.

### A task that changes a repository

Some tasks are not extractions: the agent edits code, and what counts is the tree it leaves, not
what it reports. `tasks/t4-plan-task.mjs` (workspace#1 row 1) is the worked example, with
`observe` (above) to read the tree, plus these:

- `setup({ input, work, ids, root })` runs in `prepare` after the sources are copied and before
  the input is frozen. `root` is `--root` when it is given. t4 writes the plan into the input and
  gives every agent the pinned tree in `<work>/<id>/repo`, as a one-commit repository installed
  offline, so the commit that implemented the task is not in its history. The agents need Write
  and Edit there, which the existing rules already allow: their work dir is theirs, and `score`
  still reports a Write or Edit anywhere else. It does not see a Bash write, or anything the
  agent's own code does when it runs its tests, so an agent can write outside its work dir
  unreported.
- t4's `observe` runs the gates (below), about two minutes an agent, and caches each result in
  `<run>/evaluated.json` under a key: a hash of the task module, the agent's transcript path and
  its structured output. An agent with no output yet (still running) is evaluated but never
  cached, and a change to the module or the output evaluates again (#1500). A failure is cached
  like any result, so delete that file (or its `<id>` entry) to evaluate again, for example after
  a gate timed out. An agent that ended with no output is evaluated afresh on every `score`.
- t4 marks only its `gates` collection `mechanical`: an exit code has nothing for a referee to read.
- An item with `mechanical: true` in `observe`'s output makes that item's field checks mechanical
  too (an agent's own report cannot do this); t4 marks a held-out
  test that never ran (a crash, a missing export), which has no failure for a referee to read.
- `refFixed: true` on a collection says its reference is right by construction: a ruling can credit
  an arm that differs, but its `refCorrect: false` on a field check refutes nothing, so the arms that matched the
  reference keep that check and no contradiction is reported. `score` still lists each such ruling
  under `referenceDisputes` in the result, and prints it under the table, so a reader sees that the
  referee disagreed. t4's held-out tests are `refFixed`, since passing the plan's own test is never
  wrong.

t4's gates never touch an agent's tree. `score` builds `<run>/eval/<id>/tree` from the pinned
commit and copies in only the files the plan names, so a change the agent leaves anywhere else (a
`package.json` script, a config) can fail scope but does not reach a gate. That is a tripwire, not
a sandbox: the gates execute the agent's code, which can write anywhere the scorer can (another
agent's tree, `~`), and its `hoverActivate.ts` runs in the held-out run itself. Running each agent
and each gate in its own namespace would close that; until then, read the plan's files of every
agent for `node:fs`, `child_process`, `process` and patches to vitest before reporting a run. It runs `pnpm check`, `pnpm lint` and the
agent's own `vitest run` there, with no secrets in the environment. Every install and gate pnpm
reads an empty config directory made for that one step, instead of the caller's `~/.npmrc`, pnpm
`rc` or `config.yaml`, which an agent can write: a `global-pnpmfile` or `script-shell` named there would
otherwise run inside the scorer. The pin is archived from a bare repository the scorer fetches it
into, not from the `--root` clone, whose own filter drivers `git archive` would apply. Then the plan's own test file, taken
from the implementing commit, replaces the agent's version and runs alone, in a second tree
(`eval/<id>/held`) built before any of the agent's code ran. Each of its tests is a
`(present)` check and a `result` check, so a run has 32 checks: 10 tests and 5 gates, two checks
each, and 2 `(well-formed)`. The fifth gate, `own-tests`, runs the agent's own test file in
`tree`; the plan's version runs only in `held`. The plan asks for its tests, so the file must exist
and run, vitest must exit 0, and the report must show a test passing and none failing (a `todo` test is neither). A step that times out (15 minutes) fails its gate; only a missing binary or a failed
install, which are the harness's, stops `score`. A held-out test can fail on a detail the plan leaves open (run 1: a
synthetic `pointerleave` with no `pointerType`), so a failed `result` goes to the referee with the
failure's first line and the paths of the agent's code and of the test as run. Each arm's failure
is its own disagreement, because the referee has to read that arm's code. The scope gate passes when the files that differ from the pinned commit are a
non-empty subset of the files the plan names. They are found by `git status` with the scorer's own
repository of the pin as `--git-dir` and the agent's tree as `--work-tree`, never with the agent's
`.git`: its config could name an `fsmonitor` to run, and its index could hide a change. A file the
tree's own ignore rules hide still counts unless the pin's rules ignore it too, so a new
`sub/.gitignore` holding `*` cannot hide itself or a stray file beside it.

Every install, the agents' and the scorer's, copies packages out of the pnpm store
(`package-import-method=copy`). pnpm's default hardlinks every `node_modules` file to one store
inode, so an agent writing inside its `node_modules` would change every other agent's tree too.
Reads are not tracked: an agent could read the `--root` clone or an earlier run's `eval` directory,
where the plan's test sits. Audit the transcripts for those paths before reporting a run.

Prove the instrument before trusting it. Score the truth against itself, which must be perfect.
Then score a perturbed copy, which must fail exactly where it was changed. That proves the scorer,
not the truth. The 2026-10-19 row-4 run did both before the first arm ran, and the referee still
found the truth wrong on one check: the script missed a bare `"node:"` literal that eight of nine
runs had found.

## The `pnpm-update` task (row 6)

The input is two tarballs, not a folder of sources, because `sources` copies flat files only. Build
them first, then prepare from them:

```sh
node scripts/model-bakeoff/tasks/pnpm-update.mjs snapshot --repo <checkout> --commit <sha> --out <snap>
node scripts/model-bakeoff/bakeoff.mjs prepare --task pnpm-update --root <snap> --out <run>
```

`repo.tar` is `git archive` of the commit. `registry.tar` is the pnpm metadata cache
(`XDG_CACHE_HOME`) after one online `pnpm update --lockfile-only`; the snapshot also installs the
result once, so this machine's shared store holds every tarball. `snapshot.json` records the commit
sha and the minute, and is frozen with the tarballs. Every agent and the truth then run
`pnpm update --offline` against their own copy of that cache, so the registry is frozen at that
minute. With an empty cache the offline update fails, which is the negative control. The offline
runs still need the shared store and pnpm itself (the `packageManager` version) in place, so take
the snapshot in the session that runs the arms.

`prepare` computes the truth by running the same steps, about 90 seconds, and keeps their logs in
the temp dir it prints. A command killed by the timeout stops `prepare` instead of counting as a
failed check. What is scored, all of it mechanical (no referee):

- `packages`: the direct dependencies the agent reported, each specifier and version;
- `disk`: the agent's own `<work>/repo/pnpm-lock.yaml`, as two sets: its direct dependencies and
  every package key. pnpm 12 writes the lockfile as two YAML documents; the project is the last;
- `checks`: one item per script (`lint`, `check`, `build`, `test:unit`), with two scored fields.
  `reportsOwnRun`: whether the verdict the agent claimed is the one its own run's exit code gives.
  `noFalsePass`: whether it did not claim a pass for a script the truth says fails. The second is
  one-sided because load on a shared machine can make a passing script fail (a timeout) but never
  make a failing one pass. The prompt has each script write `<work>/logs/<script>.log` and
  `<work>/logs/<script>.exit`. A log counts only when pnpm wrote it (it holds pnpm's
  `$ <script body>` line) after the lockfile it ran against. A log with no exit file counts as a failed
  run, and so do an exit file that holds no single integer (empty, or two lines from an append),
  an exit file older than its log and an exit code of 0 beside a log in which pnpm
  reports the command failed. `00` and `-0` read as 0. A
  script with no such log fails as absent. The run's own verdict (`exitFailed`) is kept on the
  item but not scored. A headline `checks.pass: true` is read as claiming every script passed,
  whatever `failed` lists; `unverified` is not scored. An earlier draft inferred "ran" from the transcript's command text, which
  credited scripts that were only mentioned and missed `pnpm -C`, `xargs` and nested loops.

The truth runs alone during `prepare`, so its verdicts are uncontended (the workflow runs the
agents concurrently; on 2026-10-19 they started in pairs about three minutes apart on 4 cores), and its offline install
is the proof that the shared store held every tarball. `snapshot.json` records the pnpm version
and store path. The truth's files (`<run>.truth.json` beside the run, its temp dir) are still
readable by an agent that goes looking, as in every task; `collect` lists each agent's Bash
commands, so check them for a read of either.

`<run>.result.json` gives each arm a `byCollection` score (`correct/total` per collection) beside the
total, because 104 of this task's 117 checks (packages and disk) follow from the one `pnpm update`.

## The ledger

```sh
node scripts/model-bakeoff/ledger.mjs [--root <dir>] [--since <ISO date>] [--until <ISO date>] [--json <file>]
```

It reads `~/.claude/projects` by default, or `LEDGER_ROOT`, or `--root`. `--since` and `--until`
select files by modification time, as #2 did, not by message timestamp. It sorts each file into
main session, plain subagent or workflow subagent by its path, as #2 did, and prints how many
files fit none of the three. It keeps the last line for each `message.id` within a file, then
keeps one record per `message.id` across files, and reports both repeat counts.

A cost that counts a request with no `stop_reason` on its last line prints as
`≥$x (n of m unfinished)`, with a note under the table: that request's transcript kept only its
stream-start usage (#1435, recipe step 8).

Prices come from `PRICES` in `lib/ledger.mjs`, confirmed on 2026-10-19 against the claude-api
skill's price list (cached 2026-10-06). Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 are listed.
Any other model is reported as unpriced, never estimated.

**Cache writes are priced by TTL, which #2's `ledger.js` did not do.** Usage splits
`cache_creation_input_tokens` into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`.
A 5-minute write costs 1.25x input and a 1-hour write costs 2x. #2 priced every write at 1.25x,
but this session's own transcripts write 1-hour entries, so #2's cache-write cost is low by up to
1.6x on those tokens. Any part of a write with no split is priced at the 5-minute rate, and
counted as `ttlUnknown` in the `--json` output.

Haiku's long-prompt card confirms what #2 assumed. Above 100K prompt tokens (input plus cache read
plus cache write), Haiku 5.5 bills $0.50 / $2.50 input / output, cache reads at 0.1x and writes at
1.25x / 2x: 5x on every class.
