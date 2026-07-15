---
"@reddoorla/maintenance": minor
---

blux convert: capture a peeled card wrapper's content padding alongside its
background. A Blux card's `.blocksN` fill carries the background-color while its
`.blocksNcontainer` carries the content inset (e.g. `padding: 100px 4% 80px`);
the layout-wrapper peel dropped the latter, so restored cards rendered with the
fill hugging their text. The padding now rides onto the card's `style` too —
gated on a background being present, so a plain band container's inset (handled
via blockClass defaults) is never double-captured. Fixes the-pointe band 3's
stats card and its band-14 listing cards.
