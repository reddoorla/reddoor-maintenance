---
"@reddoorla/maintenance": minor
---

Add `.prettierignore` to the `sync-configs` canonical template set. The CI gate runs `prettier --check .`, which formats YAML — without a `.prettierignore`, `pnpm-lock.yaml` (and Renovate-updated lockfiles) fail the check. The new template excludes the lockfile and generated dirs (`.svelte-kit/`, `build/`, `.netlify/`, `dist/`) so the CI prettier step is green fleet-wide. New `ConfigName` `"prettier-ignore"`.
