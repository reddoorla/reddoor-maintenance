---
"@reddoorla/maintenance": patch
---

fix(lighthouse): deployed-URL audits get the same 5-minute spawn budget as the checkout path (was 3), so a slow site's three cold runs don't time out into a spurious "no scores".
