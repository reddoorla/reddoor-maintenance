---
"@reddoorla/maintenance": minor
---

Add a canonical `netlify.toml` to the `sync-configs` template set (new `netlify` config name). Standardizes the fleet's Netlify build: `command = "pnpm build"`, `publish = "build/"`, `functions = "functions/"`, `NODE_VERSION = "22"`, `COREPACK_INTEGRITY_KEYS = "0"`. Pins Node to latest 22.x — the older `22.12.0` pin is below `@eslint/js@10`'s `^22.13.0` engine and broke installs. Pairs with the adapter-netlify `svelte.config.js` template (#105) to make a synced site build on Netlify out of the box.

Note: this template overwrites `netlify.toml` on sync. Sites with custom redirects/headers/plugins should keep those in `_redirects`/`_headers`/SvelteKit, or they'll be clobbered.
