# 2026-11-24 — The prospect crawl reads the pages a buyer would, and states its denominator (W3)

Landed: reddoor-maintenance PR from `claude/w3-read-pages-that-matter` (this entry rides in it). The website half landed earlier as reddoorla/reddoor-website#387 on `staging`. The card is W3 of the 11-23 audit-system review. Its brief, the three hand-offs and the decision files live in the workspace, under `briefs/2026-11-23-audit-w3-read-pages-that-matter/` and in `decisions/`.

**Why.** The crawl read `[home, ...sitemap].slice(0, 20)` in file order. A WordPress site whose sitemap lists its posts first therefore got 18 dated posts read and its services and contact pages never seen. The report then printed "not on the site" and "we read every page of your site" about pages it had never opened. That was B-04 in the review. The fix has three parts:

- rank the candidates;
- find the sitemap the way a site advertises it;
- store how many pages the crawl knew of, so every absence the report prints carries "in the N of your M pages we read".

**What the ranking is now.**

1. The home page, always first. `pages[0]` is what the site checks treat as home, and round 6 found a way to lose that.
2. Up to three contact-like links.
3. The menu: `<header>` and `<nav>`, but not a `<header>` inside an `<article>`, and not a footer nav.
4. The sitemap and the home page's other links, by path depth.
5. Last: dated posts, post sitemaps, paginated lists and tag, category and author archives.

The 20-page cap is unchanged, because raising it widens what we do to a stranger's server.

A URL's identity is its address with the non-content query keys stripped (`utm_*`, `orderby`, `sort`, `gclid` and the like). One identity takes one seat. Its clean member is fetched when one is listed. A variant that keeps a content key (`?page_id=7`, `?route=…`) is its own page, ranked after every distinct path.

The sitemap comes from robots.txt `Sitemap:` lines first (at most 5, `.gz` skipped, paced), then the three default addresses. `http://` and `www.` copies are read as the same site.

`sitemap.truncated` is now true whenever the count is not the whole site:

- an index child that was refused, answered with HTML, or is itself an index;
- a second robots-named sitemap that went unread;
- a skipped `.gz`.

That matters now, because W2's #2256 reads `truncated === false` as "the count is the whole site".

**The replay.** An offline, read-only replay of the new selection over all 78 stored rows is in the workspace decision file `2026-11-23-2346-w3-replay.md`. It ran through `openReadOnlyDb` and `assertReadOnly`, with no network. Six rows carry a sitemap sample:

- **Two rows** go from 18 dated posts read to 4 archive pages, and from 0 contact-like pages to 2. Services and FAQ pages fill the seats the posts held.
- **One row** goes from 17 news posts to none, with its about and how-it-works pages read instead.
- **One row** reads 9 pages its stored crawl never reached.
- **Two rows** are unchanged.

Across all 78 rows, 14 would read at least one new page.

**Beliefs corrected on contact.**

- *"Search the crawled text for the question's words before printing a `no`" sounds safe. It is not.* The first version flipped real `no`s to `unknown` on footer words ("address", "hours", "our team"). The second removed repeated six-word runs to strip boilerplate, which hid real answers in footers and repeated price tables. The third used single bare words ("payment", "delivery", "demo"), and those still matched by accident. The working rule took four rounds to reach:
  - only phrase-level terms count;
  - only a hit outside what the model was sent counts (past the 1,500-character window, or on a page it was not sent);
  - a hit whose surrounding 40 characters also appear in a window the model saw does not count, because that is the shared nav.
- *"Contact-like" is a narrower class than it looks.* Unqualified prefixes matched `/contact-lenses`, "Consultation tips", `/events` labelled "Schedule" and `/blog/how-to-book-a-trip`. On one fixture, contact links ranked first with no cap filled all 19 seats.
- *Query strings cut both ways.* Round 4 stopped `?orderby=` variants from filling seats, and round 5 found that the same rule dropped every plain-permalink WordPress site (`/?page_id=N`) to its home page alone. Round 5's fix then demoted a home page whose own address carries a query, and fetched utm URLs in place of clean ones. The fix that held is the identity-plus-allow-list rule above.

**Review.** Seven Opus rounds. Rounds 1 to 5 were dirty, and the five-round stop asked the operator. He approved a sixth round, which was dirty with three regressions from round 5's own fix, and then a seventh. The record is in the workspace decision file `2026-11-23-2255-w3-maintenance-round-5-stop.md`.

Fixers ran on Haiku from written finding lists. Three times a fixer stopped because a finding's rule contradicted an existing test, and I chose the narrower rule each time rather than edit an assertion:

- pagination variants keep their seats;
- content variants rank after distinct paths;
- a lone sort link is fetched as listed.

Round 6's (c) is filed as #2270.

**Honest accounting.**

- `cockpit/tests/legacy/recently-lane.ssr.test.ts` "keeps the lane at its cut of 20 rows" fails on `main` as well as here (checked 2026-11-24 06:15 UTC). It reads `new Date()`, so it is clock-dependent. Nothing in this change reaches it.
- Generated report text changed on the website, so an operator override on a stored report that matched the old `original` text no longer applies (named in #387).

Usage across the three sessions that built and reviewed this: about $18.28 (first session, which also built the website half) + $27.36 (second, which also ran the website's seven rounds) + this session's figure in the workspace journal.
