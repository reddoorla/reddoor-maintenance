---
"@reddoorla/maintenance": minor
---

An accessibility run that scanned fewer routes than it was given is now an Attention item on the cockpit, the Needs-you feed, the site page and the digest (`a11y-coverage:<site>`, "accessibility scan reached only 1 of 2 routes"). Before, such a run was left out of the a11y alarm as not measured, so it raised nothing at all, and any findings it did make were hidden with it (#910). The a11y write-back also stores the routes it skipped and why, in the new `site_health.a11y_routes_skipped` column (JSON `[{ route, reason }]`, migration 0053), and the site page's a11y tile names them.
