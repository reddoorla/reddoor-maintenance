---
"@reddoorla/maintenance": patch
---

forms: a lead whose site cannot be placed is never dropped silently again (#645)

Post-flip (#643) the form-ingest site lookup reads Turso alone, so a site with an
Airtable row and no Turso row answers `unknown-site` — and `unknown-site`
returned empty-handed: no row, no alarm, no recovery. It is the only failure in
the fleet that loses revenue-bearing client data silently and permanently, and
the one thing that currently notices a missing Turso row (`mirror_missed` in the
strict shadow write) is deleted by Phase 6 (#646). The migration plan's own order
puts this first.

Four changes, in #645's order:

- `ensure-site`'s `exists` path now probes Turso (`SiteMirror.hasRow`) and
  re-inserts the stored Airtable record when the row is missing, BEFORE its
  fill-blanks mirror update — which is an UPDATE that throws on a no-match under
  the freeze, so healing second would abort the command on exactly the site it
  repairs. The result carries `healedDbRow` and the CLI says so loudly.
- `ingestSubmission` dead-letters an `unknown-site` lead through the same writer
  the lookup-outage path uses. The HTTP contract is unchanged (still 404), so a
  site with a wrong slug still learns it; what changes is that the lead now
  exists. `/api/forms/:slug` is token-gated before any of this, so the slugs that
  reach the branch are fleet sites' slugs, not bots' guesses — the "junk slug"
  premise the old behaviour rested on was never the population it saw.
- `db replay-deadletters` resolves through the shared `makeLazySiteLookup`, so
  recovery and the live path agree about what the fleet is. It also stops opening
  the Airtable base eagerly: `readAirtableConfig()` throws on a missing PAT, so a
  replay that never consults Airtable was being refused outright with real leads
  queued.
- A `deadletter` attention kind reaches the digest and the cockpit, critical at a
  single row. A slug that resolves to no fleet site is named rather than dropped.

Consequently `unknown-site` is no longer a terminal replay outcome: `ensure-site`
can now heal the row, so burning it would make replay-before-heal lose every
queued lead — and that is the order a person reaches for first.
