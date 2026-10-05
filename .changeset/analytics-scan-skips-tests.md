---
"@reddoorla/maintenance": patch
---

`analytics-tag` and the analytics audit no longer count test, spec or type-declaration files under `src/` as a tag the site already runs. reddoor-starter ships `src/lib/privacy/services.test.ts`, whose fixtures call `initAnalytics`, so every starter-derived site was refused as "already calls initAnalytics with an ID this recipe cannot read". 29 Navy's install hit it on 2026-10-05.
