---
"@reddoorla/maintenance": patch
---

Drafting writes the analytics soft-fail stamp to Turso FIRST, so the missing Airtable field can no longer blind the digest (#782)

Every real `report <slug> --type Maintenance` draft printed
`Unknown field name: "Analytics soft-fail at"` from the Airtable write — the
column is operator-added and, checked against the base on 2026-09-15, has
never existed there. The Turso mirror sat after that call inside the same
`try`, so `site_health.analytics_soft_fail_at` was never written either, and
the digest collector reading it was green on a question it could not fail.

The stamp is now built once (`analyticsHealthFields`) and written to Turso in
its own try before the Airtable shadow; each store's failure is logged naming
that store and neither costs the draft. The Airtable write stays, best-effort,
until Phase 6 (#646) deletes the shadow layer.
