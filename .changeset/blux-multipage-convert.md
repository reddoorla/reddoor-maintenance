---
"@reddoorla/maintenance": minor
---

blux convert: whole-site multi-page conversion. Every page of the export (the
homepage's root index.html plus each page dir's index.html) now runs through
the faithful-grid pipeline — previously only the home page did, and inner
pages existed solely as the archetype path's low-confidence block guesses.
`convertSite` assembles ONE IR from all page htmls (the asset urlMap then
resolves media that only appear on inner pages), emits one uid-keyed page
document per page, and writes a page-namespaced presentation manifest
(`{ pages: { <uid>: { bands } } }` — band indices are page-local, so a flat
map would collide). normalizePages pins the first page's uid to "home" (the
render's root-route contract), derives paths/uids from the source `url` when
set, and renames colliding uids with a diagnostic. Pages missing from the
export get a `missing-page-html` diagnostic and are skipped. The layout
report and map-config outputs are keyed per page. Proven on the
compositionHospitality export: 8/8 pages FAITHFUL, 36 bands.
