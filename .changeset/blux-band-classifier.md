---
"reddoor-maintenance": minor
---

blux grid plan 2: band classifier + widget router. `classifyBand`/`classifyBands`
turn plan-1 `Band` trees into a typed `SliceSpec` IR — unambiguous shapes become
CMS-editable pattern slices (TitleBand, RichText, Hero, Gallery, MediaFull,
SplitFeature, VideoFeature, LocationMap), everything else falls back to a
render-faithful `Grid` spec carrying the raw node tree. Promotion is strictly
conservative: bands with surplus text, significant raw markup, or co-located
widgets stay `Grid` so no content is ever silently dropped. The map widget is
routed via an injected `isMapMount` predicate (plan 4 supplies the real one);
a 16-band classification golden over the-pointe pins the fidelity gate
(3 TitleBand, 1 Hero, 1 Gallery, 1 SplitFeature, 10 Grid).
