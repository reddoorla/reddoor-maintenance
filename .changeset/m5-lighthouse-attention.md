---
"@reddoorla/maintenance": minor
---

feat(alerts): the digest's "Needs attention" now flags Lighthouse categories below 75 (M5 slice 3). Each of a site's four deployed scores — Performance, Accessibility, Best Practices, SEO — that drops under the floor surfaces as its own NEW/WORSE-badged item linking the dashboard. The metric is encoded as the deficit (`100 - score`), so a category sliding further down badges WORSE, a first crossing below the floor badges NEW, and a recovery clears it from the snapshot (re-NEWing if it regresses again). Pure Airtable read — no new fetch, token, or workflow change.
