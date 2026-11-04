---
"@reddoorla/maintenance": patch
---

The a11y audit now waits for a site to hydrate before it scans each route (#948's residual race). After each `page.goto`, the generated spec waits up to 5 s (`HYDRATION_TIMEOUT_MS`) for the starter's `html[data-hydrated]`, so a site that writes it is measured hydrated instead of, some of the time, as the server rendered it. The check is emitted as a function, because the starter's CSP has no `'unsafe-eval'` and refuses a string predicate in milliseconds. A site that never writes the marker pays the cap once per run: after one route hits the cap with no marker seen, later routes are not waited for. Each run's artifact (and `details`) gains `hydration: [{ route, wait: "marker" | "settled" | "not-waited" }]`.
