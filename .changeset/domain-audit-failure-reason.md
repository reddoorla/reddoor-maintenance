---
"@reddoorla/maintenance": patch
---

audit: the `domain` audit says why it failed. Its summary (printed in the run log) and `details.reason` now carry the DNS or TLS error code (`dns ENOTFOUND`, `tls ECONNRESET`, `tls DEPTH_ZERO_SELF_SIGNED_CERT`), `tls timeout after 10000ms`, `tls no certificate returned`, or `invalid URL`, instead of collapsing every failure into "resolved, no usable TLS cert". TLS verification is unchanged.
