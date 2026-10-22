---
"@reddoorla/maintenance": patch
---

form-e2e no longer calls an unreadable `/health` "does not declare forms.testMode" (P1-68). On 2026-10-22 vineyard-custom-homes, whose `/health` hardcodes `testMode: true`, timed out once at the 10 s limit and was listed as undeclared beside the two sites that have no form. The preflight now reads an unreadable `/health` (timeout, network error, non-2xx, a body that is not a JSON object) once more before refusing, and a refusal that stands is a skip naming why: `site /health could not be read (timed out after 10s) — probe refused, so this site was not probed`. The submit is still refused either way. fleet-form-e2e counts these as `unreadable=N` with their own warning naming each site and reason, keeps them on the `FLEET_FORM_E2E_UNCOVERED` line, and keeps them out of the undeclared warning.
