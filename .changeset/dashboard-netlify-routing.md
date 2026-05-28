---
"@reddoorla/maintenance": patch
---

Fix `/s/:slug` dashboard routing. The 0.11.0 shape relied on a `[[redirects]]` rewrite with `status=200` to map `/s/:slug` → the site-dashboard function — but Netlify passes the ORIGINAL request URL to the function in that mode, so `slug` was never extractable from the query string and every request fell through to the health-check JSON.

Switches to Netlify v2 function-level path routing via `export const config = { path: ["/s/:slug", "/.netlify/functions/site-dashboard"] }`. The function reads `slug` from `ctx.params` (with the query-string fallback retained for direct function calls). Drops the rewrite from `netlify.toml`. Caught immediately on the first end-to-end deploy verification against caltex.
