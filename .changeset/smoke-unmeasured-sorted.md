---
"@reddoorla/maintenance": patch
---

`formatUnmeasuredSmokeSummary` lists never-measured sites sorted by name (#1677). The audit pool returns results in completion order, so the `FLEET_SMOKE_UNMEASURED … sites=` line and the never-measured message used to change order from night to night.
