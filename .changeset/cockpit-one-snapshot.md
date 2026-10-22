---
"@reddoorla/maintenance": patch
---

The cockpit loads one snapshot of its working set per session, in one batched Turso call, and every page derives from it in the browser, so moving between `/`, `/fleet`, `/s/:slug`, `/submissions` and `/audits` asks the server for nothing. `openDb` takes `{ batchReads: true }`, which sends every query issued in one turn as a single `client.batch(…, "read")` and retries a failed batch statement by statement, so a defensive read still fails alone.
