---
"@reddoorla/maintenance": patch
---

`sync-configs` no longer clobbers a site's `svelte.config.js` customizations. The svelte template is now compliance-checked instead of exact-matched: a config already on the canonical pattern (imports `createSvelteConfig` **and** `@sveltejs/adapter-netlify`) is left untouched, so site-specific `kit.alias` and `compilerOptions` survive every sync. A missing or genuinely off-pattern config is still rewritten to the canonical template. Fixes the silent loss of custom path aliases (e.g. `$utils`/`$components`) on re-sync.
