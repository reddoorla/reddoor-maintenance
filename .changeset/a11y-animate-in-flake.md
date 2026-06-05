---
"@reddoorla/maintenance": patch
---

fix(audit/a11y): eliminate flaky color-contrast violation on animated routes

The a11y audit sampled pages while CSS transitions were still running, so axe
computed color-contrast against semi-transparent text mid-fade — producing a
flaky "serious" color-contrast violation (~1/3 of runs on `/dev/animate-in`).
The audit now disables transitions/animations before running axe, asserting the
resting state users (and `prefers-reduced-motion` users) actually see. Verified
8/8 clean over repeated runs that previously flaked ~1-in-3.
