# 2026-10-21 — A Lighthouse category missing fleet-wide reds the write gate

**Where it landed:** branch `claude/1609-lighthouse-null-perf`, closing #1609. It builds on #1605's write gate (#1653). Brief: the workspace's `briefs/2026-10-21-write-gate-blind-spots.md`.

**Why.** `hasRealScores` passes on any one numeric category. With performance null on every site (NO_LCP), the fleet nightly printed `wrote=10 failed=0` and went green.

**The call not taken.** The brief's mutation list reads "hasRealScores back to `some`", which assumes the fix is `every`. `every` would throw away the three scores that did arrive, and it would file a NO_LCP site as a lighthouse failure. That contradicts `lighthouseScoresFromResult`'s own contract that a NO_LCP performance cell clears to "—". So `some` stays. Each category missing from scores that otherwise landed now counts in #1605's gate as `lighthouse.<category>`, judged against the sites where lighthouse scored at all. Missing fleet-wide is red; one site is a warning.

**Known-good.** Eight fleet-lighthouse nights, 10-14 to 10-21, have zero `n/a` actuals in any `LIGHTHOUSE_FAILURES` line. Every row was "all categories passing" except sonder's numeric SEO 0.85. `averageSummaries` averages over runs that scored, so NO_LCP on one or two of a site's three runs still yields a number. No recorded night would go red.

**Review.** Round 1's correctness lens found minors only. Its test lens found six surviving mutations, all of them missing tests rather than wrong code:

- a truncated category list;
- only performance's denominator tested;
- one category of two noted;
- a real 0 read as missing;
- categories hidden by another blind audit;
- categories counted only for sites whose write landed.

Each is now pinned. A category's reason reads "missing on", since its site's other scores were written.
