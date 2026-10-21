---
"@reddoorla/maintenance": patch
---

`match-harness` writes the `/dev/match` route's `dev` import as `$app/env` on a site that declares SvelteKit 3, where svelte-check cannot resolve `$app/environment`; kit 2 sites, and sites that declare no kit, keep `$app/environment` byte for byte (#1566). A kit 3 site that installed the kit 2 copy is upgraded on the next run, and a kit version the recipe cannot read keeps `$app/environment` with a note saying so.
