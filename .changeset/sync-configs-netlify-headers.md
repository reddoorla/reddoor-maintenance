---
"@reddoorla/maintenance": patch
---

fix(sync-configs): the canonical `netlify.toml` template now ships the baseline security headers, and a `[[headers]]`-aware carve-out stops `sync-configs` from stripping a site's own security config (a header-less file is backfilled; a hardened one is left alone).
