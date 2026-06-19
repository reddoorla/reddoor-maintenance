---
"@reddoorla/maintenance": minor
---

Report checklist items can now auto-tick from verified signals. Phase 1 ships the engine
(`autoTickChecklist`, a `Checklist auto-evidence` snapshot on the report row, and green/amber
evidence badges on the dashboard beside each checkbox) and wires the first signal: **Google
Indexed** auto-ticks when Search Console shows the brand query on page 1 at draft time.
Fail-safe — a box auto-ticks only on fresh positive proof; a missing, soft-failed, or
not-on-page-1 signal leaves the box manual (amber, with the reason). The per-report human
approve gate and the operator's one-click override are unchanged.

Operator setup: add a **`Checklist auto-evidence`** (Long text) field to the Reports table
before the next draft run — drafts write the evidence snapshot there.
