---
"@reddoorla/maintenance": minor
---

blux convert: mark the map widget's toggle-panel row in the presentation
manifest. The Blux clickMap widget switches the area below the map between N
sibling content panels (one per toggle — on the-pointe, the address grid plus
three hidden logo strips); structurally that is a row directly following the
widget:map inside a stack with exactly one cell per toggle. The row now emits
`panels: true` so the render can show only the active toggle's panel instead of
stacking all of them.
