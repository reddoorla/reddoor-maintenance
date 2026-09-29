---
"@reddoorla/maintenance": minor
---

`reddoor-maint audit --only analytics` pairs a site's GA4 tag against the property its monthly report reads. In this release it is advisory: it reports `warn`, never `fail`, so it cannot fail a site's CI.

It is advisory because its evidence can still be wrong in a way that looks certain. Review found the browser probe calling reddoor's tag "blocked or dead" while that tag is working and has 92 real users. reddoor's loader waits for the first interaction, and the probe never interacts. Hard failures wait for a week of fleet data. Until then, every case below that would fail is reported as a `warn`, with the same text.

Since 0.100.0 the setup check asks every maintained site for a GA4 property on its row, or a `no analytics` opt-out. That check reads the row only. This audit reads both ends: the tag declared in the site's checkout, and the property on the row. Each end can look fine on its own while the pair is broken, and both failures are silent. On 2026-09-22 a fleet-wide measurement found four sites broken at one end. `revogen` had a live tag and no property, so it was collecting into a property no report reads. `la-homelessness-youth`, `alamo-anatomy` and `hedloc` had a property and no tag, so their properties could only ever answer zero.

- The declaration is read from every `initAnalytics` reference under `src/`: the `src/hooks.client.ts` that `analytics-tag` writes, a `hooks.client.js`, or a root layout. If the code takes its values from `src/lib/site-config.json`, they are read from there. A value the reader cannot see as a literal, such as an imported ID, a dev/prod ternary or two calls that disagree, is reported as unknown (`warn`), never as a defect.
- The pairing needs no browser and no GA credentials. It flags a declared tag with no property on the row. It flags a property with no declared tag only once the probe, or a plain GET of the page together with a full scan of `src/`, shows no loader.
- The browser probe runs only when `REDDOOR_ANALYTICS_PROBE` is `1`, `true`, `yes` or `on`. It counts a loader only when the loader arrives, and it names a loader that the page's Content-Security-Policy refused. It does not interact with the page. If the probe saw no loader but the served HTML names one, the evidence is reported as conflicting, not as absence. A navigation that does not answer 2xx, such as a 503 or 401, counts as not checked.
- When the GA read shows real users, no verdict claims zero users or a dead tag. The text says the evidence conflicts and names both sides.
- A site whose row accepts `no analytics` is skipped with no fetch, browser or Data API call. `--fleet` still clones every roster site before any audit runs.
- A checkout audited by path has no fleet row, so the audit skips it rather than pairing it against a property it never read. Use `--fleet turso` to pair against the row. The roster covers `maintained` sites only.
- A site install has no GA client libraries, so the property half is reported as not checked. GA credentials refused for the whole fleet (`invalid_grant`, UNAUTHENTICATED) are a `warn` that points to the credentials, not a fault on each site.
- The verdict is printed, not stored. The fleet write-back ignores `analytics` results, and no nightly workflow runs this audit.

`Site` gains `ga4PropertyId`, which is `null` when a row was read and has no property, and `analyticsOptedOut`. The Turso roster sets both, and a JSON inventory can carry `ga4PropertyId`. The monthly report now trims the property ID before querying GA, as the audit does.
