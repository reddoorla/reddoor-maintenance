---
"@reddoorla/maintenance": minor
---

`reddoor-maint audit analytics` — pair a site's GA4 tag against the property its monthly report reads.

Analytics has two halves configured in different places, by different people, at different times: the tag in the site's repo and the numeric property ID on the fleet row. Nothing held them together, and a fleet-wide measurement on 2026-09-22 found four of fourteen maintained sites broken at one end. `revogen` had a tag and no property, so it has been collecting into something no report reads. `alamo-anatomy`, `hedloc` and `la-homelessness-youth` had a property and no tag, so those can only ever answer zero. Both failures are silent: a blank section and a zero both look like a quiet month.

The audit uses three levels of evidence and never confuses them. A browser probe is authoritative in both directions. A plain GET of the HTML is positive-only, because `initAnalytics` appends its loader from JS and a GET never runs it. `site-config.json` is intent, not proof. Where emission cannot be determined the same defect is still reported, as a `warn` naming what could not be checked rather than a `fail` that was never observed.

`Site` gains `ga4PropertyId` and `preLaunch`, both read from the Websites row.
