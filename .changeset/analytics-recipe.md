---
"@reddoorla/maintenance": minor
---

`reddoor-maint analytics-tag <site> --measurement-id G-… --production-host <host>` turns GA4 on for one site, and `csp: { analytics: true }` lets the browser run it.

The recipe writes `src/hooks.client.ts`, which starts `initAnalytics` from SvelteKit's `init` export. It does not edit `src/routes/+layout.svelte`: the root layouts run from 2.7KB to 9.7KB of hand-maintained markup with nothing in common to anchor an edit on.

It runs on one site at a time and needs both flags. Every site has its own GA4 web stream, so there is no fleet-wide measurement ID. `--production-host` must be a bare hostname such as `www.example.com`. A URL is refused, because `initAnalytics` compares the host to `location.hostname` and a URL would keep the tag off everywhere.

It writes nothing, and says why, when:

- The site already calls `initAnalytics`, anywhere under `src/`. A second run with the same ID on the same host is a noop. A different ID, or one it cannot read, is a refusal that names both, not a noop.
- The site already has a client hook in any form SvelteKit reads (`hooks.client.js`, `.ts`, `.mjs`, `.mts`, a `hooks.client/` directory, or a custom `kit.files.hooks.client`). The refusal prints the lines to add to that hook by hand.
- The site already loads a tag some other way. `initAnalytics` stands down only for its own measurement ID, so a second loader would double every session. Remove it, commit the removal, then run the recipe.
- `src/` is too large to scan for an existing loader.
- The site's `@reddoorla/maintenance` range allows a version before 0.102.0, the first that exports `initAnalytics`, or its `@sveltejs/kit` range allows a version before 2.10.0, the first with a client `init` hook.

`createSvelteConfig` gains `csp: { analytics: true }`, which adds the hosts in `ANALYTICS_CSP` after the site's own directives. That list is Google's published CSP list for GA4 without Ads features: `script-src` https://www.googletagmanager.com, `img-src` https://www.googletagmanager.com and https://_.google-analytics.com, `connect-src` https://www.googletagmanager.com, https://_.google-analytics.com and https://*.google.com. The emitted policy carries no `'strict-dynamic'`, so without these hosts the browser refuses the loader and the property records nothing.

The recipe edits `svelte.config.js` only where `csp` is the literal option object of a `createSvelteConfig(` call. SvelteKit's own `kit.csp` rejects unknown keys and would fail the build. Every other shape is left alone, and the note gives the full host list to add by hand. It says the browser refuses the loader only when it actually found a CSP. On the 28 fleet configs measured on 2026-09-23 the recipe edits none: 13 set SvelteKit's own `kit.csp` and 15 have no `csp` option. On roalson-interests, a regex literal in `svelte.config.js` stops the parse before the CSP, so the note gives the hosts and says "if". A policy set outside `svelte.config.js`, such as a `netlify.toml` header, is not checked, and the note says so.
