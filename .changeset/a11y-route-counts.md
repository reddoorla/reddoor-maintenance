---
"@reddoorla/maintenance": patch
---

The a11y audit now stores how many routes it scanned and how many it was given, next to the violation count (#910). `audit --write-back` writes `A11y Routes Scanned` and `A11y Routes Total` to `site_health` (migrations 0033–0034, `a11y_routes_scanned` / `a11y_routes_total`). They are the same two numbers the summary prints as "1 of 2 routes", so a run that skipped a route is no longer stored the same as a run that scanned them all. The site page's Accessibility tile reads "only 1 of 2 routes scanned" or "2 of 2 routes scanned", and the cockpit card shows "0 (1/2 routes)" for a partial run. A result that carries no route counts stores NULL, which clears the previous run's counts.
