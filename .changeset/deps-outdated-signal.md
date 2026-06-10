---
"@reddoorla/maintenance": minor
---

feat(deps): add a real outdated-install signal alongside the declared-range "Deps Drifted" number. The deps audit now also reports how many installs are behind the registry's latest (`pnpm outdated`, best-effort), written to a new `Deps Outdated` Airtable field and shown on the dashboard.
