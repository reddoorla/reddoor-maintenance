---
"@reddoorla/maintenance": patch
---

Prospect audit: the sitemap check counted a site's downloads as pages it was
missing, and the sitemap parser counted its images as URLs it listed.

`sitemap-coverage` demanded a sitemap entry for every address a site's own links
point at — including 33 PDFs and images under one site's `/uploads/` and 85
under another's `/api/media/file/`. A sitemap lists pages, so an address is now
only counted as one when it has no extension or a page extension. `<image:loc>`,
the image-sitemap extension Squarespace, Wix and Yoast emit inside each `<url>`,
no longer counts toward the number of URLs a sitemap lists: one site was told it
listed 73 URLs when it lists 13 pages and 60 images. A sitemap entry that is a
confirmed alias of the page linked now counts as listing it, so a Squarespace
site serving its homepage at both `/` and `/home` is no longer told its homepage
is missing. `title-length` measures the pages a site publishes, the same list
`description-length` already used.

Over the 29-site corpus: 8 fails to 5, with the two loudest dropping 45 to 1 and
37 to 2. Every remaining claim was read against its stored crawl.
