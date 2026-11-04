---
"@reddoorla/maintenance": patch
---

The write gate's REASON and WARNING text is escaped for GitHub's workflow commands, so a `%` or a newline in a site label reaches the annotation as written.
