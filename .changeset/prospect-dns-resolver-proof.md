---
"@reddoorla/maintenance": patch
---

Prospect audit: the DNS checks prove their resolver on a control domain before a missing SPF, DMARC or MX record counts, fall back to DNS over HTTPS, and report "couldn't check" instead of "missing" when no resolver passes.
