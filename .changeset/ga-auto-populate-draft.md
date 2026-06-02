---
"@reddoorla/maintenance": minor
---

Report drafts now auto-populate the analytics fields ("GA users (period)" / "GA users (prev period)") from the GA4 Data API, instead of requiring manual entry. At draft time, for any site with a "GA4 property ID" set, the CLI fetches `activeUsers` for the report period and the equal-length previous period and writes both into the Reports row (and into the rendered review HTML, so they agree).

Auth uses the service account via domain-wide delegation (impersonating a Workspace user) proven out on 2026-06-01 — configured with `GA_SUBJECT` (the impersonated user) and the service-account key at `GA_SA_KEY_PATH` (defaults alongside `credentials.env`), scope `analytics.readonly`.

Soft-fail by design: if GA isn't configured, the site has no property ID, or the API errors, drafting logs a one-line warning, leaves the fields blank for manual entry, and still creates the draft. GA is an enhancement, never a gate.
