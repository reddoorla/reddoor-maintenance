---
"@reddoorla/maintenance": minor
---

New export `@reddoorla/maintenance/smoke`: `measure(page)`, the mobile-overflow check the fleet's smoke specs each carried inline (`tests/smoke/mobile-overflow.spec.ts`), lifted from composition-hospitality#47 so it is fixed and tested in one place (#1892). It returns `{ scrollWidth, clientWidth, cut }`, as the inline copies did; `measureInPage` is the in-page function itself. Six holes in its cut-text check are fixed: an ellipsis is credited only on a block container, so a `flex truncate` link no longer passes cut text; ruby and `inline list-item` boxes no longer clip as an empty box; `transform`, `contain` and `will-change` on a plain inline span no longer count as a containing block; an outer `<svg>` clips its text; `clip-path: inset()` is resolved by the browser, so `calc()` and a reference box such as `margin-box` narrow as they paint; and `-webkit-mask-box-image` and an inert shadow host are honoured.
