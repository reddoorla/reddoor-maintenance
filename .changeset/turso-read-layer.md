---
"@reddoorla/maintenance": minor
---

feat(db): the Turso fleet-state read layer (#539 Phase 2)

`src/db/fleet-state.ts` — `getSiteBySlug` / `getSiteById` / `listSites` return
the exact `WebsiteRow` the Airtable module returns, so each Phase 2 repoint is
an import-only swap. Coercion reuses the Airtable module's own exported
coercers (one truth per field), pinned by a reader-equivalence instrument that
deep-equals `mapRow(record)` against the Turso read-back across rich, sparse,
and adversarial fixtures. `headerImage` deliberately reads from Turso's own
columns (design D5) — null until the Phase 3 header-image writer lands, so
approve-report keeps its Airtable reader until then. Also aligns the importer's
Accepted Watch Conditions array trimming with `mapRow` (whitespace-only entries
now dropped on both sides).
