---
"@reddoorla/maintenance": patch
---

audit: the `domain` audit retries its TLS handshake once after a timeout or a connection reset (`ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ECONNABORTED`), so a single edge stall no longer marks a healthy site Broken. A DNS failure, a refused port and every certificate verification error are never retried. A pass that needed the retry says so in its summary and `details.retriedAfter`; two failures name both.
