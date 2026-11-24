---
"@reddoorla/maintenance": minor
---

prospect audit: the crawl reads the pages a buyer would, and records what it read against what it knew of.

- The 20 pages are ranked, not sliced: the home page, then up to three contact-like links (contact, quote, demo, book a call, get started), then its `<header>` and `<nav>` links, then the sitemap and the home page's other links by path depth, with dated posts, post sitemaps, paginated lists and tag, category and author archives last. The cap is unchanged. A URL's identity is its address without tracking and sort keys (`utm_*`, `orderby`, `gclid`, …): one identity takes one seat and its clean address is fetched, while a variant with a content key (`?page_id=7`) is its own page, ranked after the distinct paths.
- The sitemap is found from robots.txt `Sitemap:` lines first, then `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`. A URL on another scheme or the other side of `www.` is read as the same site and fetched at the site's own address; how many there were is stored, and the new site check `sitemap-same-host` reports it.
- `crawl.selection` stores `pagesConsidered` (every page the crawl knew of before the cap), the sitemap's source and the off-origin count.
- analyze: a `yes` or `partial` whose quote cannot be matched becomes `unknown`, not `no`. A `no` becomes `unknown`, with `notFound: { term, page }`, when one of the question's key phrases appears in crawled text the model was not sent (past its window, or on a page it was not given) and that text is not shared with a window it was sent.
- goals: `qualifying-form` is `unmeasured` while a contact-like page the site links to went unread.
- The form probe presses only forms the static classifier calls an enquiry form, tries contact-like pages first, and names the form (`formProbe.form`, "the 8-field form on /contact") in the evidence.
