# Model bake-off

This directory measures which model and effort can do a recurring task as well as the gold
standard, and what each run costs. The method, the routing table and every result live in
[reddoorla/reddoor-workspace#1](https://github.com/reddoorla/reddoor-workspace/issues/1). The
30-day spend ledger that motivated it is
[reddoorla/reddoor-workspace#2](https://github.com/reddoorla/reddoor-workspace/issues/2).

| File                                          | What it does                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bakeoff.mjs`                                 | `prepare` freezes a task's inputs, `collect` reads the run's transcripts, `score` scores and reports                                       |
| `.claude/workflows/model-bakeoff.workflow.js` | Runs the gold and every arm on one prompt and schema (`mode: "extract"`), or the referee (`mode: "referee"`)                               |
| `ledger.mjs`                                  | Token and cost ledger over Claude Code transcripts, by `message.model` and `effort`                                                        |
| `lib/arms.mjs`                                | Arm validation and the agents' rules; the workflow carries a copy identical apart from `export` (tested)                                   |
| `lib/score.mjs`                               | Deterministic normalisation and scoring, disagreement grouping, rulings                                                                    |
| `lib/ledger.mjs`                              | Dedup by `message.id`, LF-only line splitting, the price list, the long-prompt card                                                        |
| `lib/transcripts.mjs`                         | Reads one subagent transcript: its marker, what ran, its structured output, its writes, tools outside the allowlist and forbidden commands |
| `tasks/*.mjs`                                 | One file per task type                                                                                                                     |
| `results/*.json`                              | One file per measured run, copied by hand from `<run>`: scores, what ran, cost per arm, rulings                                            |

## The recipe

These are workspace#1's nine steps, with where each one happens.

1. **Freeze the input.** `prepare` copies the task's sources into `<run>/input`, sets every file
   to mode 444 and every directory to 555, and records a manifest of each file's mode and sha256
   and the mode of the folder and each directory in it. A cloud container runs as root, so the
   permission bits alone do not stop a write. `score` therefore re-reads the folder and reports
   any change as a problem. Each agent also gets its own scratch directory, `<run>/work/<id>`, and is told to write nowhere
   else. On 2026-10-19 the first row-4 run gave no such directory, and all four Haiku runs wrote
   the same `census/census.py` at once, so one ran another's script. `score` now reports any
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
   disagreements and writes `referee-args.json`, numbered as the next referee round. Run the
   workflow with it, `collect` again, and `score` again. Rulings from every round are kept. A
   ruling can credit an arm, and can refute the reference. An arm that agreed with a refuted
   reference loses that check. A value the arm left out is never credited.
7. **Check what actually ran.** `collect` reads `message.model` and the per-line `effort` field
   from each subagent transcript. `score` lists every arm and every referee whose transcripts
   disagree with what it asked for.
8. **Cost from usage, counted once per `message.id`.** Transcript lines repeat a message's
   usage, so summing every line roughly doubles the count.
9. **Report the ceiling.** If every arm scores perfectly, the run bounds the error rate. It does
   not rank the models.

## Running a task

```sh
node scripts/model-bakeoff/bakeoff.mjs prepare --task t5-census --out <run>
```

Then run the workflow with `<run>/workflow-args.json` as its `args`. The Workflow tool takes
`scriptPath: ".claude/workflows/model-bakeoff.workflow.js"`, and its launch message names the
transcript directory: `~/.claude/projects/<project>/<session>/subagents/workflows/<run id>/`.

```sh
node scripts/model-bakeoff/bakeoff.mjs collect --run <run> --transcripts <transcript dir>
node scripts/model-bakeoff/bakeoff.mjs score --run <run>
```

If `score` reports unruled disagreements, run the workflow again with `<run>/referee-args.json`,
then `collect` (with that run's transcript directory) and `score` again.

`collect` refuses, and writes nothing, when:

- two transcripts claim the same marker;
- a transcript's marker names no arm of this run;
- a prompt does not name this run's input folder and that agent's work dir, which catches a
  transcript directory from another run passed by mistake;
- a prompt holds a marker but not exactly one, at its end (a prompt with no marker is skipped);
- a referee marker is not `r<round>-<chunk>`.

`score` exits non-zero on any of these problems, and `<run>/result.json` holds the full result:

- `args.dir` is not `<run>/input`, or the input changed;
- the reference lists one item twice (the first entry is used);
- an arm or the gold has no transcript, or no accepted structured output;
- an arm, the gold or a referee ran on a model or effort it did not ask for;
- a disagreement is still unruled, or a referee chunk returned nothing while one is;
- the referee's rulings disagree about whether the reference is right on one check;
- an agent wrote outside its own directory (paths resolved; a relative path counts as outside),
  used a tool outside the allowlist (`Read`, `Bash`, `Glob`, `Grep`, `Write`, `Edit`,
  `NotebookEdit`, `StructuredOutput`, `ToolSearch`), or ran a forbidden Bash command.

It also exits non-zero when there is no reference at all: no truth, and no gold output.

The Bash check finds the command word of every simple command and judges that word alone. It
drops heredoc bodies, keeps a quoted single word as the word (`"gh"`, `-X 'POST'`) and blanks
other quoted text, then splits on newlines, `;`, `&&`, `||`, `|`, `&`, `$(`, backticks, brackets
and braces. In each piece it skips shell keywords (`do`, `then`, `if`, `!`, `time` and the like),
variable assignments, `command`/`exec`/`builtin`, and wrappers (`sudo`, `nohup`, `stdbuf`, `nice`,
`timeout`, `xargs`, `env`) with their options and option values. The command word is then
forbidden when it is `gh`; `git` with a writing subcommand (`push`, `commit`, `rm` and the like)
after any global options; `curl` with a write method, `--data`, `--form`, `--json`,
`--upload-file`, or a short-option cluster holding `d`, `F` or `T`; or `which gh`. It repeats the
check on the body of any `sh -c`, `bash -c` or `eval`. So `grep -n curl f | cut -d: -f1` and a
heredoc that mentions `gh api` pass, while `for r in a; do gh api $r; done` fails. Commands run
inside another interpreter (`node -e`, `python3 -c`) are not seen. It is a tripwire, not a
sandbox.

`--arms <file>` on `prepare` replaces the task's default arms with a JSON array.

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
left it out fail that check. Each collection also gets a `(no duplicates)` check per arm. A
duplicate is a mechanical fault, so it never goes to the referee, and where an item appears twice
the first entry is the one scored. The 2026-10-19 t5-census run had no extra items, so each run
had 228 checks: 188 fields, 38 `(present)` and 2 `(no duplicates)`.

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
- `truth(dir)`: optional, the script-computed reference. Leave it out when no script can compute
  the answer, and the gold run becomes the reference.
- `arms`: an array of `{ id, model, effort }`, the cheap arms. No arm id may be `gold` or start
  with `referee`. `--arms` on `prepare` replaces this list only.
- `gold`: one `{ id: "gold", model, effort }`, exported on its own.

Prove the instrument before trusting it. Score the truth against itself, which must be perfect.
Then score a perturbed copy, which must fail exactly where it was changed. That proves the scorer,
not the truth. The 2026-10-19 row-4 run did both before the first arm ran, and the referee still
found the truth wrong on one check: the script missed a bare `"node:"` literal that eight of nine
runs had found.

## The ledger

```sh
node scripts/model-bakeoff/ledger.mjs [--root <dir>] [--since <ISO date>] [--until <ISO date>] [--json <file>]
```

It reads `~/.claude/projects` by default, or `LEDGER_ROOT`, or `--root`. `--since` and `--until`
select files by modification time, as #2 did, not by message timestamp. It sorts each file into
main session, plain subagent or workflow subagent by its path, as #2 did, and prints how many
files fit none of the three. It keeps the last line for each `message.id` within a file, then
keeps one record per `message.id` across files, and reports both repeat counts.

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
