---
"@reddoorla/maintenance": minor
---

Fleet-Netlify standardization for `sync-configs`:

- The `svelte.config.js` template now defaults to `@sveltejs/adapter-netlify` (`adapter({ edge: false, split: false })`) instead of `adapter-auto` — consistent `build/` output, no per-site override. Sites must have `@sveltejs/adapter-netlify` installed.
- New canonical `netlify.toml` template (`netlify` ConfigName): `command = "pnpm build"`, `publish = "build/"`, `functions = "functions/"`, `NODE_VERSION = "22"`, `COREPACK_INTEGRITY_KEYS = "0"`. Pins Node to latest 22.x (the exact `22.12.0` pin is too old for `@eslint/js@10`'s `^22.13.0` engine). Note: this template overwrites `netlify.toml` on sync — sites with custom redirects/headers/plugins in it should keep those elsewhere (`_redirects`/`_headers`/SvelteKit) or they'll be clobbered.
