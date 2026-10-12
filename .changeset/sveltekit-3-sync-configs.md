---
"@reddoorla/maintenance": minor
---

SvelteKit 3 support in the config factory and `sync-configs` (P1-45). `createKitConfig` in `configs/svelte` returns kit 3's options top-level for the `sveltekit(...)` plugin, with the canonical warning filter, aliases (plus `$lib`, which kit 3 stopped providing), opt-in `csp`, `prismicRepository` and `placeholder`. On a site whose `package.json` declares `@sveltejs/kit` 3, `sync-configs` heals a `sveltekit.config.js` off the canonical adapter and an `eslint.config.js` to import it, never writes a `svelte.config.js`, and reports a leftover `svelte.config.js` as a hazard (a DRIFT line in `--dry`). `analytics-tag` refuses a kit 3 site, whose CSP it cannot yet edit, instead of installing a tag the CSP blocks.
