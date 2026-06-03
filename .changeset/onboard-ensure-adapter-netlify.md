---
"@reddoorla/maintenance": patch
---

`onboard` now ensures `@sveltejs/adapter-netlify` is declared, alongside `@reddoorla/maintenance` and the audit deps. The synced `svelte.config.js` template imports the adapter, so a freshly-onboarded site couldn't build without it — onboard previously left that gap to be patched by hand. Versions are sourced from `baseline-versions` (new `FRAMEWORK_DEPS`, same drift-guard as `AUDIT_DEPS`); sites that already declare the adapter are left untouched.
