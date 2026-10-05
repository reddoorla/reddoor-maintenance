---
"@reddoorla/maintenance": patch
---

The a11y, lighthouse and smoke audits now start their server again on a fresh port when the one they picked was taken before the server could bind it. The port is picked by binding and releasing it, so another process can claim it in between; the server, still under `--strictPort`, then failed with `EADDRINUSE` and the audit reported that as the site's failure. Up to three tries are made, each on a newly picked port, and only when the server's output names one of the audit's own ports as in use (Node's `EADDRINUSE`, vite's `Port N is already in use`, or Playwright's "is already used"). Any other failure is reported at once, as before.
