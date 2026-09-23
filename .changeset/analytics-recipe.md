---
"@reddoorla/maintenance": minor
---

`reddoor-maint analytics-tag` — turn GA4 on for one site, and `csp: { analytics: true }` to let the browser run it.

The recipe writes `src/hooks.client.ts` rather than editing `src/routes/+layout.svelte`. No fleet site had that file as of 2026-09-22, so this is a create and never a clobber; the root layouts it would otherwise patch run from 2.7KB to 9.7KB of per-site hand-maintained markup with no common anchor. It uses SvelteKit's `init` export, verified against the installed 2.70.3, which wires `init: client_hooks.init` in `write_client_manifest.js`.

`createSvelteConfig` gains `csp: { analytics: true }`, which folds the googletagmanager, google-analytics and beacon hosts into the policy. Applied **after** the site's own directives, so a site that overrides `script-src` wholesale still gets them. The hosts are exported as `ANALYTICS_CSP` and imported rather than transcribed, for the same reason `SVELTE_EVENT_REPLAY_HASH` is: a copied host list cannot be told apart from a stale one, and a CSP stale in the direction of a missing host fails silently.

This is required, not cosmetic. The emitted policy carries no `'strict-dynamic'`, so the host allowlist governs the loader `initAnalytics` injects from bundle JS exactly as it would one typed into `app.html`.

The CSP edit refuses anything it does not recognise rather than guessing, and the site still gets its hook plus a note saying what to do by hand.
