---
"@reddoorla/maintenance": patch
---

form-e2e live runner: click `input[type="submit"]` as well as `button[type="submit"]`. reddoor-website's contact form uses the input variant — the first enrolled run timed out waiting for a button and recorded a false `Form E2E OK = fail`.
