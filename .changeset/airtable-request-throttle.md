---
"@reddoorla/maintenance": patch
---

Throttle all Airtable HTTP at its single funnel so paging bursts stop tripping the per-base
~5 req/s limit. Even fully sequential `eachPage` paging fires fast enough that one cockpit load
scanning Reports + Submissions could exceed the cap and exhaust the SDK's 429-retry budget. The
shared `openBase` now wraps `base._base.runAction` — the one method every list/create/update/destroy
call funnels through — with a min-interval throttle (~220ms ⇒ ≤ ~4.5 req/s) that spaces request
_starts_ while preserving order. The SDK's built-in 429 retry stays as a backstop. The throttle
chain is fail-safe: a throw or rejection in one step can never stall the queue (which would
silently hang every subsequent Airtable call in the process).
