---
"@reddoorla/maintenance": patch
---

Spam-classifier false-positive tuning: non-Latin script now scores on the message body only (never the name) at a reduced weight of 25 so it needs corroboration to cross the threshold; ambiguous vertical keywords (casino, weight loss, escort, payday loan, backlinks) narrowed to clearly-promotional phrasings so legitimate business enquiries no longer score; comma/semicolon-glued URLs now count individually instead of matching as one link.
