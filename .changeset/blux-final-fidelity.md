---
"@reddoorla/maintenance": minor
---

blux convert: three fidelity captures from the final live-diff pass. A LONE
width-constrained grid cell (grid-2-r60) keeps its row — the token is the
content column's width, and flattening it rendered the column full-width. A
peeled `valignmiddle` wrapper rides the node style as the `_valign: middle`
presentation hint (the original vertically centers that cell against its row
siblings). And the emitted anchor base gains `.links { text-decoration:
underline }` — an inline-block box does not inherit an ancestor's
text-decoration, so the link affordance must be declared on the anchor itself.
