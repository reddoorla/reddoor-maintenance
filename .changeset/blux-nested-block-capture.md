---
"@reddoorla/maintenance": minor
---

blux convert: capture the nested block-in-cell mechanism the peel used to drop.
A grid cell holding a full Blux block pins its own box with inline `min-height`
(e.g. an 80vh panel), paints it via an abs-fill `block-background-layer`
(gradients the wrapper background-color capture never sees), and centers its
content with a valignmiddle container. All three now ride the card onto the
node style: `min-height`, the `background` shorthand, and the existing
`_valign` hint. Captured only inside a cell (like padding) — a band-level
container's min-height is the band's own full-height chrome, and band-level
background layers stay SectionBand territory. Found on the-tower band 1
(-808px vs live before capture); the same mechanism sizes its band 5 split.
