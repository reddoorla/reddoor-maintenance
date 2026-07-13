---
"reddoor-maintenance": patch
---

fix(blux): parse the grid `-s<N>` suffix as spacing, not a cell width

The Blux grid token `grid-1-s40` / `grid-any-s20` encodes the grid's inter-cell
spacing (matching `data-spacing`), with the real column count in `data-columns`.
The parser was storing that `s` value as `sized` and the render layer treated it
as a width percentage — so a single-column stat list (`grid-1-s40`, four items)
rendered as a 40%-wide 2×2 grid instead of a full-width vertical stack. Renamed
the token field `sized` → `spacing` and stopped using it for width; cell width
now comes only from `cols`/`ratio`, faithful to what the export encodes.
