---
"@reddoorla/maintenance": minor
---

feat(dashboard): add a "Refresh fleet state" button to the cockpit

A fleet-level action (`POST /api/fleet/refresh`) that dispatches the `fleet-security` and `fleet-lighthouse` GitHub Actions workflows on demand, so vulnerabilities, auto-check signals, Lighthouse scores, and GitHub signals refresh immediately instead of waiting for the nightly cron. Reuses the authed-write gate chain and the `fetch`-based `makeGitHubRest` client. Dispatches each workflow independently (partial success is reported), confirms before firing (the sweeps are heavy fleet-wide runs), and needs `RENOVATE_TOKEN` in the dashboard Netlify env (already set).
