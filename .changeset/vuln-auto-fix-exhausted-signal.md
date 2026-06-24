---
"@reddoorla/maintenance": minor
---

Surface an "auto-fix failed" signal on the dashboard when Renovate has been
auto-dispatched for the same critical/high vulnerability across 3+ nightly
cycles without clearing it. A per-site `Security Auto-Fix Attempts` counter
(owned by `renovate-dispatch`: incremented on each real dispatch, reset when
the vuln clears) drives a distinct chip, filter, and summary tally so the
operator can tell "Renovate's on it" from "Renovate couldn't fix this — it
needs me". Inert until the Airtable Websites `Security Auto-Fix Attempts`
Number field is added.
