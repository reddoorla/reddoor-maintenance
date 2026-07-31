---
"@reddoorla/maintenance": minor
---

Generate report header images from a site's live homepage.

The per-site "Header image" was made by hand in Figma. 34 of 44 Websites rows had
none, which hard-fails `preflight` with `header-image-missing` — "the send will
throw" — and blocked 1836dig's launch report.

`reddoor-maint header-image <site>` screenshots the site's homepage and
composites it into the bundled plate, writing a local JPEG for review;
`--write-airtable` uploads it, and `--all` backfills every live site without one.

Report drafts now regenerate the header first, so the screenshot matches the
period being reported instead of whenever the image was last made by hand. Sonder
runs 16 reports a year, so a static header goes visibly stale. Regeneration is
best-effort: a capture failure keeps the stored image rather than failing the
draft, and the operator still reviews the rendered preview before approving.
