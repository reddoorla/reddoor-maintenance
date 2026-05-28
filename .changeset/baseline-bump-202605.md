---
"@reddoorla/maintenance": minor
---

Refresh `baselineVersions` against `reddoor-starter`'s May 2026 dep set. Most caret-floated sites in the fleet had drifted ahead of the previous baseline (svelte 5.55.5 → 5.55.10, kit 2.59.0 → 2.61.1, vite 8.0.10 → 8.0.14, prismic-client 7.3.1 → 7.21.8, prismic-svelte 2.0.0 → 2.2.1, slice-machine-ui 2.11.1 → 2.21.3, eslint 10.3.0 → 10.4.0, prettier 3.1.1 → 3.8.3, prettier-plugin-svelte 3.2.6 → 4.0.1, tailwindcss 4.0.14 → 4.3.0, @lucide/svelte 1.14.0 → 1.17.0, and ~10 more). After this change, `deps` audits across the fleet flip from `warn` back to `pass` without any per-site work.

Also adds `.reddoor-a11y/` to `CANONICAL_GITIGNORE_ENTRIES` so the local audit-output dir lands in every site's managed gitignore block on the next `sync-configs` run.

The Svelte 4 → 5 upgrade recipe (`src/recipes/svelte-5/step-bump-versions.ts`) is intentionally unchanged — it pins a known-good transition combo, not the live baseline.
