# 2026-10-21 — The cockpit's reads go parallel, once Kysely's own lock is lifted

Landed in: this PR (branch `claude/cockpit-parallel-reads`). Brief: home base `briefs/2026-10-21-cockpit-parallel-reads.md`. Decision: home base `decisions/2026-10-21-1901-cockpit-parallel-reads-kysely-mutex.md`, answered by the operator at 12:05pm PT. Follow-ups: #1656, #1657.

**The brief's premise was wrong one layer up.** The brief says `@libsql/kysely-libsql`'s driver "hands every query to that one client with no lock". That is true of the driver. But the adapter it reports is Kysely's `SqliteAdapter`, whose `supportsMultipleConnections` is `false`. So Kysely 0.29.7's `RuntimeDriver` wraps every query in a `ConnectionMutex`, and every `Promise.all` on a `Db` has run one query at a time. That includes the one `loadSubmissionsPage` has carried for months.

**What the brief's Verify-first step measured** (11:55am PT, SELECT-only against production Turso, `/s/williamson-construction-co`'s six post-site reads): `Promise.all` took 422 ms against 427 ms sequential, a ratio of 0.986 against a bar of 0.6. That is the brief's stop condition, and I stopped.

**How the cause was found.** The positive control was six separate clients in `Promise.all`: 126 ms against 429 ms. It showed that the instrument could see parallelism. I then timed each layer on its own, logging every fetch's start and end:

| What ran                | Result                                    |
| ----------------------- | ----------------------------------------- |
| raw `client.execute` ×6 | all start together and end in 65 to 87 ms |
| the same through Kysely | each starts as the previous ends, 363 ms  |

**Two of the brief's escape options were already moot:**

- **An `https://` URL is a no-op.** `@libsql/client` 0.8.1 already sends `libsql://` over HTTP.
- **`db.batch` was the fastest** at 59 ms for all seven statements, but it is the snapshot brief's design.

**What changed.**

- `openDb(cfg, { concurrentReads: true })` builds an adapter that reports `true`. Only the cockpit's `withDb` asks for it. Every other `openDb` caller (33 files, writers among them) keeps the lock.
- `loadCockpitModel` reads its 9 queries in one wave.
- `loadSiteDashboard` reads the site, then its other 8 queries in a second wave. That needed:
  - the site alarm's reads split from its build, so they no longer wait for the reports;
  - `screenOutTotalsForSite`'s two queries issued together.
- Each defensive read keeps its own catch through `orElse`.

**Measured after** (12:44pm PT, the real loaders, SELECT-only, medians of 7, identical models):

| Load                            | Before (with the lock) | After (`concurrentReads`) |
| ------------------------------- | ---------------------- | ------------------------- |
| `/`                             | 622 ms                 | 169 ms                    |
| `/s/williamson-construction-co` | 610 ms                 | 132 ms                    |

This is from a cloud container, about 60 ms per round trip, through an egress proxy that adds about 1.2 s outliers when it opens a connection. Netlify's numbers will differ. The operator's next browse, read from Netlify's request log within the hour, is the real before and after: compare against 5.44 s and 1.34 s for the first and second `/`, and 3.01 s for the first `/s/:slug`.

**Evidence.**

- **The failure-isolation snapshots** (17 of them) were written by the sequential loaders, in a commit before the loaders changed, and pass unchanged after. Each one fails exactly one read, through a matcher that is asserted to hit only that read, and asserts that the model changed.
- **Fixture defects the snapshots caught.** I had to strengthen the fixture twice:
  - the bounce alarm needs two bounces;
  - the cockpit hides a held dead letter, so the count needed a second, older one on another site.
- **Mutations.** 9 of 11 went red.
  - The brief's mutation 4 (the oldest dead letter applied when the count is 0) is an equivalent mutant: `collectDeadLetterAlerts` reads the oldest map only for slugs with a count, so the feared "a site with no dead letter shows a hold" cannot happen.
  - The guard stays anyway.

**Review.** Two rounds.

- Round 1's behaviour and concurrency lenses were clean.
- Round 1's tests lens found a critical: my mutex control passed with the mutex off. `t0` was taken before `kyselyOverClient`'s roughly 100 ms of dynamic imports, so the first test in the file always looked serial. It also found that `openDb` could drop its option unnoticed. Both are fixed: the test now measures the spread between the first and last start, and checks the adapter `openDb` builds.
- Round 2 was clean. Its run with CPU hogs passed 16 of 16.
- The minors went to issues: a guard against a transaction under `withDb` (#1656), and `mutate.mjs`'s throwaway worktree lacking `cockpit/.svelte-kit` (#1657), which I worked around with `--in-place`.

**Belief corrected.** "Parallel reads are a client or Turso question" was the brief's frame and mine. It was a Kysely question, two files up from where anyone had looked. The snapshot brief should know: its `db.batch` path needs no lock change, but anything it builds on `Promise.all` needs a `concurrentReads` `Db`.
