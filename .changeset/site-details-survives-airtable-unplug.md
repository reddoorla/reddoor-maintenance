---
"@reddoorla/maintenance": patch
---

The site-details editor endpoint no longer returns 500 when `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` are absent (#539 Phase 6, #646) — the same gate step 2 dropped from the Resend webhook and #868 dropped from report-commentary. The field write now goes to Turso first and strictly (`mirrorWrite`); the Airtable `Websites` write stays as the rollback-window shadow while both env vars are set, and can still fail the request. With the env absent or half-set the shadow is skipped and logged as `AIRTABLE_SHADOW skipped=env-absent record=<id> column=<column>` (or `env-partial`). `setSiteDetail`'s field allowlist, per-kind validation and secret-field semantics (empty = unchanged, `__clear__` = clear), plus auth and CSRF, are unchanged.
