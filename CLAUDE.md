# CLAUDE.md

> **Operator directives: `reddoorla/reddoor-workspace` `CLAUDE.md`.** That file holds every rule that is not about this repo (proving instruments, the fleet, asking and finishing, cloud sessions, journals' style, Discord). Read it first; this file holds only this repo's rules. The stories behind the rules moved to that repo's `directives/`.

The autonomy and merge contract lives in [AUTONOMY.md](AUTONOMY.md) — read it before merging
anything. What to work on, ranked, with each item's tier, evidence and "done
when", is [docs/BACKLOG.md](docs/BACKLOG.md). It is a derived view: re-verify
an item before starting it, and update the file in the PR that finishes it.

## Concurrent sessions

Several sessions can work this repo at once; the collisions on record are in
the workspace's `directives/sessions.md`.

- **Never commit from the main checkout.** Before your first commit, move to
  your own git worktree (`git worktree add` / EnterWorktree) and work there.
  Treat the main checkout itself as read-only plus human editing: a concurrent
  `/loop` clobbered its HEAD on 2026-07-08.
- **Look at fresh branches, not only open PRs.** Before your first edit, list
  every `claude/*` and `fix/*` branch by age and open anything under a day old
  (#932 duplicated #933 on 2026-09-29 by skipping this):

  ```sh
  git fetch -q origin 'refs/heads/claude/*:refs/remotes/origin/claude/*' 'refs/heads/fix/*:refs/remotes/origin/fix/*'
  git for-each-ref --sort=-committerdate --format='%(committerdate:iso-strict) %(refname:short)' refs/remotes/origin/claude refs/remotes/origin/fix | head
  git diff --stat origin/main...origin/claude/<name>
  ```

  `git ls-remote --heads` prints no dates, and this repo carries dozens of
  months-old `fix/*` branches, so "under a day old" cannot be read off it. A
  fresh branch that touches your files belongs to that session.

- **Land PRs with `node scripts/land-prs.mjs <pr> …`** — serial, head-SHA gated,
  refuses release PRs; `--dry-run` shows the plan first. From a session whose
  cwd is another repo, pass `--repo reddoorla/reddoor-maintenance`.

## Worker sessions ask a blocking question once, with all its context

A worker started from a backlog item or a brief (`docs/worker-brief.md`)
follows three rules. Why each exists: the workspace's `directives/sessions.md`.

- **At a stop condition, write the question down, then ask it with the
  AskUserQuestion tool** (the operator, 2026-10-05). The question stands alone
  (the workspace `CLAUDE.md` says what it holds). Any of `AUTONOMY.md`'s stop
  conditions, or a fork the brief did not settle, becomes one line under
  "Operator decisions" in `docs/BACKLOG.md`: the exact ask, your pick and why,
  and the branch or PR holding the work. AskUserQuestion has no timeout in a
  cloud session, so do it in this order:
  1. Write the line on its own `claude/*` branch cut from `origin/main`, never
     on the work's branch (#1143's ask sat on a held branch for 13 hours).
     Commit it, push it, and open its docs-only PR.
  2. Push the work branch.
  3. Ask with AskUserQuestion.
  4. Land the docs-only PR with `node scripts/land-prs.mjs`. If an answer
     came, record it on the line first, in the form the backlog's answered
     items use: `**Answered <date> (AskUserQuestion): …**`. If
     AskUserQuestion is not available, land it and end the session.
- **Five dirty review rounds, then stop; a minors-only round is clean**
  (the operator, 2026-10-12, Operator decisions 107(a)). Label every finding
  `blocker`, `critical`, `major`, `minor` or `nit`; a minor is `minor` or
  `nit`, and anything else, unlabelled included, is a real defect. A
  minors-only round is clean: file each minor as an issue in the PR's repo,
  link them from the PR body, and stop reviewing. A reproduced behaviour
  defect is never a minor. If the fifth round still finds a real defect, the
  PR goes to "Operator decisions" with each round's findings, not into a sixth
  round; a PR held under the old two-round stop stays with the operator
  unless he says to resume. At the hold your pick may not be "land as is"
  while a reproduced behaviour defect is unfixed (a concrete input and the
  wrong output it gives, through the entry point production uses); the
  operator can still choose it.
- **The mutations are named before the code.** A brief lists the mutations the
  worker commits to running against its own tests. Run each, record whether a
  test went red, and put the table in the PR body. A test no mutation turns
  red is not yet evidence (the workspace `CLAUDE.md`, "Prove the instrument").

## Before a fleet sweep, ask which repos can receive a push

```sh
scripts/fleet-repos.sh            # table: pushable / ARCHIVED / NO-REMOTE / UNKNOWN
scripts/fleet-repos.sh --pushable # names to iterate
scripts/fleet-repos.sh --skipped  # what to leave alone, and why
```

Iterate `--pushable` and **report** the rest in the summary; do not discover
them at push time. The script answers "of the repos you have cloned", never
"of the org": `reddoorla/the-tower` is archived with no checkout, so it never
appears. For org-wide claims, and in a cloud session where the other checkouts
are not here, enumerate from the GitHub API and attach each repo before cloning.

- **An archived repo is invisible from inside its clone.** Remote, `ls-remote`
  and `fetch` all look normal; only the push fails, after every commit is
  written. Do not unarchive a repo to finish a sweep; that is the operator's.
- **The script maps by remote, not by directory name**: the checkout
  `welcome-to-the-flower-court` is `tucksravin/invitations`.

The stories: the workspace's `directives/fleet.md`.

## Cloud sessions (Claude Code on the web)

The cloud rules for every repo are in the workspace `CLAUDE.md`. Two are this
repo's own:

- **Setup is `.claude/hooks/cloud-session-setup.sh`**, which runs on startup
  and resume, only when `CLAUDE_CODE_REMOTE=true`. It unshallows the clone (the harness
  clones `--depth 50` with no tags, which `check-match-harness-snapshots.mjs`
  refuses), puts `.nvmrc`'s Node on `PATH` (the image ships 22), runs
  `pnpm install`, writes the GA key from `GA_SA_KEY_B64`, installs the pinned
  Playwright browsers and `gh`, exports Playwright's Chromium as `CHROME_PATH`
  when no Chrome is on `PATH` (lhci cannot find one otherwise; the lighthouse
  audit adds `--no-sandbox` itself when it runs as root), and adds the egress proxy's CA to Chromium's
  NSS store. It is silent when all of that worked; anything it could not do
  arrives as a `cloud-session-setup:` message (unless the 900 s hook timeout
  killed it first). It installs into the main
  checkout, so a worktree needs its own `pnpm install --frozen-lockfile`. When
  this repo is attached to a session that started elsewhere, no hook runs it:
  run it yourself.
- **Land PRs from the cloud with `node scripts/land-prs.mjs`.** It is REST-only,
  with the same gates as on the laptop. The proxy refuses branch deletes, so it
  checks whether GitHub already removed the branch and prints a `note:` only
  when it is still there. Attach a fleet repo with `add_repo` before landing
  in it. It picks the merge method per base branch (squash where the repo and
  every ruleset allow, else merge, else rebase) and stops when none is
  allowed; reddoor-website's `main` allows only `merge`. `--dry-run` prints
  the method. The proof that it works live: the workspace's `directives/cloud.md`.
- **`tests/prismic/models/write.test.ts` skips its one refusal case under
  root**, because the container runs as root; CI, which is not, still runs it.

## The work journal

**Every working session writes a dated entry as its own file in `docs/journal/`**,
named `<YYYY-MM-DD-HHMM>-<slug>.md` from `date -u`, in the same PR as the code it
describes. `ls docs/journal | tail` shows the newest. Entries before 2026-10-07
are in `docs/workJournal.md`, which is frozen: `tests/docs/journal-frozen.test.ts`
fails if it takes any change but a forward pointer. One file per entry exists
because the shared file was in 183 of 230 conflicted merges in the week after
2026-09-29. What an entry holds and the never-edit rule are in the workspace
`CLAUDE.md` "Journals".

## Stored column names

Turso is the only store. The FieldSet builders in `src/fleet/site-fields.ts`
and `src/reports/report-fields.ts` are keyed by legacy column names
(`"maintenence freq"`, `"Report recipients (To)"`, …), and
`src/db/field-map.ts` maps them to Turso columns.
