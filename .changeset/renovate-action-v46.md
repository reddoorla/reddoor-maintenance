---
"@reddoorla/maintenance": patch
---

fix(sync-configs): bump renovate workflow pin `renovatebot/github-action@v40` → `@v46.1.14`

The `@v40` major tag no longer resolves (the action ships full-version tags only, now at v46.x), so the synced renovate workflow failed at action-resolution on every fleet repo. Pin to a current, resolvable version; Renovate self-maintains it going forward.
