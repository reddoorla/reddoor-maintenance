---
"@reddoorla/maintenance": patch
---

The prospect copyright-year detector stops being wrong in both directions: the gap between "copyright" and the year now has to look like a company name rather than any four or five words without digits, so a legal or licensing page no longer reports a site as stale by years, and a footer whose name ends in `Co.` / `Inc.` / `Ltd.` is no longer read as having no copyright line at all.
