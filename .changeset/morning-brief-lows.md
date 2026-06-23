---
"@reddoorla/maintenance": patch
---

Morning-brief LOW sweep (2026-06-23): a batch of small correctness, hardening, and test-fidelity fixes.

- **Unknown `?site=` slug on `/submissions` now 404s** instead of silently returning the whole fleet (LOW-2).
- **`/submissions` page-beyond-last** shows a clear "no submissions on page N" notice + a link to the last real page, instead of an empty list under a "120 submissions" header with an impossible "Page 5 of 3" pager (LOW-3).
- **Dashboard handlers authenticate before the Airtable/Turso env guards**, so an unauthenticated probe gets a 401 rather than a differentiated 500 that discloses which backend env is unset (LOW-4; fleet-homepage / site-dashboard / submissions-page).
- **`data-approve-url` is now HTML-escaped** on both the cockpit approve strip and the per-site approve button, matching the already-escaped `data-report-id` (LOW-5).
- **Invalid `formType` is rejected** at the ingest normalizer instead of silently coercing to `contact` (which dropped the newsletter Mailchimp fan-out for a typo'd type); an absent/blank `formType` still defaults to `contact` (LOW-6) — matching `createIngestEndpoint`'s behavior.
- **Newsletter webhook egress is restricted to PUBLIC https URLs** via a new `isPublicHttpsUrl` guard that blocks loopback/private/link-local/CGNAT hosts (SSRF defense-in-depth; LOW-7).
- **Dynamic `.js/.mjs/.cjs` fleet inventories now scheme-allowlist `deployedUrl`** like the JSON/Airtable providers, so a module returning `file://` can't reach Chrome/lhci (LOW-8).
- **`verifyFormsToken` hashes both inputs to a fixed-length digest before the constant-time compare**, removing the length-based early return (LOW-10).
- Dropped an orphaned/misplaced JSDoc block on `parseExtraFields` (LOW-12).
- Added tests for the `runMigrations` lost-marker re-run path (LOW-13) and for the `/submissions` date filter built from the UI's `YYYY-MM-DD` inputs (LOW-14).
