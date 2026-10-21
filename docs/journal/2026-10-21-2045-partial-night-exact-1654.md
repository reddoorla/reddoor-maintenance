# 2026-10-21 — #1654: a partial security night writes what a full night would

Landed in: this PR (`claude/1654-pnpm-own-view`). Follows #1612 (#1661) in the same session. The design is the one #1654's issue gave after #1641's eight rounds.

**Why.** #1641 showed that a night `pnpm audit` cannot run can only be written right with pnpm's own view: its metadata counts and its pre-merge severities. The row never stored that view, so every rebuild guessed it, and each guess failed on a different input. This PR stores the view, and the guessing goes away.

**What.** A full merged night writes pnpm's own result to one new JSON column, `security_lockfile_audit` (migration 0046). A partial night rebuilds pnpm's result from that column and runs the same `mergeAudits`. With nothing stored, it writes nothing (as main did), except on a never-audited row with a live alert.

**Why one JSON column, not four counts.**
- The value is all-or-nothing: counts without the advisory list cannot rebuild a merge.
- The field map maps one legacy name to one column, as `Security advisories` already does.
- Nothing in the cockpit reads it.

**The `lockfile` tag's third state.** Absent is read as lockfile-sourced, and the type's comment says so. Nothing decides on the tag any more: the partial night reads the stored view, not the tags.

**Acceptance, as one property.** For every #1561 round's case, after the same history, a partial night leaves the row as a full night with the same pnpm answer would.
- On the code before this PR, 20 of the 23 cases are red.
- The other three pin no-write behaviour the old code already had.
- The first draft had nine cases green on the old code. Their partial nights repeated the full night's alerts, so "write nothing" equalled the expected row. Each now adds one live alert the old code cannot write.

**The first nightly after the merge**, proved on a scratch `file:` libSQL database:
- The old checkout migrated the database to 0045 and wrote a caltex-shaped full night: `0C/2H/1M/0L`, three advisories.
- The new checkout then applied 0046 and wrote the same counts and advisories. It also stored pnpm's view (`2H/1M` metadata, sharp and devalue at high) and stamped the audit time.
- A partial night after it wrote the same counts, kept the audit time, and left the stored view alone.
- On the fleet: every one of the 15 hidden-lockfile sites runs `pnpm audit` in CI, so the first nightly stores a view for each, and their counts do not change.

**Mutations: eight, all red.**
- From the brief: counts by hand instead of `mergeAudits` (10 tests), a refreshed audit time (19), the pre-lift severity replaced by the lifted one (3, round 8's ratchet among them).
- Mine: no view stored, writing Dependabot alone over audited counts, merging a truncated view, and a never-audited row writing nothing.

**Belief corrected on contact.** A property test can pass on the code it is meant to replace, whenever "write nothing" happens to equal the right answer. Running the tests on the old code first is what showed it.
