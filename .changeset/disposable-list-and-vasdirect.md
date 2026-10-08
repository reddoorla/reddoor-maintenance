---
"@reddoorla/maintenance": patch
---

Spam pass (2026-10-08). `vasdirect.com`, `virtualeaseservice.com`, `parallelaid.com` and `erpfunds.com` join `BLOCKED_EMAIL_DOMAINS`, each after every live row from it was read and found to be spam. Two new invariants of the virtual-assistant template ("trained va who", "our custom ai system") join `SPAM_KEYWORDS`. The disposable-email signal (+45, still needs corroboration) now also matches a pinned snapshot of the CC0 `disposable-email-domains` list (9,221 domains, refreshed with `scripts/refresh-disposable-domains.mts`).
