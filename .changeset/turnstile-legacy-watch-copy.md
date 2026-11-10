---
"@reddoorla/maintenance": patch
---

The cockpit's Turnstile watch reason for a "fail" that no form-e2e run stamped now reads "widget flagged by the legacy /health check, not verified by a browser" instead of calling it a stale browser check: that value is function-health's legacy flag, which no browser checked.
