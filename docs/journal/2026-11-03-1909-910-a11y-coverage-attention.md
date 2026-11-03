## 2026-11-03 — #910: a partial a11y run is Attention, and the skipped routes are stored

Landed in the PR that carries this file. Issue: reddoorla/reddoor-maintenance#910, queued by the operator 11-03 (backlog P1-82 group (2)).

**Re-measured against `main` first, because most of #910 had already closed.** The issue named two holes in 9-22. Both are shut on `main` today:

- Route counts are stored. #1005 (9-29) added `site_health.a11y_routes_scanned` / `a11y_routes_total`, and the cockpit's fleet table and site tile already print a partial run as "only N of M routes scanned".
- A fleet sweep runs a11y. `fleet-a11y.yml` (P1-78c, #1823) runs Sunday nights and writes the counts with `a11y_checked_at`.

Read SELECT-only from Turso at 10:49am PT 11-03: the first sweep stamped 18 sites between 13:53:52Z and 13:53:54Z on 11-02. All 18 read full coverage with 0 violations: 1 of 1 for six sites, 2 of 2 for five, 3 of 3 for two, then 4/4, 8/8, 9/9 twice and 10/10. The 19 other roster rows are null.

**What was still open.** Three things:

- **The Needs-you feed.** `collectA11yAlerts` reads only a complete run (scanned ≥ total). That is right for the findings count, which covers only the routes reached. But nothing else read a partial run, so a site that went from 2 of 2 to 1 of 2 raised no item anywhere: no card tier, no Needs-you row, no digest line. It was worse than invisible. A partial run with 4 findings also dropped those 4 findings off the feed, because the same filter excluded it.
- **The skipped routes.** These were never stored. A skip the site declares (an absent fixture, or the placeholder Prismic repo) leaves both counts since P1-78c. So 1 of 1 plus a skipped `/dev/animate-in` reads exactly like 1 of 1, and the skip was named only in a passing CI log.
- **The report gate does not apply.** `src/reports/report-fields.ts` reads no a11y column. The only a11y field a client report carries is Lighthouse's accessibility score ("Readability (A11y)"), which is a different instrument.

**The change.** `collectA11yCoverageAlerts` raises `a11y-coverage:<site>` ("accessibility scan reached only 1 of 2 routes") when a fresh run (8 days, as the findings) scanned fewer routes than it was given. Its kind is `a11y`, so the ladder already places it at Attention. By the P1-78 rule, coverage loss is the instrument losing its view, and a page a visitor cannot load is uptime's and render's to call Broken. It is registered on the cockpit (so on the card, Needs-you and `/s/<slug>`) and in the digest, so the item ages. `collectA11yAlerts` is unchanged, and its existing "partial run is not measured" test still passes as written.

The write-back stores `site_health.a11y_routes_skipped` (migration 0053) as JSON `[{ route, reason }]`. The value is written every run: `[]` when nothing was skipped, and null when the details carry no list, which clears the previous list rather than keeping it, as the counts do. The audit now puts the exact list it counted from into `details.skipped`, so the stored list can never disagree with the counts. The site tile appends "skipped /about (status 500)", naming up to three routes and then "+N more".

**What "configured" means here.** The brief asked for "scanned and configured route counts". The stored `a11y_routes_total` is the routes given, less the declared skips (P1-78c's decision `2026-10-27-1021-p1-78c-after-five-rounds` (a)), so it is not the raw configured count. The raw count is now recoverable: it is `total` plus the declared skips in the stored list. I did not add a third count column.

**Mutations.** Eleven, named in `tests/alerts/a11y-coverage.mutations.json` before they were run. The table is in the PR body.

**Not proven yet.** Migration 0053 runs on the first `openDb` after merge, so the column exists before Sunday. Nothing has stored a skip list in production yet. That waits on the 11-08 Sunday-night sweep (9:23pm PT, cron `23 5 * * 1`). A coverage drop on a live cockpit page has been seeded only in tests, not in Turso, because Turso stays SELECT-only outside the code's own write path.

One test fails in this container on `main` as well as here: `tests/scripts/dropbox.test.ts` "re-executes through HTTPS_PROXY" (the egress proxy). Three `continuity.md` line citations moved by one or two lines with the new imports and were re-numbered.

Usage: not readable (get_session reports no usage block on this session's first turn).
