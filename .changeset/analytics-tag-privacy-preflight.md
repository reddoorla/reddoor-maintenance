---
"@reddoorla/maintenance": minor
---

`analytics-tag` refuses a site with no `/privacy` page, before anything is written. GA4's terms require a posted privacy policy that discloses its use, so the tag now waits for one. The check reads `src/routes`: a `+page` file at `/privacy` counts, through route groups and optional segments. A Prismic catch-all, an endpoint or a deeper `privacy` folder does not. The refusal names the fix, the starter's privacy page (reddoorla/reddoor-maintenance#1055). It applies to a re-run on a site that already carries the tag too.
