---
"@reddoorla/maintenance": patch
---

`ensure-site` now dual-writes a new site into Turso (#539 Phase 5).

Bootstrapping is the only path that CREATES a Websites row, and every site
mirror built so far is an UPDATE — which does nothing at all for a row that does
not exist yet. So a site bootstrapped at 09:05 stayed invisible to Turso until
the 09:20 sync, and every mirror the rest of the bootstrap fired afterwards
reported `mirrored=missed` because there was no row to update.

`mirrorSiteInsert` maps with the importer's own `mapWebsiteRecord` — the same
function parity diffs against — so the rows are parity-clean by construction
rather than by a column list someone has to remember to extend. Its test asserts
that directly: mirror one record, import the same record, demand identical rows.

All three rows go in, not just `sites`. Parity reverse-checks `site_health` and
`site_schedule` per site and reports a missing one as `(row) ABSENT`, and a later
`mirrorHealthFields` would return `missed` forever with no row to hit.

It upserts rather than inserts, because `ensure-site` is re-run to resume a
bootstrap. A stored header image survives that by construction:
`mapWebsiteRecord` does not carry the `header_image*` columns (Airtable stopped
being their source, design D5), so the conflict branch cannot blank a plate whose
bytes live in no other store.

The fill-blanks path is mirrored too — a resumed bootstrap that only filled a
blank `url` would otherwise leave Turso stale until the next sync.

Airtable stays authoritative; this is a dual-write, not a cutover.
