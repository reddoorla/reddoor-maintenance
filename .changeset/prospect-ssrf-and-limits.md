---
"@reddoorla/maintenance": patch
---

Harden the prospect audit's entry point and cap its spend (2026-08-26 review).

#619 closed the nested-sitemap SSRF while this was in flight. Two things it did
not cover remain, and both are here.

**A hostile index can no longer starve out the real children.** The guard was
applied inside the loop, after `.slice(0, 3)` — so three hostile entries at the
top of a sitemap index consumed the whole budget and the site's genuine child
sitemaps were never fetched. The crawl then silently sees fewer pages, which is a
quieter failure than the SSRF itself. Filtering now happens before the cap.

**The entry host is checked before the first fetch.** The redirect guard has
always covered where a hostile site can send us _second_; nothing covered a
caller pointing the crawler at an internal address to begin with, and the CLI
validated only `isHttpUrl` — so one fetch of `169.254.169.254` happened before
the throw. Both `crawlSite` and the CLI now refuse.

**A 24-hour cap on dispatches.** The duplicate window stopped the same URL being
re-run; nothing stopped distinct URLs, so one session could dispatch ~30/minute
against 30 hostnames indefinitely — and one audit is structurally an Opus call
plus up to 28 Sonnet calls with up to 112 billed web searches, a 20-page double
crawl, a 3-pass Lighthouse and a PDF render in a billed Actions job. It is a
runaway brake, not a quota: far above real use, answering 429 with both numbers.
A repeat of the same URL still reports `duplicate`, so it neither consumes the
budget nor gives a confusing answer.

**The private runner no longer takes a `ref` input.** `reddoor-maintenance` is
public, so `refs/pull/N/merge` exists for any PR anyone opens; a dispatch naming
one would run a stranger's build in a job holding Turso, Resend and Anthropic
secrets.

**The health check is behind the operator gate.** It leaked no values, but
`DASHBOARD_PASSWORD: true` is the reconnaissance step for using that fallback.

Also closes the deprecated `::a.b.c.d` IPv6 form in `isPrivateOrLoopbackHost`.
