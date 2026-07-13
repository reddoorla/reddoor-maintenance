---
"@reddoorla/maintenance": patch
---

Forms hardening from the espada form-e2e investigation: (1) `submitToIngest` now bounds the site→central call with an abort budget (`timeoutMs`, default `INGEST_TIMEOUT_MS` = 8s) — a central function hung mid-deploy previously left the visitor's submit awaiting until Netlify killed the site function at its 10s limit, returning a broken response instead of the friendly error copy. (2) The form-e2e live runner now captures the action POST status (+ error-body snippet on ≥400) and any `role="alert"` text when the success banner never appears, so a failing site names the real server response instead of an undiagnosable "no success banner after submit".
