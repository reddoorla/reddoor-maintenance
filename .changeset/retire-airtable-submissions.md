---
"@reddoorla/maintenance": patch
---

Retire the Airtable-backed submission and spam-screen-out code paths now that the dashboard runs on libSQL. Removes the dual-write soak shadow, the one-off backfill/reconcile scaffolding (kept `reddoor-maint db migrate`), and the Airtable `Submissions`/`Spam Screenouts` modules. The row shape + enum validators live in `src/reports/submission-row.ts`.
