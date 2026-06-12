---
"@reddoorla/maintenance": minor
---

feat(cockpit): the fleet homepage is now a triage cockpit (M4 slice 1). Sites group into 🔴 Needs-attention / 🟡 Watch / 🟢 Healthy tiers (collapsible), with the approve queue pinned on top. Each card shows its live M5 signals — critical/high vulns, sub-75 Lighthouse categories, delivery bounces/complaints — badged NEW/WORSE to match the daily email digest (the Digest State snapshot is read read-only, never written from the page). A summary bar gives the tier counts + headline triage line and filter chips. Rendered entirely from already-persisted Airtable state (no request-path GitHub/Lighthouse calls) and rate-limited against brute-force. Renovate-failing / CI-red / staleness signals follow in slice 2.
