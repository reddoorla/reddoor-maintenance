---
"@reddoorla/maintenance": minor
---

feat(copy): email copy is now data, not scattered literals (M6a). Every hardcoded string in the report template moves into one `DEFAULT_COPY` catalog (`src/reports/copy.ts`) — fleet-wide wording is a one-file edit. A site can override the three most client-facing narrative blocks — **intro · contact · footer** — via new Airtable fields (`Copy — Intro/Contact/Footer`), merged `override ?? default` like report recipients. A site with no overrides renders a visually-identical email (all copy — default and override alike — is now HTML-escaped for safety, so e.g. an apostrophe renders as its entity). Sets up the launch email (M6b) to reuse the same copy layer.
