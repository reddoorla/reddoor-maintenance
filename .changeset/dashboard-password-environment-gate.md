---
"@reddoorla/maintenance": patch
---

The `DASHBOARD_PASSWORD` fallback is no longer accepted on the production
cockpit once Google sign-in is fully configured there. It grants full operator
rights and reports no identity, and its stated purpose — deploy previews, and
the first day of the rollout — expired when Google sign-in went live. Deploy
previews, local runs, and any deploy without a working Google configuration are
unaffected.
