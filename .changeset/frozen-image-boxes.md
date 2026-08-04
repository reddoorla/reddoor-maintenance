---
"@reddoorla/maintenance": minor
---

blux freeze: record the box every image is painted into, as `frozen/<uid>.image-boxes.json`

A frozen page inherits whatever CDN variant the Blux export happened to use, and
that bears no relation to the size the browser paints it at. On the-pointe: a
5774px file (1.34MB) into an 823px box, 5341px into a 1425px band, 3960px
carousel slides into 1425x760 — 4.03MB of 5.06MB in images larger than their
box. That is page weight, and it is also what makes a cross-fade flash: waiting
for `decode()` is a race against a download seven times longer than it needs to
be.

The render can only ask a CDN for the right size if it knows that size, and the
size cannot be derived from the markup — Blux sets it in CSS, so an element
carrying `width:5774px` renders at 823. `settle` is the one point in the
pipeline holding a laid-out page, so it measures each media element there and
stamps `data-rd-box`; `bakeImages` reads it back where slot keys are assigned,
records `{w, h, source}` per slot, and strips the attribute again.

`source` is `data-size`, the widest render that actually exists. It travels with
the box because image CDNs upscale past it rather than refusing: asking a 123px
badge for 900px takes it from 4.9KB to 30KB. A consumer must treat it as a
ceiling.

Emitted as a sidecar rather than a field on each slot: the slots manifest is
what `migrate-frozen` PUTs into Prismic, and a painted box is a property of the
layout, not of content an editor owns.

Templates are unaffected — a freeze with measurements emits byte-identical html
to one without, asserted directly.
