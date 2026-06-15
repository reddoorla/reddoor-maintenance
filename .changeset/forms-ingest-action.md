---
"@reddoorla/maintenance": minor
---

Add `createIngestAction` to the `@reddoorla/maintenance/forms` subpath — a factory that builds a SvelteKit `default` form action (bot screen → forward to the dashboard ingest endpoint → SvelteKit-shaped results). Fleet sites now wire a contact form in ~12 lines by supplying only a per-form `buildPayload`. SvelteKit is added as an optional peer dependency (only this module imports it).
