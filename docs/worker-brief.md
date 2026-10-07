# Worker brief

A worker session is started by pasting one brief. The PM pass fills one in for
each backlog item it recommends starting (`docs/pm-pass.md`, step 7), so the
operator's part is copy and paste. A brief is complete enough that the worker
rarely has to ask the operator anything mid-flight. If it must, it follows
`CLAUDE.md` → "Worker sessions ask a blocking question once, with all its
context": it asks with AskUserQuestion and writes the decision under "Operator
decisions" too; that is the brief's defect, and
the next PM pass fixes the template or the item.

The template is below. Every part is required; write "none" rather than leaving
one out, so a missing part reads as a decision and not an oversight.

## Why each part exists

- **Item.** The backlog ID, the issue and the tier. The tier sets how the
  worker lands: GREEN merges on CI plus review, a behavior-changing YELLOW
  needs the 3-lens review, RED never reaches a worker.
- **Verify first.** The backlog is a derived view. The item's _Verify_ line is
  re-run before any edit; if the world moved, the worker fixes the backlog line
  and says so in its PR rather than building on the stale one.
- **Start here.** File paths with line numbers, measured the morning the brief
  was written. They go stale fast, so the worker reads them as "where to look",
  not "what to change".
- **Done when.** An observable result, preferably one a test or a query can
  show. "Fixed" is not a done-when.
- **Mutations.** Written before the code, because a test suite that nothing can
  turn red is not evidence. Each line is a change to the fix that some test must
  catch. The worker runs every one and puts the table in the PR body.
- **Stop conditions.** `AUTONOMY.md`'s six always apply. This part adds the
  item's own: the fork that would change what the feature is, the file owned by
  another session, the RED step that follows.
  Whatever the stop, its "Operator decisions" line lands on `main` as its own
  docs-only PR. #1143 (2026-10-05) is why: its worker held the PR after two
  dirty rounds and wrote the ask on the PR's own branch, so `main`, which is
  what the PM pass reads, asked the operator nothing for 13 hours.
- **Landing.** The same every time, so it is short.

## Template

```markdown
## Worker brief — <backlog ID>: <one-line title>

**Item.** <P1-NN> · #<issue> · <🟢 GREEN | 🟡 YELLOW> · effort <S | M | L>
<One or two sentences: what is wrong, and the evidence tag [M]/[I].>

**Verify first.** `<the command or query that shows the problem today>`
Expect: <what it prints while the problem exists>.

**Start here.**

- `<path:line>` — <what is there>
- `<test path>` — <the existing tests to extend>

**Done when.** <observable result, e.g. "an unchanged pending set sends nothing
on two consecutive days, and a test pins it">

**Mutations I will run** (each must turn a test red):

1. <e.g. "drop the set-changed check, always send">
2. <e.g. "compute the age from `now` instead of first-seen">
3. <...>

**Stop conditions** (beyond AUTONOMY.md's six):

- <the product fork this item could hit, stated as the question>
- <files owned by another session today: do not edit>
- Two dirty review rounds → "Operator decisions", not a third round.
- At any stop condition: the "Operator decisions" line lands on `main` as its
  own docs-only PR (`land-prs.mjs`), never only on this work's branch or held
  PR. Then push the work branch and end.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Claim on #<issue>. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), then the
   review this tier needs, with the mutations table in the PR body.
4. Move the item to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry as a new file in `docs/journal/`, landed before the session ends.
7. Stopped instead of landing? The "Operator decisions" line still lands on
   `main` as a docs-only PR (step 5), and the work branch is pushed. A
   branch with no PR, or a question only on a branch, is what the evening
   pass flags.
```

## An example

Filled in for P1-12 from the 2026-09-29 backlog, as the PM pass would write it.
Its _Verify_ command and line numbers were checked when this file was written.

```markdown
## Worker brief — P1-12: weekly `sync-configs` drift report

**Item.** P1-12 · no issue yet (open one) · 🟢 GREEN · effort S–M
Nothing runs `sync-configs --dry`, so a client repo whose shared configs drift
from the templates is noticed only when someone runs it by hand [M].

**Verify first.** `grep -rl sync-configs .github/workflows/`
Expect: no output (exit 1).

**Start here.**

- `src/recipes/sync-configs.ts:104` — `planTemplateDiffs`, the dry-run plan
- `src/recipes/sync-configs.ts:194` — `syncConfigs`, the entry point
- `.github/workflows/fleet-prismic-drift.yml` — the nearest existing drift
  nightly, including its tracking-issue steps

**Done when.** A weekly scheduled run opens or updates one tracking issue that
lists each drifted repo and file, closes it when nothing drifts, and has a
positive control: a fixture repo with a known drift that the run must report.

**Mutations I will run** (each must turn a test red):

1. The report drops the last drifted repo (off-by-one in the loop).
2. A repo that fails to clone is counted as "no drift".
3. The close step fires while drift remains.

**Stop conditions** (beyond AUTONOMY.md's six):

- The run must never push or open PRs in client repos: that is a fleet-wide
  mutation, 🔴. If the item seems to need it, stop and write it up.
- Two dirty review rounds → "Operator decisions", not a third round.

**Landing.** As in the template.
```
