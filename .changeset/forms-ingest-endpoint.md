---
"@reddoorla/maintenance": minor
---

Add `createIngestEndpoint` — a JSON `POST`-handler factory for client-driven
forms (modals/lightboxes/fetch), the sibling of `createIngestAction`. Screens
the honeypot, validates `formType` against `SUBMISSION_FORM_TYPES`, forwards to
the dashboard ingest, and returns `{ ok }`-shaped JSON.
