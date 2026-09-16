---
"@reddoorla/maintenance": patch
---

every recipe that creates NEW paths proves git took them — a11y-fixtures-page, health-endpoint, smoke-suite, prismic-ci, self-updating (#741)

`commit()` stages with `git add -A`, which honours the target site's
`.gitignore` and exits 0 either way, and git cannot re-include a file whose
parent directory is excluded. #734 closed that for `match-harness` only; the
primitive it added (`pathsMissingFromHead` + `ignoreRulesFor`) is generic and
the defect class was not.

The five recipes that create new paths now check, after the commit, that every
path they claim to have installed is FOUND in `git ls-tree -r -z --name-only
HEAD`, and refuse — naming the ignore rule and the file it came from — when it
is not. The shared `refusedByGit` / `undoRefusedWrites` helpers live in
`src/recipes/_head-guard.ts`.

What each was reporting before, all of it measured in the new tests rather than
assumed:

- `smoke-suite` reported **applied**. `package.json` is tracked and always
  changes, so `commit()` returned a SHA even when a `tests/` rule dropped both
  spec files — the suite CI runs `test:smoke` against existed on nobody's disk.
- `prismic-ci` reported **noop, "already present and identical in the
  checkout"** — a statement about a file that was in no commit at all.
- `self-updating` reported **applied** on a PARTIAL drop: one config committed,
  so the branch was pushed and a PR opened for a repo that would never become
  self-updating, after which every later run said "self-updating PR already
  open".
- `a11y-fixtures-page` and `health-endpoint` reported **noop** (single file, so
  nothing staged), then noop'd on "already exists" forever after, because the
  file git refused stayed on disk.

That last point is why a refusal also puts the checkout back: only the paths
this run wrote and git then refused are removed, with the directories it created
pruned while they are empty. `git checkout -f` cannot do it — those paths are
ignored, so git does not know they exist.

Presence, not content: a path in HEAD with the wrong bytes still passes. The
check answers "the commit contains what the recipe says it installed", never
"the recipe worked".
