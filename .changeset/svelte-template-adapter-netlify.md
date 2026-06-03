---
"@reddoorla/maintenance": minor
---

The `sync-configs` `svelte.config.js` template now defaults to `@sveltejs/adapter-netlify` (`adapter({ edge: false, split: false })`) instead of `adapter-auto`. The whole Reddoor fleet deploys to Netlify, so the explicit adapter gives consistent `build/` output and avoids the adapter-auto resolution that left sites needing a manual override (caltex and erp both already use adapter-netlify). Sites must have `@sveltejs/adapter-netlify` installed.
