---
"reddoor-maintenance": patch
---

fix(blux): recover captions nested inside a media holder + drop empty casliders

Two coupled parser fixes for the band-8 archetype (a captioned image slider):

- **Media-leaf caption capture (A):** Blux slider tiles nest the slide's caption
  (`block-title`/`body`/`subtitle`) INSIDE the `.camediaload[data-media]` holder,
  which the parser treats as an opaque media leaf — so those captions were
  dropped and the band degraded to a bare image gallery. `parseNode` now, when a
  media holder carries text descendants, emits the media PLUS the caption(s) as a
  `stack[media, …caption]`. This does NOT change the peel boundary
  (`isLeafElement`/`collectStructuralChildren` are untouched) — only the holder's
  own internal text is recovered. A pure-media holder (the vast majority) stays a
  bare media node, byte-identical.

- **Empty-caslider cleanup (G):** `parseContainer` now parses its structural
  children up front and drops any that collapse to an empty `raw` (an empty,
  JS-hydrated `.caslider` with no static slides), so a lone poster image is no
  longer misrepresented as `[media, empty-block]`. Non-empty raws (`[data-exec]`
  embeds, leaf anchors) always carry real html and are kept.

Fleet-regression verified against the real the-pointe export: only band 8
(`Gallery`→captioned `Grid`, its 3 captions restored) and band 12 (empty raw
removed) change; the other 14 bands — including the `.camediaload`-background
Hero/Grid/Split bands 0/1/7/9/11 — are byte-identical in the structural-signature
and classify goldens. The carousel *slice type* (rendering band 8 as a true
one-at-a-time slider) is a separate follow-up; band 8 is fully faithful as a
captioned grid.
