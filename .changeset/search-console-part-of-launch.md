---
"@reddoorla/maintenance": minor
---

Search Console is now part of site launch, alongside GA4. The setup score gains a sixth check, "Search Console property (or a "no search console" opt-out)", satisfied by a `searchConsoleProperty` on the site row or by accepting `no search console` under Accepted watch conditions. A maintained site with neither is a cockpit watch item ("no Search Console property"), filterable as `no-search-console`, and launching sites are not asked. The opt-out is independent of `no analytics`. The check asks whether the row records a property, not whether Search Console verifies it; reports still resolve one automatically when the row is blank.
