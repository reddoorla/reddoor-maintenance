---
"@reddoorla/maintenance": minor
---

blux theme: carry each text style's own block margin into the role utilities.
Blux's vertical rhythm between stacked blocks is the text styles' margins
(e.g. Grid Titles' `10px 0`), which collapse in normal flow; the emitted
`.txt-role-textN` rules previously hardcoded `margin: 0`, flattening that
rhythm. The margin now rides the IR (`TextStyleIR.margin`), a
`--text-textN--margin` theme var, and `margin: var(--text-textN--margin, 0)`
in the role utility — roles without one stay flush exactly as before.
