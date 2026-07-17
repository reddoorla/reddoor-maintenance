---
"@reddoorla/maintenance": patch
---

blux convert: classify a full-page hero slider as a Carousel. A `.caslider`
whose slides are `stack[media, title, location]` (image + a heading + a
secondary body line) was rejected by the exact `stack[media, heading]` slide
match and fell through to the faithful Grid — rendering all N slides stacked
full-width (composition's home hero was 18 slides tall, ~18000px vs live's one
80vh frame). `carouselSlides` now accepts a slide whose first child is media
followed by text nodes, taking the title heading as the caption. The
secondary body line (the hero's location) is dropped until the single-text
caption model carries a second line — a flagged follow-up. Proven on
composition: home band 0 now a Carousel(18) at 80vh (~800px), not a
18000px grid; the-pointe/tower gallery carousels are unchanged.
