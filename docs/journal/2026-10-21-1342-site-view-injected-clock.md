# 2026-10-21 — `/s/:slug`: a test that the page reads only its injected clock

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/site-view-injected-clock`). After the merge with `main`, it holds only a regression test.

**What broke.** On 2026-10-21, `cockpit/tests/site/site.ssr.test.ts` "submissions over the cap" went red with no code change: its snapshot said `3mo ago`, the render said `4mo ago`. `buildSiteView` takes a `now`, but three labels read the wall clock instead:

- the last-commit detail;
- "Last audited";
- each submission row's time.

Their snapshots were written at real time, so they matched only as long as each label's bucket held.

**Two sessions fixed it at once.** I found it while building the hide-archived change to Sites, and opened this PR with the fix. Before I edited, no `claude/*` or `fix/*` branch under a day old touched these files. The other session's fix landed in reddoorla/reddoor-maintenance#1592, merged at 9:45am PT. That PR's branch was named for its rate-limit journal, and the fix commit arrived on it after my check. #1592 makes the same three changes and rewrites the same snapshots. The fresh-branch check compares file paths at one moment, so a fix that lands on an unrelated branch afterwards slips past it.

**What this PR keeps.** #1592 adds no test that stops a wall-clock read from coming back: a snapshot catches one only when a label crosses a bucket boundary, which is how this one hid. This PR adds a test that renders each case, moves the system clock to 2031, renders it again, and expects identical markup. In the merge I took `main`'s side for the source and the snapshots.

**Measured.** Mutations, each run and restored:

| Mutation                                   | Result      |
| ------------------------------------------ | ----------- |
| The last-commit label reads the wall clock | 2 tests red |
| "Last audited" reads the wall clock        | 54 red      |
| Submission rows read the wall clock        | 5 red       |

The first three runs came before the merge, against my own fix. After the merge I ran the third again, against `main`'s code, and got the same 5 red.

**Review round 1 was clean**, with one minor and four nits.

- **Folded in:** two nits. The test's name now says "in 2031". This entry now says which `/submissions` tests pin the clock: its snapshot test does, while its DOM and action tests assert no time label.
- **Filed:** the minor, as #1603. The fixture's submissions postdate its pinned `now`, so they all read "just now".
- **Left as they are:**
  - the clock loop covers only `CASES`;
  - the `afterEach` undoes the time-travel shim, but the tests it affects already run last.
