---
"@reddoorla/maintenance": patch
---

Three prospect-audit checks now say only what is true: the robots blanket-block check reads the `*` groups with the robots parser and decides on the patterns themselves (a `Disallow: /` aimed at one bot no longer fails a site that allows everyone, and `Allow: /$` no longer lifts a site-wide block); the price filter treats "fined" and "a fine of" as penalties, not prices; and the analyze prompt states today's date.
