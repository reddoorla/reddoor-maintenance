---
"@reddoorla/maintenance": minor
---

form-e2e goes live, safely: the live Playwright runner now preflights each site's `/health` and refuses to submit unless it declares `forms.testMode: true` (strict boolean, fail-closed on any fetch/parse error) — a new `testModeUndeclared` outcome maps to a plain skip (no details, prior verdict preserved), distinct from the persisted no-form n/a. A site only becomes probe-eligible by shipping the starter's contact `buildPayload` forwarding and the `/health` declaration in the same deploy, so an armed fleet run can never deliver the probe as a real lead. New nightly `fleet-form-e2e.yml` producer (10:15 UTC, checkout-free, `REDDOOR_FORM_E2E_LIVE=1`) writes `Form E2E OK` + `Form E2E checked at` to Airtable with the same FLEET_WRITE_SUMMARY gate + tracking-issue alerting as fleet-smoke.
