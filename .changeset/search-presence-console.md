---
"@reddoorla/maintenance": minor
---

Surface Google search presence in the report email, sourced from the Search Console Search Analytics API (reusing the GA service-account domain-wide delegation — added scope `webmasters.readonly`). The Custom Search JSON API path from the prior release is replaced (it is closed to new customers).

- `src/reports/search/client.ts` — `fetchSearchPresence` queries the average position for a site's per-site query over the report period; `foundOnPage1 = avgPosition <= 10`, displayed rank is the rounded average. Resolves the Search Console property from the optional "Search Console property" Websites column, else auto-resolves (Domain or URL-prefix) from `sites.list`.
- The report email's "Google Indexed" row becomes `Page 1 Google Result (#N)` when on page 1; otherwise unchanged. Positive-only — the negative is stored on the Reports row ("Search found page 1" / "Search position") for operator eyes, never shown to the client.
- Soft-fail throughout: unconfigured / no query / API error leaves the draft unaffected.
- Removes the obsolete `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` env vars.
