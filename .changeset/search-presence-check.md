---
"@reddoorla/maintenance": minor
---

Add a Google search-presence capability: given a per-site query and the site's domain, check whether the site appears on page 1 of Google's organic results.

- `src/reports/search/client.ts` — `fetchSearchPresence({ apiKey, engineId, query, siteUrl })` → `{ foundOnPage1, position }` via the Custom Search JSON API (free 100/day; de-personalized national-ranking proxy). Hostname matching normalizes `www.`/scheme/path. Throws on non-OK responses so callers can soft-fail.
- `src/reports/search/config.ts` — `readSearchConfig()` reads `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID`; null when unset → check skipped.
- New Websites "Search query" column → `WebsiteRow.searchQuery`.

This is the capability only. Surfacing it in the report email's "Google Indexed" line (and the draft-time fetch) lands as a follow-up, after the email's `escapeXml` helper merges. Operator setup (one-time): a Google Cloud API key with Custom Search enabled + a Programmable Search Engine ID in `credentials.env`.
