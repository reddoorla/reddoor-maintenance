## 2026-11-03 — #910: a partial a11y run is Attention, and the skipped routes are stored

Landed in the PR that carries this file. Issue: reddoorla/reddoor-maintenance#910, queued by the operator 11-03 (backlog P1-82 group (2)).

**Re-measured against `main` first, because most of #910 had already closed.** The issue named two holes in 9-22. Both are shut on `main` today:

- Route counts are stored. #1005 (9-29) added `site_health.a11y_routes_scanned` / `a11y_routes_total`, and the cockpit's fleet table and site tile already print a partial run as "only N of M routes scanned".
- A fleet sweep runs a11y. `fleet-a11y.yml` (P1-78c, #1823) runs Sunday nights and writes the counts with `a11y_checked_at`.

Read SELECT-only from Turso at 10:49am PT 11-03: the first sweep stamped 18 sites between 13:53:52Z and 13:53:54Z on 11-02. All 18 read full coverage with 0 violations: 1 of 1 for six sites, 2 of 2 for five, 3 of 3 for two, then 4/4, 8/8, 9/9 twice and 10/10. The 19 other roster rows are null.

**What was still open.** Three things:

- **The Needs-you feed, as I first read it.** `collectA11yAlerts` reads only a complete run (scanned ≥ total), which is right for a findings count that covers only the routes reached. Nothing read a partial run at all, so I built an item for it. Round 1 showed that no real run is partial; see below.
- **The skipped routes.** These were never stored. A skip the site declares (an absent fixture, or the placeholder Prismic repo) has left both counts since P1-78c, so a 1-of-1 row with a skipped `animate-in demo` fixture reads exactly like 1 of 1, and the skip is named only in a CI log.
- **The report gate does not apply.** `src/reports/report-fields.ts` reads no a11y column. The only a11y field a client report carries is Lighthouse's accessibility score ("Readability (A11y)"), which is a different instrument.

**The change.** `collectA11yCoverageAlerts` raises `a11y-coverage:<site>` ("accessibility scan reached only 1 of 2 routes") when a fresh run (8 days, as the findings) scanned fewer routes than it was given. Its kind is `a11y`, so the ladder already places it at Attention. By the P1-78 rule, coverage loss is the instrument losing its view, and a page a visitor cannot load is uptime's and render's to call Broken. It is registered on the cockpit (so on the card, Needs-you and `/s/<slug>`) and in the digest, so the item ages. `collectA11yAlerts` is unchanged, and its existing "partial run is not measured" test still passes as written.

**Belief corrected in round 1: "1 of 2" cannot reach Turso any more.** Two of three reviewers found it independently, and the code agrees. The spec's only skip branch (`a11y.ts:599`) writes one of two reasons. Both are in `DECLARED_SKIP_REASONS`, so `scanned = total` on every run. A route that answers an error is not a skip: it is a `route-missing` finding, and `collectA11yAlerts` already raises it. The new item is therefore a guard, and my first changeset and comment described a hole that #1823 had already reshaped.

The live case is the P1-78 close-out's (`journal/2026-11-03-1837-p1-78-close-out.md` in the workspace). On 11-02, CalTex, Espada and Revogen logged "1 of 2 routes" with `animate-in demo` absent and undeclared, a `warn`, and Turso stores 1/1 for all three. Whether an _undeclared_ absence should stay in the total, so those three sites read 1 of 2 and raise the item, is the operator's call. The 10-27 decision took absences out of the total without separating declared from undeclared. The ask is in the workspace's `decisions/2026-11-03-1933-910-undeclared-absent-fixture-coverage.md`.

Round 1 also found three test defects. The "clears the stored list" test seeded no list, so it could not fail; it now seeds one. The `details.skipped` change in `a11y.ts` had no test. The fixtures used a "status 500" reason that the spec never writes. One mutant I added for the clearing case, `undefined` in place of `null`, survived, but it was equivalent: the mirror writes a present key as NULL either way, so it still clears. The kept mutant leaves the key out.

The write-back stores `site_health.a11y_routes_skipped` (migration 0053) as JSON `[{ route, reason }]`. The value is written every run: `[]` when nothing was skipped, and null when the details carry no list, which clears the previous list rather than keeping it, as the counts do. The audit now puts the exact list it counted from into `details.skipped`, so the stored list can never disagree with the counts. The site tile appends "not scanned: animate-in demo (fixture not in this site's source)", naming up to three routes and then "+N more". The stored route is the spec's name for it, which is the path for an opted-in route and a label for a built-in fixture.

**What "configured" means here.** The brief asked for "scanned and configured route counts". The stored `a11y_routes_total` is the routes given, less the declared skips (P1-78c's decision `2026-10-27-1021-p1-78c-after-five-rounds` (a)), so it is not the raw configured count. The raw count is now recoverable: it is `total` plus the declared skips in the stored list. I did not add a third count column.

**Mutations.** Eleven, named in `tests/alerts/a11y-coverage.mutations.json` before they were run. Three more were added after round 1, for fourteen. All fourteen are red, and the table is in the PR body.

**Not proven yet.** Migration 0053 runs on the first `openDb` after merge, so the column exists before Sunday. Nothing has stored a skip list in production yet. That waits on the 11-08 Sunday-night sweep (9:23pm PT, cron `23 5 * * 1`). A coverage drop on a live cockpit page has been seeded only in tests, not in Turso, because Turso stays SELECT-only outside the code's own write path.

One test fails in this container on `main` as well as here: `tests/scripts/dropbox.test.ts` "re-executes through HTTPS_PROXY" (the egress proxy). Three `continuity.md` line citations moved by one or two lines with the new imports and were re-numbered.

Usage: not readable (get_session reports no usage block on this session's first turn).
