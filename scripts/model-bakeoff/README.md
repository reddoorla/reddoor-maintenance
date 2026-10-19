# Model bake-off

This directory measures which model and effort can do a recurring task as well as the gold
standard, and what each run costs. The method, the routing table and every result live in
[reddoorla/reddoor-workspace#1](https://github.com/reddoorla/reddoor-workspace/issues/1). The
30-day spend ledger that motivated it is
[reddoorla/reddoor-workspace#2](https://github.com/reddoorla/reddoor-workspace/issues/2).

| File                                          | What it does                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bakeoff.mjs`                                 | `prepare` freezes a task's inputs, `collect` reads the run's transcripts, `score` scores and reports         |
| `.claude/workflows/model-bakeoff.workflow.js` | Runs the gold and every arm on one prompt and schema (`mode: "extract"`), or the referee (`mode: "referee"`) |
| `ledger.mjs`                                  | Token and cost ledger over Claude Code transcripts, by `message.model` and `effort`                          |
| `lib/arms.mjs`                                | Arm validation; the workflow carries a byte-identical copy (tested)                                          |
| `lib/score.mjs`                               | Deterministic normalisation and scoring, disagreement grouping, rulings                                      |
| `lib/ledger.mjs`                              | Dedup by `message.id`, LF-only line splitting, the price list, the long-prompt card                          |
| `lib/transcripts.mjs`                         | Reads one subagent transcript: its arm, what ran, its structured output, any forbidden command               |
| `tasks/*.mjs`                                 | One file per task type                                                                                       |
| `results/*.json`                              | One file per measured run: scores, what ran, and cost per arm, as posted to workspace#1                      |

## The recipe

These are workspace#1's nine steps, with where each one happens.

1. **Freeze the input.** `prepare` copies the task's sources into `<run>/input`, removes write
   permission (`chmod a-w` on every file and directory), and records a sha256 manifest. A cloud
   container runs as root, so the permission bits alone do not stop a write. `score` therefore
   re-hashes the folder and reports any change as a problem.
2. **One prompt, one schema.** The task file supplies both. Every arm gets the same text. Only the
   gold run gets the task's `goldAddendum` on top.
3. **Build the gold mechanically.** The gold runs on Opus at `high` and is told to verify every
   field with scripts. When the task can compute its own truth (`truth(dir)`), the arms are scored
   against that truth, and so is the gold, which verifies the gold by script. When it cannot, the
   arms are scored against the gold's output.
4. **Arms.** Run at least two of each cheap arm. Every arm names a `model` and an `effort`, and
   both `validateArms` and the workflow refuse one without an `effort`, because an arm with none
   inherits the session's effort (`xhigh` on the operator's laptop). "The default effort" means
   the model's documented default, written out: Haiku 5.5 and Opus 5.5 default to `medium`.
5. **Score deterministically**, with the normalisation below.
6. **Referee every disagreement.** `score` groups the distinct arm-versus-reference
   disagreements and writes `referee-args.json`. Run the workflow with it, `collect` again, and
   `score` again. A ruling can credit an arm and can record a wrong reference. A missing value is
   never credited.
7. **Check what actually ran.** `collect` reads `message.model` and the per-line `effort` field
   from each subagent transcript, and `score` lists every arm whose transcripts disagree with what
   it asked for.
8. **Cost from usage, counted once per `message.id`.** Transcript lines repeat a message's
   usage, so summing every line roughly doubles the count.
9. **Report the ceiling.** If every arm scores perfectly, the run bounds the error rate. It does
   not rank the models.

## Running a task

```sh
node scripts/model-bakeoff/bakeoff.mjs prepare --task t5-census --out <run>
```

Then run the workflow with `<run>/workflow-args.json` as its `args`. The Workflow tool takes
`scriptPath: ".claude/workflows/model-bakeoff.workflow.js"`. Its result gives the transcript
directory.

```sh
node scripts/model-bakeoff/bakeoff.mjs collect --run <run> --transcripts <transcript dir>
node scripts/model-bakeoff/bakeoff.mjs score --run <run>
```

If `score` reports unruled disagreements, run the workflow again with `<run>/referee-args.json`,
then `collect` (with that run's transcript directory) and `score` again. `score` exits non-zero
when the input changed, an arm is missing, an arm ran on a model or effort it did not ask for,
or an arm ran a forbidden command. `<run>/result.json` holds the full result.

`--arms <file>` on `prepare` replaces the task's default arms with a JSON array.

## Scoring

Each field has a kind. The kinds apply these rules before comparing:

| Rule          | What it does                                             | Kinds                                       |
| ------------- | -------------------------------------------------------- | ------------------------------------------- |
| `dashes`      | U+2010 to U+2015 and U+2212 become `-`                   | `string`, `text`, `name`                    |
| `whitespace`  | Runs of whitespace become one space; ends trimmed        | `string`                                    |
| `casefold`    | Lower case                                               | `string`, `text`, `name`, `file`, `boolean` |
| `punctuation` | Everything but `a-z` and `0-9` removed                   | `text`, `name`                              |
| `titlePrefix` | A leading Det., Detective, Dr., Mr., Mrs. or Ms. removed | `name`                                      |
| sets          | Order ignored; duplicates and empty members dropped      | `set:<kind>`                                |

`number` compares the numeric value. `boolean` accepts `true` and `false`, or those words. `file`
keys an item by its base name, so `workflows/ci.yml` and `CI.yml` are the same item.

## Adding a task type

Add `tasks/<id>.mjs` exporting:

- `id`, `title`, and `row`: the row of workspace#1's "What to test next" table.
- `sources`: `[{ from, match, to }]`. Each source copies the files in `from` (relative to the repo
  root, or `--root`) whose names match `match` into `input/<to>`.
- `prompt(dir)` and `goldAddendum`.
- `schema`: the JSON schema for the structured output.
- `collections`: `[{ name, key, keyKind, fields: { field: kind } }]`. These are the arrays to
  score, the field that identifies an item, and each field's kind.
- `truth(dir)`: optional, the script-computed reference. Leave it out when no script can compute
  the answer, and the gold run becomes the reference.
- `arms` and `gold`: `{ id, model, effort }` each.

Prove the instrument before trusting it. Score the truth against itself, which must be perfect.
Then score a perturbed copy, which must fail exactly where it was changed. The 2026-10-19 row-4
run did both before the first arm ran.

## The ledger

```sh
node scripts/model-bakeoff/ledger.mjs [--root <dir>] [--since <ISO date>] [--until <ISO date>] [--json <file>]
```

It reads `~/.claude/projects` by default, or `LEDGER_ROOT`, or `--root`. It sorts each file into
main session, plain subagent or workflow subagent by its path, as #2 did. Within each file, it
keeps the last line for each `message.id`.

Prices come from `PRICES` in `lib/ledger.mjs`, confirmed on 2026-10-19 against the claude-api
skill's price list (cached 2026-10-06). Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 are listed.
Any other model is reported as unpriced, never estimated. Two differences from #2's `ledger.js`:

- **Cache writes are priced by TTL.** Usage splits `cache_creation_input_tokens` into
  `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. A 5-minute write costs 1.25x input
  and a 1-hour write costs 2x. #2 priced every write at 1.25x, but this session's own transcripts
  write 1-hour entries, so #2's cache-write cost is low by up to 1.6x on those tokens. A write with
  no split is priced at the 5-minute rate and counted in the `ttlUnknown` column.
- **Haiku's long-prompt card is the published one.** Above 100K prompt tokens (input plus cache
  read plus cache write), Haiku 5.5 bills $0.50 / $2.50 input / output, cache reads at 0.1x, and
  writes at 1.25x / 2x. That is 5x on every class, which #2 had assumed.
