---
"@reddoorla/maintenance": patch
---

`report --rerender` ("refresh preview") now writes the site row's current four Lighthouse scores to an unsent, unapproved report and renders with them. The result line names the change (`scores=refreshed scores_change=bp:78→100`). An approved report keeps its stored scores (`scores=locked`), and a site row missing any score leaves the stored ones alone (`scores=site-missing`).
