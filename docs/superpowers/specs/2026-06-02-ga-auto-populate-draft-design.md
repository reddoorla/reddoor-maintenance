# GA analytics auto-populated into report drafts

**Date:** 2026-06-02
**Status:** Approved

## Problem

Report drafts leave the two analytics fields — "GA users (period)" and "GA users (prev
period)" — blank. The operator types them in by hand in Airtable before approving. The GA
Data API path was blocked until 2026-06-01, when domain-wide delegation (SA impersonates a
Workspace user) was proven working (property `471880366` → 666 active users). Now we can
populate these at draft time.

## Goals

- At draft time, fetch a site's GA "Users" for the report period and the equal-length
  previous period, and write them into the Reports row.
- Never let a GA problem block a draft — GA is an enhancement; manual entry stays the fallback.

## Non-goals

- Populating GA4 property IDs across the fleet (operator data entry; that field is currently
  empty for every site). ERP's `471880366` lets us verify end-to-end.
- Re-fetching at send time. Draft-time only, so the operator reviews the number before approving.

## Current state (verified)

- `WebsiteRow.ga4PropertyId` exists (Airtable "GA4 property ID") — empty for all sites today.
- `ReportRow.gaUsersCurrent/Previous` exist (Airtable "GA users (period)" / "(prev period)").
- `createDraft` does NOT write the GA fields. `DraftInput` has no GA fields.
- Credentials load from `~/.config/reddoor-maint/credentials.env` into `process.env`.
- Auth: SA key + `JWT({ subject })` domain-wide delegation, scope `analytics.readonly`.

## Design

### `src/reports/ga/client.ts`

```
fetchPeriodUsers({ propertyId, subject, keyPath }, periodStart, periodEnd)
  → Promise<{ current: number, previous: number }>
```

- Build `JWT` from the SA key file (`keyFile`/parsed JSON) with `subject` (impersonation) and
  scope `https://www.googleapis.com/auth/analytics.readonly`; pass as `authClient` to
  `BetaAnalyticsDataClient`.
- Metric: **`activeUsers`** (GA4's headline "Users"; matches the spike's 666).
- Current window = `[periodStart, periodEnd]`. Previous window = the same length, ending the
  day before `periodStart`. (length = days(periodEnd − periodStart); prevEnd = periodStart − 1
  day; prevStart = prevEnd − length.)
- Dates formatted `YYYY-MM-DD` in UTC (consistent with the rest of the reports pipeline).
- Throws on any GA/auth/API error (caller decides what to do).

### `src/reports/ga/config.ts`

```
readGaConfig() → { subject: string, keyPath: string } | null
```

Reads `GA_SUBJECT` and `GA_SA_KEY_PATH` from `process.env` (credentials already loaded).
`keyPath` defaults to `<config dir>/ga-service-account.json` (alongside `credentials.env`).
Returns `null` when `GA_SUBJECT` is unset → GA is simply skipped (soft).

### `DraftInput` + `createDraft` (`reports.ts`)

`DraftInput` gains optional `gaUsersCurrent?: number` and `gaUsersPrevious?: number`. When
present, `createDraft` writes "GA users (period)" / "GA users (prev period)". When absent,
behaves exactly as today (fields unwritten → operator fills manually).

### `draftReportForSite` (`draft.ts`)

After deriving `periodStart`/`periodEnd`:

1. `cfg = readGaConfig()`. If `cfg` is null OR `siteRow.ga4PropertyId` is null → skip GA.
2. Else `try { { current, previous } = await fetchPeriodUsers({ propertyId, ...cfg }, start, end) }`
   and pass into `createDraft`.
3. `catch` → log `⚠ GA skipped for <site>: <reason>`, leave GA fields unwritten, continue.

This runs only on the real (`base !== null`) path. The `previewOnly` path is unchanged.

## Error handling

Soft-fail everywhere: missing config, missing property ID, auth failure, API error, or a
zero-row response all resolve to "GA fields not written; draft still created with a warning."
A report can always be completed by hand, exactly as today.

## Testing

- `fetchPeriodUsers`: mocked analytics client — asserts the **previous window** math (same
  length, ends day before `periodStart`) and that both metric values are parsed to numbers.
- `readGaConfig`: returns null when `GA_SUBJECT` unset; resolves default `keyPath`; honors
  `GA_SA_KEY_PATH` override.
- `draftReportForSite` GA wiring (GA fetch mocked): success path writes both fields into the
  created row; thrown GA error → fields unwritten AND draft still created (soft-fail);
  null property ID → GA never called.

## Dependencies

Adds `@google-analytics/data` and `google-auth-library`.

## Config (operator setup)

In `~/.config/reddoor-maint/credentials.env`:

- `GA_SUBJECT=tucker@reddoorla.com`
- `GA_SA_KEY_PATH=…/ga-service-account.json` (optional; defaults alongside credentials.env)

Plus the SA key JSON copied to that path. Per site: fill "GA4 property ID" in Airtable.
