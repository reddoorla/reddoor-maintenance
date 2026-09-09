---
"@reddoorla/maintenance": patch
---

Prospect accuracy: a near miss no longer matches a business out of its own
letterhead, and no longer smuggles an `absent` past a partial read.

`findTerm`'s scattered match dropped every token shorter than five characters,
which drops words and not just initials. On reddoorla.com the claim "the
company's legal name is Reddoor Creative, LLC" lost `llc` — the only token
carrying it, and absent from all twenty pages — leaving "reddoor" and
"creative", the business's own name, seventy-two and fifty-four times over. The
phrase matched itself out of the site's letterhead, and the row was offered to
the reader as something related the site does say. The floor is three now:
initials and single digits are still skipped, words are not.

Separately, the scattered branch returned before the partial-read guard, so a
near miss could reach `absent` on a site we did not read whole — the one
verdict that guard exists to forbid. The guard runs first now, unconditionally,
and carries the near miss into the evidence either way.
