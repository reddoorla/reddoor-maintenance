# 2026-11-18: P1-87 PR 6, the first real night of the traffic block

Landed in: reddoorla/reddoor-maintenance#2108 (a follow-up to PR 6, reddoorla/reddoor-maintenance#2085, which landed as `f91fa6e8`; carried on 7a's branch because 7a's tiles are the first reader of these numbers).

PR 6 added a `traffic` block to the nightly `fleet_daily` row. Its first real night is 2026-11-17, written at 2026-11-18T07:43:32Z (11:43pm PT on 11-17, from a night that began about 10:07pm PT). I read it from Turso with a SELECT only, Wed 11-18 about 7:45am PT. The row before it, 2026-11-16, has no `traffic` key, as expected for a night before the merge.

The numbers, as stored:

- `traffic.reason` is null: the block was measured.
- **Visits:** current 1,770 over 2026-10-19 to 2026-11-17; previous 1,493 over 2026-09-19 to 2026-10-18. `sitesRead` 16, `sitesWithProperty` 16. `daily` holds 60 entries, one per day across both windows.
- **Search:** 622 clicks and 12,508 impressions over 2026-10-18 to 2026-11-14, a 28-day window that ends three days back (Search Console's lag). `sitesRead` 16, `sitesWithProperty` 16. `daily` holds 28 entries.
- **Per site:** 18 sites. Four halves are unmeasured, each for a missing property, none for a failed read: visits on `recEFR4Kjy6hVhh7s` and `recSUY16OKTY7NUNb` ("no GA4 property"); search on `recADTWf6LCobVob0` and `recEFR4Kjy6hVhh7s` ("no Search Console property").

I checked the block against itself before trusting it: visits' current and previous each equal the sum of their window's daily entries (1,770 and 1,493), search's clicks and impressions equal their daily sums (622 and 12,508), and the per-site rows sum to the same four totals. So the totals, the series the tiles and 7b's charts will draw, and the per-site rebuild all agree on the first night.

One thing to know when reading the tiles: the visits window ends on the night (11-17) while the search window ends three days earlier (11-14), so the two tiles' periods are not the same 30 days. That is by design (PR 6's spec) and the How-we-count page says so.

Usage: not readable (the session's usage is in the workspace journal).
