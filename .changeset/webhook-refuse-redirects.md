---
"@reddoorla/maintenance": patch
---

forms: the newsletter webhook forward no longer follows redirects. A 3xx from the configured hook is recorded as `webhook:<3xx>` instead of being followed to a host the SSRF guard never checked, the same as the form webhook already did (#1970).
