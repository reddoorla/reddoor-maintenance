---
"@reddoorla/maintenance": patch
---

feat(blux): Carousel slice type — slider bands emit slides + editable captions

A source slider row (`.caslider`) whose every cell is a media slide — bare or
captioned (`stack[media, heading]`, the band-8 archetype) — now classifies as a
first-class `Carousel` instead of the Grid fallback. The spec carries only what
the export structurally encodes: the slides, their caption text/role metadata,
and `data-columns` — no autoplay/duration/dots (the export encodes none, so the
fields are deliberately absent).

All five emit paths gain a carousel case:

- **Page doc:** `slice_type: "carousel"` with one item per slide in slide order
  (`{ caption }`, tags stripped; `{}` for an uncaptioned slide) — caption text is
  Prismic-editable and the render zips items to manifest slides by index.
- **Plan assets:** every slide's media is collected for upload.
- **Presentation manifest:** new `BandPresentation.carousel` payload — resolved
  slide media plus caption `{ level, role }` metadata and `columns` — and a new
  `RenderMedia.minHeight` field carrying the source holder's inline `min-height`
  (e.g. `80vh`) so a cover-frame carousel reserves the original's height.
- **Layout validation:** carousel slide-count completeness check (a dropped
  slide is a `media-dropped` finding, styled after the gallery check).
- **Manifest URL rewrite:** carousel slide urls rewrite CDN→Prismic like gallery.

Against the real the-pointe export only band 8 changes (`grid_band`→`carousel`,
3 captioned `80vh` slides, `columns: 1`); every other band is byte-identical in
the goldens and the structural-signature golden is unchanged.
