# Google search-presence check

**Date:** 2026-06-02
**Status:** Approved

## Problem

The report's "Google Indexed" line is a static green checkmark that proves nothing. We want a
real check: google a per-site query (the business name/title) and report whether the site
appears on page 1 of organic results.

## Goals

- Given a per-site search query (from Airtable) and the site's domain, determine whether the
  site appears in the top 10 Google results — a yes/no "found on page 1" signal.
- Soft, opt-in, and free at fleet scale. Sites without a query simply skip.

## Non-goals (this PR)

- Surfacing the result in the email's "Google Indexed" line. That edit touches the template
  and needs the `escapeXml` helper from PR #92 (the query is operator input). It lands as a
  small follow-up once #92 merges. **This PR is the capability only.**
- Rank tracking over time, competitor analysis, Search Console integration.

## Approach

Google **Custom Search JSON API** (Programmable Search Engine). Free 100 queries/day — a
~30-site monthly fleet is trivial. No per-site ownership/verification required (unlike Search
Console). De-personalized/de-localized results = a clean national-ranking proxy.

## Design

### `src/reports/search/client.ts`

```
fetchSearchPresence({ apiKey, engineId, query, siteUrl })
  → Promise<{ foundOnPage1: boolean, position: number | null }>
```

- `GET https://www.googleapis.com/customsearch/v1?key={apiKey}&cx={engineId}&q={query}&num=10`.
- Walk `items[]`; match each `item.link`'s hostname against `siteUrl`'s hostname, normalizing
  a leading `www.` and ignoring scheme/path. `position` = 1-based index of the first match, or
  `null`. `foundOnPage1 = position !== null`.
- Throws on non-OK HTTP / quota / malformed response — the caller (draft flow, later) soft-fails.

### `src/reports/search/config.ts`

```
readSearchConfig() → { apiKey: string, engineId: string } | null
```

Reads `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` from `process.env` (loaded from
credentials.env). Null when either is unset → the check is skipped (soft).

### Airtable + `WebsiteRow`

- New Websites column **"Search query"** (single-line text, operator fills, e.g. `ERP funds`).
  `WebsiteRow.searchQuery: string | null` mapped from it.
- (Follow-up PR) Reports column **"Search found page 1"** (checkbox) written at draft, read at
  send — mirrors how GA users are stored. Not in this PR.

### Domain matching

Normalize both sides to hostname-without-`www`. `erpfunds.com`, `https://erpfunds.com/`, and
`https://www.erpfunds.com/about` all match the site `erpfunds.com`. Subdomains other than
`www` are treated as non-matches (conservative).

## Config (operator setup, one-time)

In `credentials.env`:

- `GOOGLE_SEARCH_API_KEY=…` (Google Cloud API key with Custom Search API enabled)
- `GOOGLE_SEARCH_ENGINE_ID=…` (Programmable Search Engine ID, configured to search the entire web)

## Testing

- `fetchSearchPresence` (mocked fetch): finds the domain and reports its 1-based position;
  matches across `www`/scheme/path variants; returns `{foundOnPage1:false, position:null}`
  when absent; throws on non-OK response.
- `readSearchConfig`: null when either env var is unset; returns both when present.
- Live verification: `"ERP funds"` → `erpfunds.com` returns `foundOnPage1: true` (after the
  API key + engine are configured).

## Dependencies

None — uses global `fetch`.
