---
"@reddoorla/maintenance": minor
---

feat(workflow): 0.8.0 — close the operator workflow loop opened in 0.7.0.

**New: `audit lighthouse --write-airtable [slug]`**

Pushes the 4 Lighthouse scores directly to the matching Websites row in Airtable, plus a `Last lighthouse audit at` timestamp. Slug defaults to the cwd's `package.json#name` if not provided. Refuses to write if the lighthouse audit failed (won't overwrite good scores with garbage). Eliminates the manual paste step from the report-drafting flow.

**New: `--fleet airtable`**

Inventory keyword to read sites directly from the Airtable Websites table instead of a JSON file. Combined with `REDDOOR_FLEET_WORKDIR` env var (or `--workdir`), lets operators run `reddoor-maint audit --fleet airtable` against the full Airtable fleet. Excludes sites where both maintenance + testing freq are None.

**Reports: orchestrator test coverage**

`draftReportForSite`, `sendApprovedReports`, and `sendOne` now have real integration tests using a typed `Pick<AirtableBase, …>` fake at `tests/reports/_helpers/fake-airtable-base.ts`. Covers recipient resolution + fallback, Subject override, B1 attachment shape (header + bundled CIDs), B2 idempotencyKey, H4 non-clobbering stamp, missing-headerImage error, orphan-siteId error.

**Reports: vendored CloudFront images**

`check.png` and `blurredTests.jpg` are bundled in `src/reports/maintenance-email/assets/` and embedded inline via CID alongside the per-site header. The previous external dependency on `d3eq0h5l8sxf6t.cloudfront.net` is gone; emails are ~600 KB heavier on Maintenance variants and self-contained.

**Reports: defensive cleanups**

- `findDueReports` skips sites in status `deprecated` or `probably not our problem`.
- `attachRenderedHtml` dead-code removed; `uploadHtmlAttachment` moved from `draft.ts` → generalized `uploadAttachment` in `airtable/attachments.ts`.
- Webhook now imports `findReportByMessageId` + `setDeliveryStatus` from the shared module (was duplicating the query inline).
- `STATUS_MAP` is single-source at `src/reports/webhook-events.ts` (was duplicated in the webhook test).

**Perf: `audit --fleet` parallelizes across sites**

Switched from a sequential for-loop to `runAuditsAcross`. Fleet of 30 sites × 5 audits each goes from ~30 min serial to roughly the longest single-site audit time.

**Required env (unchanged):** `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). New optional: `REDDOOR_FLEET_WORKDIR` (default workdir for `--fleet airtable`).

**Still deferred to 0.9.0:** GA Data API integration, webhook deployment pipeline (Netlify site provisioning).
