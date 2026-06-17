---
"@reddoorla/maintenance": minor
---

A **Testing** report now gates on all 13 checklist items (the 6 maintenance items
plus the 7 testing items), not just the 7 testing ones. A testing pass also
performs the maintenance checks — and the Testing email already shows both lists —
so `checklistFor("Testing")` returns maintenance-then-testing, the dashboard
renders all 13 checkboxes, and approve/send stay blocked until every one is
checked. Maintenance reports are unchanged (still gate on their 6 items);
Launch/Announcement remain ungated.
