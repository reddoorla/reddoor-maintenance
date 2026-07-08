---
"@reddoorla/maintenance": minor
---

blux emit: emit the `.txt-role-textN` utility layer into `theme.css`

`blux emit` now appends one `.txt-role-textN :is(h1…h6,p)` utility per text
role directly after the `@theme` block, generated from the IR's text styles.
A converted site imports the emitted `theme.css` and gets both the role
tokens and the utilities that map them onto headings/paragraphs — the same
CSS the-pointe hand-generated with a per-site script, now owned by the
pipeline so future conversions cost zero hand-tuning. Verified byte-identical
(all 14 roles) to the-pointe's hand-generated file.
