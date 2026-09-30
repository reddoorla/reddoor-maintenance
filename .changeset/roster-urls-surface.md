---
"@reddoorla/maintenance": minor
---

The daily digest now reports a non-archived site whose roster url the nightly `roster-urls` probe reads as failing, naming the url and the status, and raises one fleet item when probe stamps go older than three days. `url not deployed` in Accepted Watch Conditions mutes only the failure; the cockpit shows the same failure as a watch on maintained sites.
