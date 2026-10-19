---
"@reddoorla/maintenance": patch
---

`search-console-recheck` no longer prints the draft's "no Search Console property matched" advice for its no-property control or doubles each still-missing site's line (`fetchSearch` takes a `quiet` option), names the key file when the control soft-fails, and skips `no-property` rows with no parseable `checked_at`, which the cockpit raises no watch for.
