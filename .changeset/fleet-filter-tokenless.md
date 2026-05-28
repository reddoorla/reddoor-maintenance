---
"@reddoorla/maintenance": patch
---

Fleet homepage now hides sites without a `Dashboard Token` instead of rendering them with a "no token" badge. The Airtable Websites table tracks every project — many aren't on the Reddoor maintenance stack (deprecated, hosting-only, in-dev for other teams). `dashboardToken` is the explicit opt-in: only sites with a token belong on the fleet view.

Filter happens at the Netlify function layer; the render module is now a pure "render what you're given" function. Header copy updated from "N sites in the Websites table" to "N sites on the Reddoor stack" to match.
