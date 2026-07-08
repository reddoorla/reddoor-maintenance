---
"@reddoorla/maintenance": patch
---

fix(blux): read display text from `title`/`body`, not the `_title`/`_body` style objects

Blux stores a block's display text in `title`/`body`; the underscore twins are
per-element style config where `class: "disable"` hides the element on the
rendered site. The normalizer preferred the style object and stringified it,
migrating literal "[object Object]" text (230 spots on thePointe) plus 66
disabled editor labels that never render. Text now comes from the right field,
disabled elements are omitted, and the archetype rules gain honest signals:
a background image/video alone is a hero (Blux text-less banners), and media
next to any visible copy stays a media_text instead of falling to the bare
fallback and losing the image.
