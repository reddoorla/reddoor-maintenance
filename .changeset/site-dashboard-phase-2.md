---
"@reddoorla/maintenance": minor
---

Phase 2 of the site dashboard: a password-gated fleet homepage at `/` listing every site in the Airtable Websites table. Each row links to its per-site `/s/<slug>?t=<token>` page (Phase 1). HTTP Basic Auth against a new `DASHBOARD_PASSWORD` env var (Netlify site env); username is ignored. Sites without a `Dashboard Token` set render with a "no token" badge so the homepage doubles as a setup-progress view.

Operator setup: set `DASHBOARD_PASSWORD` in the Netlify site env (any value), then visit `https://<netlify-domain>/`. Browser prompts for credentials; type anything for username, the configured value for password.

Phase 2b (click-to-trigger audit per site, via GitHub Actions workflow_dispatch) and Phase 2c (extending `audit --write-airtable` to persist lint/deps/security/a11y findings) are deferred to separate plans.
