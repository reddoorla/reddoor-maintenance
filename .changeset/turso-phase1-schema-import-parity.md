---
"@reddoorla/maintenance": minor
---

Phases 1.1–1.4 of the Airtable → Turso migration (#539): the writer map, the
fleet-state schema, the importer, and the parity harness.

The writer map (docs/superpowers/specs/2026-08-23-websites-writer-map.md) is
derived from the LIVE Airtable schema — the design's table split is no longer
provisional: every code-written column has exactly one writer, partitioning
exactly on the design's `sites` / `site_health` / `site_schedule` lines.

Migration 0007 creates those tables plus `reports`, PKs = Airtable rec ids
(design D1). Airtable's misspellings die at the boundary; the report checklist
re-keys from Airtable column names to the stable keys in checklist.ts;
`site_health.analytics_soft_fail_at` gives code the column no operator ever
created in Airtable. The 33 populated-but-unreferenced columns land in one
`sites.legacy` JSON object; the plaintext DNS/cms credential cells never
migrate at all (operator ruling 2026-08-23 — they live on only in the frozen
base), and the mapped output is tested to contain the secrets nowhere.

`db import-airtable` upserts idempotently: a re-run converges, never wipes a
regenerated header image (Airtable stopped being its source, D5), and keeps a
captured `rendered_html` when the attachment's signed URL has expired — misses
are named in the summary, never silent.

`db parity` diffs both stores field-by-field using the importer's own mapping
functions, so what parity expects is definitionally what the importer writes.
It emits `FLEET_PARITY … mismatches=N` on every run, count=0 included (an
absent line means "never ran", not "ran clean"), and its known-good pass —
green immediately after an import — is the first test in the file, per the
repo's prove-the-instrument rule.
