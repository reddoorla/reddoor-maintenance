---
"@reddoorla/maintenance": minor
---

Remove the `ci` config template (and `"ci"` from `ConfigName`): every live fleet ci.yml carries per-site values (`netlify-site:`, `node-version:`, `permissions:`) a static template cannot own, so the exact-match heal in `self-updating`/`sync-configs` was an armed clobber — any run would have stripped those values in green auto-mergeable PRs. Ownership is split instead: the starter clone provides each site's ci.yml, and Renovate bumps the pinned reusable-workflow ref when reddoorla/.github tags a new version. Also retires the two ACCEPTED_GAPS entries — the central repo and .github now run Renovate themselves.
