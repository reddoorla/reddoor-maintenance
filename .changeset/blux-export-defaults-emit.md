---
"@reddoorla/maintenance": minor
---

feat(blux): emit export class-default padding + text-style deviations

`blux convert` now captures the Blux export's own layout defaults instead of
dropping them. `blockClassDefaults(siteJson)` reads each `.blocksNcontainer`
entry from `styles.blocks` and `buildPresentation` fills a band's
`_contentPadding` / `_contentPaddingMobile` / `_max-content-width` from that
class default whenever the block's own styles omit the key (the mobile override
only ever pairs with a filled default). Text-leaf `style` deviations captured by
the parser — inline color/padding and decoded `margin-N{r,l,t,b}` utilities —
now pass through to the render manifest's heading/body/subtitle nodes.
