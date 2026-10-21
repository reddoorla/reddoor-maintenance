# 2026-10-21 — `/s/:slug` reads only its injected clock

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/site-view-injected-clock`). I found it while building the hide-archived change to Sites: `main` went red today with no code change.

**What broke.** `cockpit/tests/site/site.ssr.test.ts` "submissions over the cap" failed on a branch that does not touch the site page. Its snapshot said `3mo ago` and the render said `4mo ago`. The fixture's submissions are dated June 2026, and today is 2026-10-21, four months on. `buildSiteView` takes a `now`, and the fixture pins it at 2026-06-15. But three labels ignored it and called `relativeTimeFromNow` with the wall clock:

- the details row's last commit;
- the "Last audited" line;
- each submission row's time, through `buildSubmissionRowView`.

So every snapshot that carries those labels has drifted with real days since the cutover. This was the first one to cross a month boundary. The rest would have followed.

**What hid it.** The snapshots were written at real time, so they matched for as long as each label's bucket held: weeks for "Xw ago", a month for "Xmo ago".

**The fix.** All three now take the view's `now`. `buildSubmissionRowView` gains a `now` parameter that defaults to the wall clock, because `/submissions` builds its rows with no clock of its own. Its snapshot test pins the system time with fake timers already; its DOM and action tests assert no time label. The 30 site snapshots were rewritten: 126 lines changed each way, and every changed line carries a relative time (a grep for changed lines without one finds 0).

**Measured.** A new test renders each case, moves the system clock to 2031, renders it again, and asks for identical markup. Mutations, each run and restored:

| Mutation                                   | Result      |
| ------------------------------------------ | ----------- |
| The last-commit label reads the wall clock | 2 tests red |
| "Last audited" reads the wall clock        | 54 red      |
| Submission rows read the wall clock        | 5 red       |

**Review round 1 was clean**, with one minor and four nits. Two nits are folded in: the new test's name now says "in 2031" rather than "a year on", and this entry says which `/submissions` tests pin the clock. The minor is filed as #1603, since `fixtures.ts` is outside this PR: the fixture's submissions postdate its pinned `now`, so they all read "just now". The other nits needed no change: the clock loop covers `CASES` only, and the `afterEach` undoes the time-travel shim for tests that already run last.
