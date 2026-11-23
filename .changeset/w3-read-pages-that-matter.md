---
"@reddoorla/maintenance": minor
---

prospect audit: the crawl reads the pages a buyer would, and records what it read against what it knew of.

- The 20 pages are ranked, not sliced: the home page, then its `<header>` and `<nav>` links, then contact-like links (contact, quote, demo, book, get started), then the sitemap and the home page's other links by path depth, with dated posts, post sitemaps, paginated lists and tag, category and author archives last. The cap is unchanged.
- The sitemap is found from robots.txt `Sitemap:` lines first, then `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`. A URL on another scheme or the other side of `www.` is read as the same site and fetched at the site's own address; how many there were is stored, and the new site check `sitemap-same-host` reports it.
- `crawl.selection` stores `pagesConsidered` (every page the crawl knew of before the cap), the sitemap's source and the off-origin count.
- analyze: a `yes` or `partial` whose quote cannot be matched becomes `unknown`, not `no`. A `no` whose question's key words appear in any crawled page becomes `unknown`, with `notFound: { term, page }`.
- goals: `qualifying-form` is `unmeasured` while a contact-like page the site links to went unread.
- The form probe presses only forms the static classifier calls an enquiry form, tries contact-like pages first, and names the form (`formProbe.form`, "the 8-field form on /contact") in the evidence.
