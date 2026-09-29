---
"@reddoorla/maintenance": minor
---

`initAnalytics` on `@reddoorla/maintenance/client` — one GA4 tag mechanism for the fleet, replacing four.

Nine repos carried analytics in four shapes: a raw inline snippet in `app.html` (seven sites, firing on `localhost` and every deploy preview), a hand-rolled deferred loader, a Svelte component with a hostname gate, and a GTM container. `initAnalytics({ measurementId, productionHost })` is framework-free, idempotent, SSR-safe, and inert off the production hostname and its apex/www twin.

The apex/www rule now lives in one place, `siteHostnames`, which both the tag's gate and the monthly report's Data API filter (`measuredHostnames`) import. Two copies would let the emit side and the read side drift, and a site that emits on a host the reader filters out reads as "no traffic" rather than as a bug.

Callers get an `AnalyticsOutcome` back rather than nothing, so the inert paths are distinguishable: `loaded`, `already-loaded`, `no-id`, `off-host`, `gated`, `no-dom`.
