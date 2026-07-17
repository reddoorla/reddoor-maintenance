---
"@reddoorla/maintenance": patch
---

blux convert: a hero carousel slide now carries its secondary caption line.
A full-page hero slide is `stack[media, title, body]` — the title was the
caption but the body (the project location / design credits) was dropped.
carouselSlides now captures the first non-blank body/subtitle after the title
as a `subcaption`; the emit threads it to the page-doc item and the manifest
metadata. Proven on composition: the home hero now shows "Headquarters" over
"Ontario, California", etc. Empty hero bodies produce no phantom subcaption.
