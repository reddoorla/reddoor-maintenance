---
"@reddoorla/maintenance": minor
---

Forms: `createIngestAction` gains an optional `redirectTo` (303-redirect on success/bot-screen, e.g. a dedicated `/thank-you` page). Submission notifications are now status-aware — sites not yet in `maintenance` (launch period, hosting, etc.) route leads to the operator (`OPERATOR_EMAIL` or `tucker@reddoorla.com`); sites in `maintenance` go to the client POC as before.
