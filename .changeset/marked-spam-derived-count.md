---
"@reddoorla/maintenance": patch
---

Fix: the "got through, marked spam" metric no longer double-counts when an operator re-marks a submission. It was an increment-only counter (`recordMarkedSpam`) bumped on every transition into `spam`, so toggling a submission spam → new → spam inflated the tally to 2, and un-marking never decremented — the per-site spam-through count on the cockpit could exceed the number of distinct spam submissions. `listScreenOutsSince` now DERIVES `markedSpam` from the rows themselves — a live `COUNT(*) FROM submissions WHERE status = 'spam'`, windowed by `submitted_at` — which is exact, idempotent under re-marks, and self-corrects an un-mark. It's also now arrival-dated like the honeypot/too-fast buckets (the old counter was mark-dated). No migration: the `recordMarkedSpam` increment is dropped from the status-change path and the legacy `marked_spam` column is simply no longer read.
