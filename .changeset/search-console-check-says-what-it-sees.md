---
"@reddoorla/maintenance": patch
---

The Search Console launch check now says what it can see. A blank `searchConsoleProperty` is not a missing Search Console, because reports resolve a property by host, and the cockpit was marking Sonder "no Search Console property" while its reports found it on page 1. The watch item is now "Search Console property not recorded", the signal and filter are `search-console-unrecorded`, and the setup label is "Search Console property recorded"; the GA4 item reads "GA4 property not recorded (reports carry no analytics)". A recorded Search Console property now enrols a site in the report's search lookup on its own, a `no search console` opt-out makes the report skip that lookup, the setup score and the cockpit accept the same opt-out spellings, and the site editor only accepts `sc-domain:<host>` or an `http(s)://…/` prefix for the property.
