---
"@reddoorla/maintenance": minor
---

`reddoor-maint audit --only analytics` pairs a site's GA4 tag against the property its monthly report reads.

Since 0.100.0 the setup check asks every maintained site for a GA4 property on its row, or a `no analytics` opt-out. That check reads the row only. This audit reads both ends: the tag declared in the site's checkout, and the property on the row. Each end can look fine on its own while the pair is broken, and both failures are silent. On 2026-09-22 a fleet-wide measurement found four sites broken at one end. `revogen` had a live tag and no property, so it was collecting into a property no report reads. `la-homelessness-youth`, `alamo-anatomy` and `hedloc` had a property and no tag, so their properties could only ever answer zero.

- The declaration is read from `src/hooks.client.ts`, which is what `analytics-tag` writes, and then from `src/lib/site-config.json`. The pairing needs no browser and no GA credentials. A declared tag with no property on the row fails outright. A property with no declared tag fails once a plain GET of the page shows no loader either.
- Emission is graded by its evidence. A browser probe, run only when `REDDOOR_ANALYTICS_PROBE=1`, counts both ways. A plain GET of the page counts only a loader it finds, because `initAnalytics` appends its loader from JS. When nobody observed the tag, a finding that rests on emission is a `warn` that names what went unchecked.
- A site whose row accepts `no analytics` is skipped, and nothing is fetched for it.
- A checkout audited by path has no fleet row, so the audit skips it rather than pairing it against a property it never read. Pair against the row with `--fleet turso`, which covers `maintained` sites only.
- The verdict is printed, not stored. The fleet write-back ignores `analytics` results, and no nightly workflow runs this audit.

`Site` gains `ga4PropertyId` and `analyticsOptedOut`, both read from the site row.
