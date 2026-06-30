---
"@reddoorla/maintenance": patch
---

Docs + health: document the dashboard's deploy env, and surface `TURSO_DATABASE_URL` in the webhook health check. The deployed Netlify functions read `DASHBOARD_PASSWORD` (the cockpit/per-site auth gate), `DASHBOARD_BASE_URL`, `RENOVATE_TOKEN` (the "Trigger Renovate" button), and `GH_TOKEN` (request-path GitHub REST), but the README "Set env vars" table listed none of them — so a by-the-book deploy produced an unauthable dashboard with dead action buttons. All four are now documented. The `resend-webhook` GET health check (the README's post-deploy smoke test) now also reports `TURSO_DATABASE_URL` presence, since its absence 500s the whole dashboard + forms surface — the most common fresh-deploy failure — and Netlify env vars are site-wide. Presence-only, never values.
