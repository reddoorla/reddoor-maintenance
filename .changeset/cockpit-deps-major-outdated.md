---
"@reddoorla/maintenance": patch
---

Cockpit deps metric now surfaces the registry-major outdated count. The deps audit already computed `OutdatedCounts.major` (how many installed deps are a full major behind npm's latest), but it was dropped at `depsCountsFromResult` and never reached the dashboard — the cockpit only showed `X drifted (Y major) · Z outdated`, where `(Y major)` is drift vs the fleet baseline, easily misread as "majors available". The count is now plumbed through `DepsCounts` → the Airtable `Deps Major Outdated` field → `WebsiteRow.depsMajorOutdated` → the render, so the deps span reads `X drifted (Y major) · Z outdated (N major)` — the new `(N major)` being majors behind the registry, distinct from the baseline-drift major. The value is null-guarded end to end: it's only written/rendered when known (including a real 0), and absent on older Airtable rows it simply omits, so nothing is back-filled with a misleading count.

Note: requires a Number field `Deps Major Outdated` on the Websites table before the audit writes a non-null value.
