# 2026-10-26 — Reports count engaged visits over a true 30-day Pacific window (P1-73)

Landed in reddoorla/reddoor-maintenance (this PR). Brief: home base `briefs/2026-10-26-p1-73-analytics-engaged-sessions.md`. Decision: `decisions/2026-10-26-1521-erp-analytics-bot-traffic.md`.

The operator held ERP Industrials' Maintenance 2026-10 report because its "906 Users ▲ 1%" read high. A read-only check that morning found 522 of the 932 users in the window were a data-centre bot fleet that arrived in July. He chose to count GA4 `engagedSessions`, labelled as visits, fleet-wide. Engaged sessions held flat at 180–400 a month through the bot surge, and they need no bot list to maintain.

**What changed, and why each piece.** Every report's analytics line (Maintenance, Testing, Announcement) now reads `engagedSessions` on the site's own hostnames. The window is the 30 days that ended yesterday in the property's own timezone, against the 30 before. Three defects went at once, because each would have kept the number wrong:

- The metric was `activeUsers`.
- The window was 31 inclusive days, labelled 30.
- Dates were cut with `toISOString()` (UTC) and included today. That is why the 12:16am PT 10-25 draft stored 906 where the finished data gives 940.

The timezone comes from the GA Admin API (`GET properties/{id}`) on every fetch, not from a stored column, so a property whose zone changes is read correctly. A property with no readable zone throws, and the draft soft-fails; it never silently falls back to UTC.

The GA window is now independent of the report's own period. It used to be the period from `derivePeriodStart`, so a quarterly report counted 91 days. Search Console still uses the period, unchanged. `ymd` is unchanged (it is still UTC, and is fed date-only values), so no due-date or schedule caller moved.

**The stored columns keep their names.** `ga_users_current` and `ga_users_previous` (the "GA users (period)" / "(prev period)" fields) hold engaged visits for any row drafted or refreshed after this lands, and users over the report's period before. No column records which metric a row holds. That was safe only because, at 8:31am PT, ERP's draft (`report_01M5RYS4D0Z59549ATS2QNPXFX`, unapproved, 906/898) was the only unsent report in the fleet.

**How ERP picks up the new number.** The cockpit's "refresh preview" (`report --rerender`) re-checked evidence and scores but never GA. It now re-measures the GA pair for an unsent, unapproved, non-Launch report through the draft's own `fetchGaVisits`. It writes the pair through `storeGaVisits`, which is guarded like `storeLighthouseScores`, and names the outcome on the machine line as `ga=… ga_change=…`. That is the supported path, so ERP needs no hand-written UPDATE.

**Measured.**

- On `origin/main` the dry-run selftest reproduced "932 Users ▲ 5% vs the previous 30 days (886 → 932)" exactly. The bogus-host control (`no-such-host.invalid`) gave 0/0.
- On this branch, at 8:58am PT, the same dry-run gave "217 Engaged visits ▲ 5% vs the previous 30 days (206 → 217)" for 09-26..10-25 against 08-27..09-25. The control gave 0/0 through the new fetch.
- 217 matches the morning check's engaged-sessions figure. The previous figure is 206, not 215, because the previous window shifted one day.

**Mutations.** All six from the brief turn tests red:

1. `activeUsers` instead of `engagedSessions`.
2. Ending on today.
3. 31 inclusive days.
4. A UTC cut.
5. The old "Users" label.
6. No hostName filter.

Review lens 3 then showed that deleting both of `storeGaVisits`' guards turned nothing red, because every caller test mocks the store. A Turso-level test now pins the guards, and the mutation turns it red.

**Review.** Round 1 (3 lenses) was dirty:

- **Blocker:** the query-plan gate wanted a `storeGaVisits` scenario.
- **Major:** the store's SQL guard had no test.
- **Minors:** a Launch row would have picked up GA numbers it never shows, and a cockpit tooltip was inaccurate.
- **Nits:** six stale comments.

All were folded in. Two other "majors" were answered rather than built:

- **Lens 2: an approved pre-P1-73 row would send old users under the new label.** No such row exists: measured, only ERP is unsent, and it is unapproved.
- **Lens 1: yesterday is complete by the clock but may still be processing in GA at a midnight-PT draft.** True. But the brief defined the window this way, and changing it redefines "complete", which is the operator's call. Filed as #1724. The approve race (#1725), withdrawn-row refreshes (#1726) and an Admin-call duplication (#1727) are filed too.

**Belief corrected on contact.** The brief's own `07:16Z` example cannot tell a UTC cut from a Pacific one: at 12:16am PT the UTC and PT dates are both 10-25. Only a late-evening PT instant, such as 10:30pm PT (05:30Z the next day), separates them. The tests use both instants.
