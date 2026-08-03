---
"@reddoorla/maintenance": patch
---

Shared eslint config: turn `svelte/valid-prop-names-in-kit-pages` off for `+error.svelte` files. eslint-plugin-svelte 3.20+ allows only an `error` prop there, but SvelteKit really passes merged layout `data` to error pages (proven by reddoorla.com's live 404), and the rule takes no options to widen the list.
