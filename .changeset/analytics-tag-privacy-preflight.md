---
"@reddoorla/maintenance": minor
---

`analytics-tag` refuses a site with no `/privacy` page, before anything is written. GA4's terms require a posted privacy policy that discloses its use, so the tag now waits for one. The check reads `src/routes` for a page component (`+page.svelte`, `.md` or `.svx`) at `/privacy`:

- route groups, optional segments and rest segments add nothing to the path;
- symlinks are followed;
- a Prismic catch-all, an endpoint, a `+page.ts` with no component or a deeper `privacy` folder does not count.

A site whose `svelte.config.js` moves the routes (`kit.files.routes`) is refused with its own note. The refusal names the fix, the starter's privacy page (reddoorla/reddoor-maintenance#1055). It also applies to a re-run on a site that already carries the tag.
