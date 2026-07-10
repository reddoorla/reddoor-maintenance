# CLAUDE.md

Session rules for AI agents working this repo. The autonomy and merge
contract lives in [AUTONOMY.md](AUTONOMY.md) — read it before merging
anything.

## Concurrent sessions

Multiple Claude sessions can be active on this repo and the fleet at the same
time. Two real collisions have already happened (2026-07-08: a concurrent
`/loop` clobbered the main checkout's HEAD; 2026-07-09: a paused session's
checked-out branch received another session's commit, which rode into its
PR's squash). These rules keep separate sessions from corrupting each other's
work:

- **Never commit from the main checkout.** Before your first commit, move to
  your own git worktree (`git worktree add` / EnterWorktree) and work there.
  Treat the main checkout itself as read-only plus human editing.
- **Claim fleet signals before triaging them.** Red nightlies and cockpit
  alarms are visible to every session. Before starting, check the auto-filed
  tracking issue (e.g. "Nightly fleet smoke failing") for an existing claim
  and comment yours. A run that never started files no issue — absence of a
  tracking issue is not absence of a failure.
- **Check targets before dispatching fixes.** Before fixing a site repo, look
  for fresh `fix/*` branches and open or just-merged PRs there — another
  session may already be on it (this is exactly how six duplicate-fix PRs
  nearly double-merged on 2026-07-09).
- **Stay in your charter.** If the operator scoped the session to a problem,
  don't opportunistically pick up other fleet signals without the claim check
  above.
- **Re-verify after any pause.** After a session-limit pause, compaction, or
  long gap: `git log --oneline -3` and `git status` before committing, and
  re-confirm the PR head SHA before merging — the world may have changed
  underneath you.

Individual site repos generally get **one** agent session at a time; the
worktree rule is mandatory here in the central repo and best practice there.
