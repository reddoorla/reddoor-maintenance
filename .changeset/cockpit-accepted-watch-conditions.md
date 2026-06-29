---
"@reddoorla/maintenance": minor
---

Cockpit accepted Watch conditions. A new `Accepted Watch Conditions` Airtable Websites field lets the operator mark a watch condition (a Lighthouse category, stale repo, or no-custom-domain) as reviewed and accepted on a per-site basis. `assignTier` routes an accepted, currently-active condition out of the amber Watch band — an all-accepted site goes healthy and leaves the Needs-you feed + verdict count — while it stays visible as a muted "✓ accepted: …" chip on the Fleet-browse card. Acceptance is watch-only: a sub-floor (broken) Lighthouse score still alarms, so accepting "Best Practices 78" never hides a drop to 72. Ships dark until the Airtable field exists (`?? []` no-op).
