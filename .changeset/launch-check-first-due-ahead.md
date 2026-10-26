---
"@reddoorla/maintenance": patch
---

`launch-check` bounds a schedule's first report (the anchor day plus one cycle) at 366 days ahead, instead of the anchor day itself, so a Yearly anchor can no longer put the first report almost two years out.
