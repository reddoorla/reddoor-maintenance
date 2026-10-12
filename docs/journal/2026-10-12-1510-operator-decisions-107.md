## 2026-10-12 — Five review rounds with minors filed, and a morning-only PM pass (Operator decisions 107, #1305)

The operator's answer to the two-week check (item 107, recorded by #1302) was
"a) bump to five rounds but add a file minors as issues side to it so it can
stop earlier; b) keep; c) cut; d) cut; e) cut". This entry is the build.

**(a) The review stop.** The rule had been two dirty rounds since 09-29.
Under it, escalations ran at about 3.7 a day before 10-06 and 1.5 a day after.
The share of escalations that went to a third round rose from 37% to 67%,
because the operator kept choosing one (101, 104, 105). Five rounds turns
that choice into the default. The early stop needed a definition of "minor".
I took it from the words reviewers here already write, counted over
`docs/journal/` and `docs/BACKLOG.md`:

| Word     | Count |
| -------- | ----- |
| major    | 69    |
| minor    | 60    |
| blocker  | 48    |
| nit      | 15    |
| critical | 8     |

So a minor is a finding labelled `minor` or `nit`. The first draft went past
the operator's words in two places, and round 1 called both out:

- **A label could hide a reproduced defect.** A reviewer could write
  "minor: input X gives wrong output Y". Under the first draft that round
  counts as clean and the PR lands with the defect filed. That bypasses the
  land-as-is guard, which binds only "at the hold". The rule now says a
  reproduced behaviour defect is never a minor.
- **Filing minors from dirty rounds.** The first draft also filed minors
  found beside a real defect. That is not in the answer, so it was dropped.

Two parts are my reading, not the operator's words, and the PR body names
them:

- an unlabelled finding is a real defect;
- a PR already held under the two-round rule stays held unless he says to
  resume.

**(d) The evening pass, and the instrument that watches for it.**
`scripts/pm-pass-watch.mjs` reads the Routine's cron from `docs/pm-pass.md`
as of 00:00 PT on each date. Before this change it rejected any cron without
two hours. So the obvious doc edit, `48 4 * * 1-4`, would have made every
later day "blind", and the watcher would have sent a daily blind email.
That is noise rather than a false miss, but noise all the same.

- **What changed.** The parser now takes a one-hour cron only when the hour
  is before noon. The morning pass is "before 12:00 PT" by definition. On
  such a day the `second` slot is `no-pass`. The heading list keeps the
  historic `### … (both passes)`, so 10-06 to 10-12 are still judged against
  their own two-pass schedules.
- **What proved it.** A morning-only day with its report reads `ran`, and
  the same day without one reads `missed`, with one email. A test reads the
  real `docs/pm-pass.md`. All nine mutations went red.

**The landing-day catch.** Round 1's first major: the watcher reads the day's
schedule at midnight. Today's line still has 12:48. So if this lands before
today's evening pass, and the operator removes the fire, he gets a false
"PM pass missed: 2026-10-12 second". The stored prompt also names a section
this PR deletes. The fix is the landing order: land after today's
`## Evening` is on `main`, then change the Routine.

The evening pass's checks were not all dead weight. Morning step 6 now
carries the `evening-branches.mjs` guidance it had leaned on, and the script
stays. Morning step 1 now reads the 16:07Z send run, which only the evening
pass had read.

**(c) and (e).** "Do, date or drop" is gone from Mondays and from the budget
order. Item 97's eight chores now appear only in the open-asks line, and the
item says so.

The streak table's last state is still readable in git: the 10-05 rows, with
LAHI `clean` and four others naming the best-practices 78, and a streak of 0. No code or test read it. P1-33(c) still plans "the clean-send streak
computed in code", and that part is now moot. I left the row alone, because
any edit to it reflows the whole P1 table, and a whole-table diff conflicts with every other backlog PR.
Strike that part when (c) is next touched.

Old briefs in `docs/webflow-conversions-2026-10.md` and
`docs/prismic-migration-plan-2026-10.md` still say "two dirty review rounds".
They are left as written; `CLAUDE.md` governs a worker that pastes one.

**Round 2, and the hold.** Round 2 found 1 major, 3 minors and 1 nit.

- **The major.** The Routine change was written only inside item 107's
  `Closed` line, and pm-pass.md says a `Closed` line is never lifted. So no
  morning pass would ever raise it. If the operator does not edit the
  Routine, the 12:48 fire keeps running a prompt that names a deleted
  section, and the watcher, which reads pm-pass.md's Schedule line rather
  than the Routine itself, stays quiet. That is a configuration view read as
  the state, the second face of "Prove the instrument". It is now an open
  ask, item 111.
- **The minors.**
  - "The previous day's send run" missed Thursday's send. The morning pass
    now reads every send run since the last report.
  - The worker brief lacked the "a reproduced defect is never a minor"
    guard.
  - AUTONOMY.md's "every real finding is folded in" did not allow for filed
    minors.
- **The nit.** The example brief omitted the minors-only stop.

All five were fixed in the same push. This PR still ran under the old
two-round rule, so it went to "Operator decisions" (item 111) rather than to
a third round, with the operator asked to choose.
