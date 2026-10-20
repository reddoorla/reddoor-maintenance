---
"@reddoorla/maintenance": patch
---

`reddoor-maint launch`: the `/dev/match` pre-flight accepts a guard whose `dev` comes from `$app/env` (SvelteKit 3) as well as `$app/environment`, so a migrated site's working guard is no longer reported as "the matching twin would ship".
