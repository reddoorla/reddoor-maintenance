---
"@reddoorla/maintenance": minor
---

blux convert: materialize feed-grid tiles. Gallery/portfolio grids render
their tiles CLIENT-SIDE from feed records — the static export ships only the
`display:none` `{{…}}` template (dropped last round), so those bands
converted empty. `convertSite` now rebuilds the visible tiles
DETERMINISTICALLY from the feed data: a band whose site.json item declares
`sources` + `sourceConfig` is materialized into a Grid tile row —
`__media` sources resolve to the tag-matched library images (`&&`/`||` filter
DSL), a feed id resolves to its records (filtered, sorted, template-expanded).
Image urls reconstruct from the site's CDN base (`https://<host>/<siteId>/
<uuid>.<ext>`, the untransformed full-res base the export's own `data-base`
uses). The tiles are a normal Grid node tree, so they classify and render with
no new render surface. Proven on composition-hospitality: gallery 0→132
images, portfolio 0→524 project titles, every url resolves. Tile-ratio
cropping (the sourceConfig `ratio`) and big-list column layout are follow-ups.
