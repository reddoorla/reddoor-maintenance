---
"@reddoorla/maintenance": minor
---

The deps audit no longer counts a major the fleet holds on purpose as "a major behind" (P1-98). `typescript` is held when the org Renovate preset (`reddoorla/.github` `renovate-config.json`, read at audit time) caps it with `allowedVersions` and the site already runs the newest major the cap allows; `@types/node` is held when its major equals the site's Node runtime major from `.nvmrc` (else `engines.node`). Held packages leave `deps_behind_packages`, `deps_major_outdated` and the cockpit's Watch count, and are stored in a new `site_health.deps_held_packages` column (migration 0055) and named in the audit summary. An unread preset, a site that does not extend it, an unevaluable cap or an unreadable runtime holds nothing.
