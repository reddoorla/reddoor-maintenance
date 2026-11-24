# 2026-11-23 — The cockpit model drops its spam and auto-filtered fields

Lands in the PR for reddoorla/reddoor-maintenance#2253, the follow-up to #2248.

#2248 took the submissions lane off `/triage` and kept `CockpitModel.spam` and `.autoFiltered`, documented as unrendered, under fork (iii). The operator, about 11:30am PT: "drop the unused spam and autoFiltered fields too". So they go, with the two positional parameters of `buildCockpitModel` that fed them (`spamTotals`, `autoFilteredCount`), the loader's `countAutoSpamSince` read on every `/` load, the snapshot's 7-day auto-filtered count, the two inputs `scripts/pm-cockpit.mts` threaded through for the nightly `fleet_daily` writer, and `countAutoSpamSince` itself, which nothing else called. The `submissions` list stays: he named the two fields, and it still fills the `/fleet` card chips.

**What stays, and why.** The nightly digest still writes `spamTotals` into the stored cockpit roll-up, and `readCockpitRollup` still validates it. Nothing in the cockpit reads it now. Changing the stored row's shape is a schema change to digest state, outside "drop the fields".

**How the parameters came out.** Removing two positional parameters shifts every later argument at 22 call sites. I removed them with a script over the TypeScript AST, which listed every argument it dropped. All were `null` or `0` except three fixtures that had fed the old lane. Done by hand, a slip would have type-checked whenever two adjacent parameters shared a type.

**Beliefs corrected on contact.**

- Dropping two fixture cases broke 32 DOM tests: they pick cases by position (`cases()[10]`). The two cases stay in their slots as empty models.
- The "readCockpitRollup fails" degrade test went green-for-the-wrong-reason: with the spam totals gone, the roll-up reaches `/` only through bounce counts, and its seed of one bounce sat under the alarm threshold of two. Failing the read changed nothing, so `not.toEqual(whole)` failed. The seed is now at the threshold, so the roll-up raises its alarm and its failed read shows.
- Mutation 1 (the field back on the model) first ran nothing: the test setup's tsup DTS build refused the type error before any test started. With the type field restored too, 9 `page-data-waves` snapshots fail. Mutation 2 (the auto-spam read back in the loader) fails "/ reads everything in one wave".

**Test changes:** `page-data-waves` expects 9 queries per `/` load, not 10, and loses the `countAutoSpamSince` fault case; its snapshots lose both fields and gain the seeded bounce alarm. `tests/db/auto-spam-count.test.ts` and the `countAutoSpamSince` query-plan scenario go with the function.

Full suite: 14630 passed, and the 2 failures that fail on untouched `main` in this container too (`t4-plan-task`, `dropbox.test.ts`).

Usage: $4.51 since the previous entry ($11.14 for the session), 3724/26568 tokens, 16443150/85789 cache since then, rate limit allowed
