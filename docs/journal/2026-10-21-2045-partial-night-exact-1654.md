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
- Sites on #1612's cross-check path (erp-industrials last night) store pnpm's answer on every night it runs, a clean answer included; a site where Dependabot reads the root lockfile (29-navy, if its alerts sit there) stores none, since pnpm does not run there.
- Until a site has had that first full night, its cell is NULL and a partial night writes nothing, exactly as before. The harm #1654 names ends site by site, on each one's first full night.

**Mutations: eight, all red.**

- From the brief: counts by hand instead of `mergeAudits` (10 tests), a refreshed audit time (19), the pre-lift severity replaced by the lifted one (3, round 8's ratchet among them).
- Mine: no view stored, writing Dependabot alone over audited counts, merging a truncated view, and a never-audited row writing nothing.

**Belief corrected on contact.** A property test can pass on the code it is meant to replace, whenever "write nothing" happens to equal the right answer. Running the tests on the old code first is what showed it.

**Five review rounds; the first four were dirty, each with a reproduced wrong output.** Each corrected a belief about what "the same as a full night" takes:

- **R1:** the stored result went stale. It was written only on merged nights, so a newer clean full night left it standing, and a later partial night brought back an advisory pnpm had dropped. R1 also found that a written partial night hid a pnpm outage from the write gate, and that a property with one fixed pnpm answer per case could never show staleness. Now every full night sets or clears the stored result, a written partial night is still unmeasured, and the harness varies pnpm's answer between nights.
- **R2:** on #1612's cross-check, a full night with a clean pnpm answer writes Dependabot unmerged, while a partial night merged it. So two alerts on one advisory counted 2 against 1. The partial night now follows the full night's rule.
- **R3:** pnpm's `cves: []` was spread over Dependabot's CVE in the full night's merge, but dropped by the rebuild. pnpm's CVE list now rides only when non-empty.
- **R4:** the stored result carried each advisory's relationship, which a full night works out from tonight's `package.json`. A package that had become a direct dependency stayed "transitive" on a partial night, which mutes the auto-fix escalation. The stored result now keeps no relationship, and both nights apply tonight's.
- **R5:** clean. Its two test gaps are #1683. Its nit is folded: the cell holds npm's result where pnpm is missing.

**Migration order.** The #1608 worker landed `0047` first (#1678). Ids are an applied set, so `0046` applies after it. A scratch database migrated by `main` to `0047` then took `0046` from this branch, with unchanged counts.

The issue's property says a partial night reads "exactly as a full night would". Each round found one more input a full night reads tonight and the stored result had frozen: whether it merged, an empty CVE list, the `package.json`. The property test only became evidence once its harness could vary each of those between nights.
