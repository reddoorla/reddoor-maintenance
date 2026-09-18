---
"@reddoorla/maintenance": patch
---

The report approve/override endpoint no longer returns 500 when `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` are absent (#539 Phase 6, #646) — the same gate step 2 dropped from the Resend webhook and #868 dropped from report-commentary. Both writes (the plain approve and the logged send-anyway override) now go to Turso first and strictly (`mirrorWrite`); the Airtable stamp stays as the rollback-window shadow while both env vars are set, and can still fail the request. With the env absent or half-set the shadow is skipped and logged as `AIRTABLE_SHADOW skipped=env-absent` (or `env-partial`). The `TURSO_DATABASE_URL` gate, CSRF, `requireOperator`, the already-sent / not-draft-ready no-ops, the send-blocker gate and the override's audit trail are unchanged.
