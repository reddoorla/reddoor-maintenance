## 2026-10-07 — Data Dynamiq serves its Search Console tag; the property is recorded, and Google still refuses it (data-dynamiq#62 `0e5f8dd`, #1239 `223dbe9`)

The operator created a Search Console property for www.datadynamiq.com and
asked for the HTML-tag verification to ship. The site had no property at all:
`search_console_property` was NULL and the last lookup (10-05 18:36Z) read
`no-property`. The tag went into data-dynamiq's `src/app.html`, outside
`%sveltekit.head%`, so every prerendered page carries it. No route or SEO
component writes a verification tag, so nothing could drop or duplicate it.
Production served none before the merge and one after it (15:31:42Z); the
deploy preview served one before landing. Both were checked with curl and
`grep -c`, the before value being the negative control.

The operator answered URL-prefix, and `setSiteDetail` recorded
`https://www.datadynamiq.com/` (15:46Z, read back with a SELECT). It was
called with the same Turso deps the dashboard's `site-details` function
binds, not through raw SQL.

**The lookup still fails, and its outcome changed shape.** The backlog line
I first wrote said that without the `reports@` grant the lookup would keep
reading `no-property`, because property discovery uses `sites.list`. That
holds only while the property is unrecorded. Once `search_console_property`
is set, the client skips `sites.list` and queries the property directly
(`src/reports/search/client.ts`). Google then answers "User does not have
sufficient permission", which the report records as `soft-fail`. I caught
this before the line landed and removed it; it never reached `main`.

**Proving the instrument.** `report <slug> --preview --enrich` (store-free)
resolved Espada under both `tucker@` and `reports@`. That made the
Data Dynamiq refusal a finding about the property, not about the
credentials. At 17:59Z the operator had said Verify and the grant were done,
yet the refusal held. `GET webmasters/v3/sites` per subject gave the reason
directly: `tucker@` holds the property as `siteUnverifiedUser`, `reports@`
does not see it, and the page serves the tag with a 200, also to a Googlebot
user agent. Verify has not succeeded for the account that created the
property. Because only a verified owner can add users, the `reports@` grant
cannot exist yet either. An HTML-tag token belongs to the account that
generated it, so Verify has to be pressed from that account. This is item 93
under Operator decisions. The next nightly will read `soft-fail` for
Data Dynamiq until it is done.

**Landing.** #1239 went DIRTY once: another session's item 92 landed at the
same spot in BACKLOG, so this item became 93. Prettier renumbers ordered
lists and re-wraps an inline code span across a line break, which broke a
`curl …` span; the line was reworded so no code span wraps.
