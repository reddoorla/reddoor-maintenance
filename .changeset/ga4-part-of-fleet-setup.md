---
"@reddoorla/maintenance": minor
---

GA4 is now part of fleet setup. The setup score gains a fifth check, "GA4 property (or a "no analytics" opt-out)", satisfied by a `ga4PropertyId` on the site row or by accepting `no analytics` under Accepted watch conditions. A maintained site with neither is a cockpit watch item ("no GA4 property"), filterable as `no-analytics`. Accepting `no analytics` is the explicit opt-out for a client who runs their own analytics: the site leaves the watch band and the opt-out stays visible as a muted chip. Launching sites are not asked until go-live. `no analytics` is the first accepted-condition option added since Airtable stopped receiving writes, so it is stored in Turso only.
