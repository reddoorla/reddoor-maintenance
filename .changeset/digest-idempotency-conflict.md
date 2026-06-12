---
"@reddoorla/maintenance": patch
---

fix(digest): a same-day `report --digest` re-run whose content changed (e.g. a manual re-dispatch after new signals appeared) no longer fails. Resend returns a 409 when an idempotency key is reused within 24h with a different body; the digest now treats that as a graceful "already sent today" skip (exit 0, no duplicate email, no state write) rather than throwing — which previously reddened the daily run and opened a false tracking issue. A genuine send/network failure still exits 1 loudly.
