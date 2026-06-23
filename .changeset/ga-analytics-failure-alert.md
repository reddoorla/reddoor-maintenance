---
"@reddoorla/maintenance": minor
---

Fleet-wide GA/Search analytics-failure alerting + a role-account cutover runbook — closes the GA single-subject SPOF open loop (one impersonated `GA_SUBJECT` backs every site's analytics; if it loses access, all reports silently draft with blank analytics).

- **Dedicated alert email** from `report --due`: when GA/Search enrichment soft-fails across a _majority_ of analytics-configured sites in a run (the signature of the shared subject losing access), the operator gets one alert email (`assessAnalyticsAlert` + `composeAnalyticsAlertEmail`; best-effort, daily-idempotent). A lone/minority failure stays a per-site issue and does not alert.
- **Persisted per-site signal** on the cockpit + digest: drafting records a per-site `analyticsSoftFailAt` timestamp on the Websites row (set on a soft-fail, cleared on a clean enrichment), and a new `collectAnalyticsFailures` collector surfaces a `kind:"analytics"` Needs-attention item per failing site (self-healing, 45-day staleness). A fleet-wide outage surfaces it across many sites at once.
- **Runbook**: `docs/runbooks/ga-search-role-account-cutover.md` — the ordered, grant-before-flip procedure to move the impersonated subject to the `reports@reddoorla.com` role account.

⚠️ The persisted signal is gated on a manual Airtable step: add an **`Analytics soft-fail at`** date field to the Websites table. Until it exists, the write is swallowed (drafting is unaffected) and the collector emits nothing — the dedicated email works regardless.
