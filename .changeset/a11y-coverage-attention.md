---
"@reddoorla/maintenance": minor
---

An a11y fixture that is missing from a site's source and not declared in `package.json#reddoor.absentFixtures` now stays in the stored route total, so the run stores as partial ("1 of 2") instead of complete (#910). A partial run raises a new Attention item, `a11y-coverage:<site>` ("accessibility scan reached only 1 of 2 routes"), on the cockpit card, Needs-you, the site page and the digest; before, a partial run raised nothing anywhere. A declared absence still leaves the total. On the 11-02 sweep this applies to CalTex, Espada and Revogen, each cleared by declaring `/dev/animate-in`. The write-back also stores the routes a run did not scan, and why, in the new `site_health.a11y_routes_skipped` column (JSON `[{ route, reason }]`, migration 0053), and the site page's a11y tile names them.
