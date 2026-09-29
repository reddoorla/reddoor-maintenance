---
"@reddoorla/maintenance": minor
---

`reddoor-maint analytics-tag <site> --measurement-id G-… --production-host <host>` turns GA4 on for one site, and `csp: { analytics: true }` lets the browser run it.

The recipe writes `src/hooks.client.ts`, which starts `initAnalytics` from SvelteKit's `init` export (verified against `@sveltejs/kit` 2.70.3). It does not edit `src/routes/+layout.svelte`. No fleet site had a client hook on 2026-09-22, so the recipe creates a file and never overwrites one, and an existing hook is a noop. The root layouts it would otherwise patch run from 2.7KB to 9.7KB of hand-maintained markup with nothing in common to anchor an edit on. The site needs this release of `@reddoorla/maintenance` installed before the hook builds.

It runs one site at a time and needs both flags. Every site has its own GA4 web stream, so there is no fleet-wide measurement ID. A checkout path carries no deployed URL, so the production host cannot be derived.

It refuses a site that already loads a tag and names the file. `initAnalytics` stands down only for its own measurement ID, and a site-local loader that runs later never sees it, so installing alongside would double every session. Remove the old loader in the same PR, then run the recipe.

`createSvelteConfig` gains `csp: { analytics: true }`, which adds the googletagmanager, google-analytics and beacon hosts to the policy, exported as `ANALYTICS_CSP`. They are added after the site's own directives, so a site that overrides `script-src` still gets them. The emitted policy carries no `'strict-dynamic'`, so without them the browser refuses the loader and the property records nothing.

The recipe edits `svelte.config.js` only where `csp` is a `createSvelteConfig` option, and refuses any shape it does not recognise. SvelteKit's own `kit.csp` rejects unknown keys and would fail the build. On the 28 fleet configs measured on 2026-09-23 the recipe edits none: 13 set SvelteKit's own `kit.csp` and are refused with the exact hosts to add by hand, and 15 have no `csp` option. A policy set outside `svelte.config.js`, such as a `netlify.toml` header, is not checked, and the recipe's note says so.
