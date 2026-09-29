---
"@reddoorla/maintenance": patch
---

A timed-out audit spawn now also kills the process groups its descendants detached into, so Playwright's webServer (the site's dev server) and Chrome under lhci no longer outlive the timeout holding their port.
