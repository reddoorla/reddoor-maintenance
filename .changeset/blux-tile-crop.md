---
"@reddoorla/maintenance": patch
---

blux convert: feed-grid tile cropping + overlay captions. Gallery/portfolio
tiles rendered at their natural (tall, varied) height with the caption in a
row below; the original crops each tile to `sourceConfig.mediaRatio` (4:3) and
overlays the caption ON the image (`layout: behind`, `overlay: true`), so a
tile is only as tall as its image. A tile image now carries `cropRatio` (the
render frames it in a fixed-aspect object-cover box) and, for an overlay grid,
the tile stack carries `_overlay`/`_overlayColor`/`_overlayValign` hints so the
render reveals a colored caption panel on hover. Proven on composition:
gallery band 1 15698px → 12036px (live 11087), band 2 3702px (live 3644) — the
tiles are now uniform 4:3 cards like the original.
