---
"@reddoorla/maintenance": patch
---

The accuracy pass reads what the crawl retrieved, and the result carries the site's own size (#677)

Our report said "we read 14 of your 20 pages" about a site whose sitemap lists 49. Both numbers were ours — a private cap inside `accuracy.ts` and the crawl's
cap — and neither was a fact about the prospect. That is our ceiling reported as
their total, which is the one mistake this report keeps having to be stopped
from making.

`MAX_PAGES` in the accuracy pass was 14 against a crawl cap of 20, so the stage
stopped six pages short of what had already been fetched. An unread page is
exactly where an `absent` verdict becomes a wrong claim about somebody's
business, and the second cap bought nothing: `MAX_TOTAL_CHARS` is the real bound
on prompt size and still applies. It now matches the crawl.

`AccuracyResult.siteUrlCount` is the site's own declared size from its sitemap,
or null when there is no sitemap to read it from — null meaning "we never
learned how big the site is", never "the site has no other pages". `pagesTotal`
is unchanged in value and keeps its name, because it is persisted into
`prospect_audits.result_json` and read by the website's renderer; its docstring
now says plainly that it is how many pages we crawled and never how many pages
the site has. When `crawl.sitemap.truncated` is set the count is a floor rather
than a total; that flag stays on the crawl, which every consumer of this result
also holds, rather than being duplicated.

Separately, the duplicate-fix half: `mergeFixes` dedupes on `addresses`, and
every fix `measuredFixes` wrote passed `addresses: null`, so there was never a
handle to match on — which is how "Give 2 pages a top heading" (measured) and
"Give the two pages with no h1 a proper headline" (model) both reached the same
report as fixes 2 and 10. The measured fixes now carry stable keys
(`headings-h1`, `meta-canonical`), so the existing dedupe can fire when a model
fix is tagged with the same key.

**Not done, deliberately:** sampling pages by sitemap priority. `crawl.ts` parses
only `<loc>` — `<priority>`, `<lastmod>` and `<changefreq>` appear nowhere in the
crawler — so there is no priority to sample on without first extending the
sitemap parser. `selectPages` already orders by path depth after the homepage,
which is a reasonable stand-in for "the pages a buyer lands on". The fuzzy
title-match option for the duplicate fixes was also rejected rather than shipped:
the two real titles above share only "give" and "pages", so any threshold loose
enough to catch them would drop unrelated fixes.
