---
"@reddoorla/maintenance": patch
---

`launch-check` bounds a schedule's first report (the anchor day plus one cycle) instead of the anchor day itself: a first report more than 396 days out is refused, so a Yearly anchor may sit about a month ahead but no longer put the first report almost two years away. A first report past the year 9999 is named as such instead of as a garbled date.
