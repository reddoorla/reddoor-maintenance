# Google search-presence check

**Date:** 2026-06-02
**Status:** Approved (revised — data source pivoted from Custom Search to Search Console)

## Problem

The report's "Google Indexed" line is a static green checkmark that proves nothing. We want a
real check: for a per-site query (the business name/title), report whether the site ranks on
page 1 of Google — and, when it does, surface the rank as a value-add in the email.

## History — why the pivot

The first cut (PR #94) used the **Google Custom Search JSON API**. Between that PR and this
follow-up we discovered (verified against Google's docs, 2026-06-02) that:

- The Custom Search JSON API is **closed to new customers** ("This API is not available for
  new customers"); existing customers have until **2027-01-01**. The reddoor GCP project had
  never used it → new customer → no usable key.
- "Search the entire web" for Programmable Search Engines is **deprecated** and can no longer
  be enabled; new engines are capped at ≤50 specified domains.

So the free open-web path is gone. The capability code from #94 (`fetchSearchPresence` +
`readSearchConfig`) soft-skips when unconfigured, so nothing is broken in production, but it
cannot go live on that path. **This spec rewrites the data layer to use the Search Console
Search Analytics API** and adds the email surfacing.

## Data source: Search Console Search Analytics API

`POST https://searchconsole.googleapis.com/webmasters/v3/sites/{property}/searchAnalytics/query`

- Body filters to the site's query (`dimension=query`, `operator=equals`, the lowercased
  query string) over the report period, `dimensions: ["query"]`, `rowLimit` small.
- Reads back Google's own **average position** for that query. `foundOnPage1 = avgPosition ≤ 10`.
  The displayed rank is `Math.round(avgPosition)`.
- **No matching row** (zero impressions for that query in the window) → not found → the email
  renders today's plain "Google Indexed" check.
- Throws on any auth/API error — the caller (draft flow) soft-fails, exactly like GA.

**Live-verified 2026-06-02:** impersonating `tucker@reddoorla.com`, `"erp funds"` on
erpfunds.com over 2026-04-30..2026-05-30 returned `position=1.52, impressions=31, clicks=7`
→ `foundOnPage1=true`, displayed `Page 1 Google Result (#2)`.

## Auth — reuse the GA domain-wide delegation

No new credentials. The same service account + domain-wide delegation that powers GA
(`reddoor-reports@reddoor-reports-api.iam.gserviceaccount.com`, impersonating
`tucker@reddoorla.com`) is reused, with the added OAuth scope
`https://www.googleapis.com/auth/webmasters.readonly`. The search client builds a `JWT` from
the same `{ keyPath, subject }` that `readGaConfig()` already returns.

The obsolete `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` env vars are removed — search
piggybacks on GA config; if GA isn't configured, search is simply skipped.

### Operator setup (one-time, all confirmed done 2026-06-02)

- **Workspace Admin → Domain-wide delegation:** add scope `webmasters.readonly` to the SA's
  existing client ID (it already had `analytics.readonly`).
- **GCP project:** enable the **Search Console API** (`searchconsole.googleapis.com`) in
  project `reddoor-reports-api` (was the missing piece the spike caught).
- **Search Console:** the impersonated identity must have access to each fleet property.

## Design

### `src/reports/search/config.ts` (rewrite)

`readSearchConfig()` no longer reads `GOOGLE_SEARCH_*`. Search uses GA's config; this module
either disappears or becomes a thin re-export of `readGaConfig()`. Decision: **delete
`config.ts`**; the draft flow calls `readGaConfig()` directly (one source of truth for the SA
credentials), matching how `fetchGaUsers` already works.

### `src/reports/search/client.ts` (rewrite)

```text
fetchSearchPresence({ keyPath, subject, property, query }, periodStart, periodEnd)
  → Promise<{ foundOnPage1: boolean, position: number | null }>
```

- Builds a `JWT` (scope `webmasters.readonly`, `subject`), POSTs the searchAnalytics query for
  `query` over `periodStart..periodEnd`, returns the rounded average position (or `{false,
  null}` when no row). The explicit period (start/end `Date`s) matches the report window and is
  passed in by the caller, exactly like `fetchPeriodUsers`.

### Per-site property — `WebsiteRow` + Airtable

- Keep the existing **"Search query"** column → `searchQuery` (the query string to filter on).
- Add an **optional** column **"Search Console property"** → `searchConsoleProperty: string | null`.
  Used verbatim when set (handles `sc-domain:erpfunds.com` or `https://www.erpfunds.com/`);
  when blank, default to `sc-domain:<bareHost>` derived from the site URL. erpfunds.com is
  verified as both forms, so the `sc-domain:` default works.

### `src/reports/draft.ts` — soft-fetch (near-copy of `fetchGaUsers`)

`fetchSearch(siteRow, periodStart, periodEnd)`:

- Returns `null` when GA/SA isn't configured, the site has no `searchQuery`, or the API errors
  (one-line `console.warn`). Never blocks a draft.
- Otherwise returns `{ foundOnPage1, position }`. The draft renders with `searchPosition` and
  stores the result on the Reports row.

### Reports row storage — two new columns

Mirrors how GA users are stored (written at draft, read at send):

- **"Search found page 1"** (checkbox) — written **whenever the check ran** (true _or_ false).
  `false` = checked-and-not-on-page-1; blank = never checked. This is the operator-only
  negative signal (never shown to the client).
- **"Search position"** (number) — the rounded average position, written only when found.

`DraftInput` / `ReportRow` gain matching optional fields, written conditionally exactly like
the GA fields. `orchestrate.ts` (send path) reads them back and re-renders identically.

### `ReportData` + template — the only visible change

- `ReportData.searchPosition?: number | undefined` carries the rank to the template.
- `maintenanceChecksSection(searchPosition?)` enriches the **"Google Indexed"** row:
  - **on page 1** → label `Page 1 Google Result (#N)` + the same green check.
  - **not found / unchecked** → label `Google Indexed` + green check (today's exact behavior).
- The check icon never changes; no new image asset; the client never sees a negative. The
  rank number `(#N)` is shown per the approved decision (Google's measured average position).

## Data flow

```text
draft.ts: readGaConfig() + siteRow.searchQuery + property → fetchSearchPresence()  [soft-fail → null]
   ↓ render w/ searchPosition              ↓ store on Reports row
template: enrich "Google Indexed" row      Airtable: "Search found page 1" + "Search position"
   ↑ re-render at send (orchestrate.ts) ← read back from Reports row
```

## Testing

- `fetchSearchPresence` (mocked `JWT.request`): parses average position → rounded rank + page-1
  boolean; no-row → `{false, null}`; throws on non-OK.
- Property resolution: explicit column used verbatim; blank → `sc-domain:<host>` default.
- `draft.ts` `fetchSearch`: null when unconfigured / no query / API throws; value otherwise.
- `createDraft` / `mapRow` round-trip the two Reports fields (checkbox written true _and_ false).
- `render` / template: enriched row when `searchPosition` set; plain row when absent.
- `orchestrate` re-render reads the stored fields back.
- Live verify (done): `"erp funds"` → erpfunds.com → `Page 1 Google Result (#2)`.

## Non-goals

- Rank tracking over time / trend on the search position (GA-style trend line for search).
- Competitor analysis, multi-query per site, clicks/impressions in the email.
- Auto-verifying Search Console properties (operator does that out of band).

## Dependencies

`google-auth-library` (already a dependency, used by the GA client). No new packages.
