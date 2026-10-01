---
"@reddoorla/maintenance": minor
---

A report draft the operator decides not to send can be withdrawn with "Don't send" on `/s/<slug>` (`POST /api/reports/:id/withdraw`). A withdrawn draft is stamped `withdrawn_at` / `withdrawn_by` (migrations 0038–0039), leaves every pending list, can no longer be approved or sent, and no longer holds back the next period's draft in `report --due`.
