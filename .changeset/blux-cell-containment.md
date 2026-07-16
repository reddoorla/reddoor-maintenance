---
"@reddoorla/maintenance": minor
---

blux convert: preserve grid-cell containment and cell-level padding through the
peel. Three shapes the flatten used to drop: a multi-child `block-subcontent`
now parses to its own stack (the original contains each cell's block margins
via a block-content clearfix); a cell-level container's inline padding rides
onto the node it wraps even without a background (band-level container padding
stays excluded — that is the band's own content padding); and a padded wrapper
around a bare leaf or a multi-block group carries the box as a one-stack
wrapper applied once, never duplicated per child. Classification is unaffected:
pattern-matching sees through the synthetic style boxes (a SplitFeature media
cell that gained an inset stays SplitFeature).
