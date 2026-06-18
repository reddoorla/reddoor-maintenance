---
"@reddoorla/maintenance": minor
---

The announcement email's "WHAT TO EXPECT" section now spells out what each pace
covers: under "Full site testing" and "Routine maintenance" it lists that pass's
specific checks inline (middot-separated), pulled from the **same**
`testingChecklist` / `maintenanceChecks` copy arrays the monthly report renders —
so the announcement and the report can never drift. The now-redundant standalone
"WHAT WE MONITOR" block is removed (its items are covered by the expanded section
plus the score preview), and the unused `announceMonitorItems` copy key is dropped.
