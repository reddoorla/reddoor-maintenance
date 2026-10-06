## 2026-10-06 — The operator's answers to the two-touch review; the journal becomes one file per entry

The review of the operating model (in the private `reddoorla/reddoor-workspace`, at `reviews/2026-10-06-two-touch-review/`) ended with six questions. The operator took every default.

1. **Cutover timing and name.** The home base keeps the name `reddoor-workspace`. The cutover comes after the Thursday 10-22 second pass, once the session-shape probes have run (after the usage reset on 10-11 09:00Z) and this journal change has been on `main` for a week. That keeps it clear of the 10-14 Williamson and 10-19 Webflow dates.
2. **One file per journal entry: yes, now.** This entry is the first. `docs/workJournal.md` is frozen with a line at its top, and `tests/docs/journal-frozen.test.ts` fails `build` on any change to it except a `> Superseded` pointer.
   - The test was proven on the real file: green as committed, red on a scratch appended entry, and green when only a pointer is added.
   - Two mutations of its logic both turned tests red: dropping the pointer filter, and dropping the blank-line collapse.
   - The reason is measured: the journal was in 183 of the 230 conflicted merges from `main` in the week after 09-29. A merge queue would not fix that, because it cannot resolve text conflicts. Separate files can't conflict. This repo already works that way for changesets: 141 fragment files in 30 days.
3. **`AUTONOMY.md` stays here.** `tests/build/autonomy-prismic-clause.test.ts` reads it by path, so moving it would turn `build` red. The home base will link to it.
4. **The home base may hold two non-prose files:** a `.claude/settings.json` deny list (the only push control a private repo on GitHub Free can have) and, after the cutover, the missed-pass watcher. Scripts stay here.
5. **The merge contract.**
   - After two dirty rounds, the worker will run round 3 itself, once a calibrated reviewer prompt passes its known cases. That part is queued as P1-33, not built.
   - A dirty round 3 that is fully fixed still holds for the operator.
   - `AUTONOMY.md` now names the third path that has happened at least 8 times: landing with a reviewed finding still open, on his word.
6. **The second PM fire moves from 17:48 to 12:48 PT; 04:48 stays.**
   - Since 09-29, none of 42 operator session starts or 40 answers fell near the 17:48 read. 11:00–15:00 PT is when he answers most, and by 19:48Z the day's nightlies have finished.
   - `pm-pass.md` now describes the new time, and the stored prompt no longer carries clock times ("on its schedule").
   - The Routine's cron is changed with `update_trigger` once tonight's 17:48 pass has run, so tonight's pass is not skipped and Wednesday 12:48 is the first moved fire. Per the review, it is the only Routine change made until a scheduled fire has proved it.

Everything else the review recommends is queued as P1-33 in `docs/BACKLOG.md` for the passes to rank and the operator to start, one item at a time. It excludes the decision-file format and the home base's own `CLAUDE.md`, which belong to the cutover.
