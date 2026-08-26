---
"@reddoorla/maintenance": patch
---

Close the prospect-audit SSRF and add a runaway brake (2026-08-26 review).

**SSRF (proven).** A sitemap INDEX names child sitemaps, and the prospect writes
it — so those were attacker-chosen URLs reaching `fetch()` with no origin check,
no scheme check and no private-address check. The redirect guard 80 lines below
exists for exactly this threat and says so; this path had no equivalent. Child
URLs are now filtered to the crawl's own origin and public addresses.

Filtering happens **before** the three-child cap, not after: three hostile
entries at the top of an index would otherwise consume the whole budget and
starve out the site's real sitemaps. That was caught by the test's positive
control, not by inspection.

**The entry host is now checked before the first fetch.** The redirect guard
always covered where a hostile site could send us _second_; nothing covered a
caller pointing the crawler at an internal address to begin with, and the CLI
validated only `isHttpUrl`. Both `crawlSite` and the CLI now refuse.

**A 24-hour cap on dispatches.** The duplicate window stopped the same URL being
re-run; nothing stopped distinct URLs, so one session could dispatch ~30/minute
against 30 hostnames indefinitely — and one audit is structurally an Opus call
plus up to 28 Sonnet calls with up to 112 billed web searches, a 20-page double
crawl, a 3-pass Lighthouse and a PDF render in a billed Actions job. The cap is a
runaway brake, not a quota: it sits far above real use and answers 429 with both
numbers. A repeat of the same URL still reports `duplicate`, so it neither
consumes the budget nor gives a confusing answer.

**The private runner no longer takes a `ref` input.** `reddoor-maintenance` is
public, so `refs/pull/N/merge` exists for any PR anyone opens; a dispatch naming
one would run a stranger's build in a job holding Turso, Resend and Anthropic
secrets.

**The health check is behind the operator gate.** It leaked no values, but
`DASHBOARD_PASSWORD: true` is the reconnaissance step for using that fallback.

Also closes the deprecated `::a.b.c.d` IPv6 form in `isPrivateOrLoopbackHost`.
