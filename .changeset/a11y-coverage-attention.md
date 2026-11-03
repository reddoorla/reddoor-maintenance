---
"@reddoorla/maintenance": minor
---

The a11y write-back stores the routes a run did not scan, and why, in the new `site_health.a11y_routes_skipped` column (JSON `[{ route, reason }]`, migration 0053), and the site page's a11y tile names them ("1 of 1 routes scanned; not scanned: animate-in demo (fixture not in this site's source)"). A skip with a declared reason leaves both stored counts, so before this it was named only in a CI log (#910). A new Attention item, `a11y-coverage:<site>` ("accessibility scan reached only 1 of 2 routes"), reaches the cockpit, Needs-you, the site page and the digest when a fresh run stored fewer routes scanned than total; every skip the audit writes today is declared, so it is a guard for any other skip reason.
