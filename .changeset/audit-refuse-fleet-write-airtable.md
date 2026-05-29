---
"@reddoorla/maintenance": patch
---

`audit --write-airtable` now refuses to run when combined with `--fleet`, exiting with code 2 and a clear message before any audit work begins. Previously the combo silently overwrote one Airtable Websites row's dashboard tiles with results pooled across all fleet sites (cwd-derived slug + flat `AuditResult[]`) — dashboard-wrong, not crash-loud. Per-site writes are the supported path: `cd <site>/ && reddoor-maint audit --write-airtable`. Per-site batched fleet writes can return as a follow-up when there's actual demand.

Also bundled in this patch: `src/reports/draft.ts` `daysAgo` now uses UTC accessors to stay TZ-consistent with `due.ts` (was the only non-UTC date math left in the reports pipeline; fires only on the first-ever report for a (site, type) pair). And `pnpm.overrides` to force `tmp@>=0.2.6` and `uuid@>=11.1.1`, clearing two transitive security advisories pulled in via `@lhci/cli`. Remaining advisories (mjml chain) have no upstream patch and are accepted with documented rationale in the morning brief.
