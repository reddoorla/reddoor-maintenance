---
"@reddoorla/maintenance": minor
---

security audit: ingest GitHub Dependabot alerts as the source of truth

The `security` audit now reads a repo-backed site's GitHub Dependabot alerts (prod **and** dev, from the GitHub Advisory DB) via the REST API and writes the severity counts + advisory list to Airtable — fixing a false-green blind spot where `pnpm audit --prod` reported 0 critical/high while Dependabot flagged real (often dev-scoped) criticals.

- `securityAudit` prefers Dependabot when the site has a `gitRepo` and a `GITHUB_TOKEN` is available; it falls back to `pnpm audit` (then `npm audit`) for repo-less sites or any API error (403/404/network) — a Dependabot hiccup never fails a site.
- All open alerts count toward the tallies; the cockpit's auto-patching (amber Watch) vs Renovate-exhausted (red Broken) bands decide urgency. Each advisory now carries its dependency `scope` (`"runtime"` | `"development"`), surfaced as a `(dev)` tag on the per-site dashboard.
- New `makeGitHubRest().listDependabotAlerts()` — cursor pagination via the `Link` header (the endpoint has no numeric `page` param) with a per-request abort timeout so a hung connection falls back instead of stalling the sweep. `fleet-security.yml` passes the org PAT as `GITHUB_TOKEN`; it needs the **Dependabot alerts: read** permission on the fleet repos, otherwise it degrades gracefully to `pnpm audit`.
