---
"@reddoorla/maintenance": patch
---

perf(db): indexes for every hot-path query, enforced by an EXPLAIN-query-plan gate

Migration `0008_query_plan_indexes` adds the indexes the request-path queries
actually need — `submissions(submitted_at DESC)` (windowed reads and the
/submissions default page), a partial covering index on `spam_reason` (the facet
tally the gate caught full-scanning), `resend_message_id` (webhook bounce
lookup), `submission_id` (O(1) display numbers), and `spam_screenouts(date)`.

The new gate (tests/db/query-plans.test.ts) captures every statement the db
modules execute at the driver, runs each through EXPLAIN QUERY PLAN, and fails
the build on any raw full-table scan — with module- and export-completeness
checks so a new Phase 2 reader module or query function cannot dodge it, and a
vacuity check so a scenario that executed no SQL fails instead of passing.
