---
"@reddoorla/maintenance": patch
---

The one-off Websites writers now dual-write into Turso (#539 Phase 5).

Phase 3 mirrored the nightly sweep — the fleet audit write-back, github-signals
and the next-due dates. It did not touch the writers that run on their own
schedule or on demand, so each of these reached Turso only via the hourly sync,
which stops existing at the freeze:

- `updateAnalyticsHealth` (drafting and announce) — the per-site
  analytics-failure signal the cockpit reads
- `updateAutoFixAttempts` (nightly Renovate dispatch) — the "auto-fix exhausted"
  chip's counter
- `updatePrismicModels` — the model-drift verdict, checked-at and detail
- `updateLaunched` (a Launch send) — Status **and** `Launched at`
- `updateSiteField` (forms-notify-target) — the verify-mode Status flip
- the **single-site** audit write-back, from `audit --write-airtable` and
  `launch`; only the fleet path ever passed a mirror

`makeSiteMirror` covers them with two ops, because a Websites row is split across
two Turso tables: `health` for `site_health` columns and `site` for `sites`. Each
takes the exact FieldSet the Airtable writer returned — the four writers that did
not return theirs now do — so the mirror cannot carry a different payload than
the write it shadows.

`mirrorSiteFields` is the new multi-column form of `mirrorSiteField`.
`updateLaunched` is why: it flips `Status` and stamps `Launched at` in one
Airtable update, and mirroring those separately would open a window where Turso
says a site is maintained but never launched.

Like `makeReportMirror` and unlike the Phase 3 factories, it never returns null.
Every write emits `SITE_MIRROR site=X op=health|site mirrored=1|missed|0|absent`,
so an absent line means the wiring is gone. `missed` is its own outcome: the
UPDATE matched no row because the sync has not imported that site yet, which is
neither a success nor a failure.
