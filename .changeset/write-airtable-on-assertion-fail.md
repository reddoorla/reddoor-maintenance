---
"@reddoorla/maintenance": patch
---

`audit --write-airtable` no longer refuses to write scores when the lighthouse audit fails because of assertion thresholds (e.g. best-practices below 0.9). The dashboard's whole purpose is to track those scores over time — refusing to push them when one assertion trips defeats the point.

New behavior: only refuse when the audit produced no scores at all (infrastructure failure — empty `details.summary`, e.g. no manifest written / spawn timeout). Real scores below threshold are written.

Extracted as `hasRealScores(result)` in `src/audits/lighthouse-airtable.ts` so the policy is unit-testable in isolation.
