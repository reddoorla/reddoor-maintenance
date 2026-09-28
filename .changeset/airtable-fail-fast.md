---
"@reddoorla/maintenance": patch
---

Airtable calls fail fast instead of hanging on a 429

`openBase` now builds the client with `noRetryIfRateLimited: true` and a 30 s
`requestTimeout`. The SDK's own 429 retry had no attempt cap, so a monthly-quota
block (`429 PUBLIC_API_BILLING_LIMIT_EXCEEDED`) hung every caller until its job
timeout. A quota 429 now rejects on the first response with a real `Error`
(`code: "AIRTABLE_QUOTA_EXHAUSTED"`). Any other 429 is retried after 2 s, 10 s
and 30 s, then rejects with `AIRTABLE_RATE_LIMITED`. A timed-out request rejects
with `AIRTABLE_TIMEOUT`. The raw attachment fetches take the same timeout, and
`resend-webhook` builds its client through `openBase`.
