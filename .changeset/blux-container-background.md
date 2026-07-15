---
"@reddoorla/maintenance": minor
---

feat(blux): capture a peeled card wrapper's background-color onto grid rows

`blux convert` was dropping the inline `background-color` on Blux "card"
wrappers (`.blocks0` divs with no grid token of their own), because the grid
parser peels those pure-layout wrappers to reach the structural content —
losing any background they carried. `collectStructuralChildren` now threads a
peeled wrapper's inline `background-color` down to the structural node it wraps
(the nearest wrapper wins, transparent ignored), and `withCardBackground`
lands it on the resulting `row`/`stack` node as a `style` deviation (same shape
as a text leaf's `style`; distinct from `Band.background`, a Media image). The
render manifest's `RenderNode` row/stack now carry `style?`. On the-pointe this
restores band 3's white stats card and band 14's white listing cards.
