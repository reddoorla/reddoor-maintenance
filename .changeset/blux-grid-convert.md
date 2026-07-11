---
"reddoor-maintenance": minor
---

feat(blux): faithful-grid plan 5 — `blux convert` emits the Prismic page document
(text + band indices) and the `blux-presentation.json` render manifest (layout
tree + resolved media + block styles + map payload), keyed by band index. Media
is Prismic-hosted: `convert` writes CDN urls + the asset list, and `blux migrate`
uploads the assets and rewrites the manifest urls to Prismic for durability.
Parser fix: Blux custom-code embeds (`[data-exec]`, incl. the map mount) now
survive as `raw` leaves instead of being peeled away.
