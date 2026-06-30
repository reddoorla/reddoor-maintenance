---
"@reddoorla/maintenance": patch
---

Fix: an announcement-time GA/Search outage now surfaces the per-site analytics-failure signal instead of silently hiding the traffic block. The `announce` recipe read only `.value` from the soft-failing GA/Search enrichment and never recorded `analyticsSoftFailAt` — so if Google errored during the monthly announcement run, the email's analytics block simply disappeared (reading identically to "site has no GA configured"), the operator got zero signal, and the client received a one-time onboarding email with the traffic section missing. `announce` now mirrors the `--due` draft path: when GA is configured for the site, a soft-fail stamps `Analytics soft-fail at` (driving the cockpit/digest alert) and a clean enrichment clears it so the signal self-heals. Best-effort write — the operator-added column's absence can't break the draft.
