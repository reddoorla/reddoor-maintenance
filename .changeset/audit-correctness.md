---
"@reddoorla/maintenance": patch
---

Close the audit's correctness gaps found in the 2026-08-26 review.

**A hostile sitemap index was an SSRF.** A `<loc>` inside a sitemap index reached
`fetch()` with no origin or scheme check — and that value comes from the site
being audited, which is by definition a stranger's. A hostile index could make
the runner request `169.254.169.254`, `127.0.0.1` or any internal host, from a
GitHub Actions job holding `TURSO_AUTH_TOKEN`, `RESEND_API_KEY` and
`ANTHROPIC_API_KEY`. Nested sitemaps are now same-origin only, behind the
private-host guard the redirect check already used.

**A positive verdict could contradict its own evidence.** Evidence verification
was written to catch a model inventing quotes and never asked the opposite
question, so a `yes`/`partial` with no evidence at all passed through and scored.
Observed in production: the same site, the same question, the same null evidence
— graded `no` on 25 Aug and `partial` on 26 Aug, moving the Answers score 10
points and producing a report that scored pricing as answered while its own fix
list told the prospect to publish pricing. An unsupported positive verdict is now
downgraded to `no`; the question stays visible, it just stops scoring.

**AI Visibility was zero by construction.** The query prompt asked for searches
the company "deserves to appear" in, which yields head terms, which return
directories — where small firms are aggregated rather than surfaced. It now asks
for a spread: at most one head term, at least three long-tail. `buildQueries`
also took only 3 of the up-to-5 queries the schema asks for, pinning the
denominator at 3 and making the score four-valued; it now takes all five, and
`MAX_QUERIES` rose to 9 so a competitor query isn't silently dropped in its place.

**Abbreviations are names, not prose.** `resolveBusinessName`'s `". "` test threw
away "St. Louis Roofing", "Dr. Patel Orthodontics", "Mt. Vernon Dental" and
"Smith & Co. Design" — every practice fronted by a doctor's name, every `St.`/
`Mt.` place name. They degraded to the bare domain, which sent branded probes to
search for "stlouisroofing.com", killed the brand-mention path, and made the
report claim the engines were handed the name when they were handed the domain.
Abbreviations and initials are now stripped before the sentence-break test, and
the report's claim is gated on the resolved name rather than the raw one.

**Brand matching missed how engines actually write a name** — a dropped legal
suffix, `&` written as "and", a hyphen as a space, a line break mid-name, or
markdown emphasis. Both sides are now normalised before matching. In the other
direction, any two-word name counted as distinctive, so a business called
Creative Studio or The Agency scored "visible" off prose referencing nobody; a
name built only from category words no longer counts on a mention alone.

**The receipt cards could disagree with the score beside them.** They re-derived
visibility with a looser rule than the scorer used, printing "You were named in
this answer" above a card contributing zero. The scorer's decision is now
recorded on the answer and read by both. Cited domains are relabelled "sources
the engine retrieved", which is what they are.

**The PDF could be a 404 page.** `page.goto` resolves for any status and its
result was dropped, so a missing print route rendered the "Page not found" page
as a valid PDF and emailed it — with no warning, because nothing threw. The
status is now checked.
