# Dashboard submission cap + per-site vulnerability detail + Airtable request throttle

> **For agentic workers:** TDD, one concern per commit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three operator-facing fixes: (1) cap the cockpit form-submission strip so it can't grow unbounded, (2) show the actual vulnerabilities (not just counts) on per-site pages, (3) stop tripping Airtable's 5 req/s limit by throttling all Airtable HTTP through one chokepoint.

**Architecture:** All three are additive and independent. #1 caps at render time (fetch + per-site counts unchanged). #2 persists the advisory list the security audit already produces into a new Websites field and renders it. #3 wraps the single `base._base.runAction` funnel with a min-interval throttle.

**Tech Stack:** TS ESM, vitest, Airtable JS SDK, SvelteKit fleet (rendered HTML strings).

---

## Concern 1 — Cap cockpit submissions strip

**Files:**

- Modify: `src/dashboard/fleet-render.ts` (`submissionsStrip`)
- Modify: `src/dashboard/render.ts` (`submissionsSection` heading honesty)
- Test: `tests/dashboard/fleet-render.test.ts`, `tests/dashboard/render.test.ts`

- [ ] Cap `submissionsStrip` to the 10 newest rows; keep `<h2>📥 New submissions (N)</h2>` showing the true total; when `subs.length > 10`, append a `+M more — triage on each site page` row. Per-site counts (`subCountBySite`) are unaffected because the cap is at render only.
- [ ] `submissionsSection` (per-site): when `submissions.length > 25`, show `showing 25 of N` so the heading stops implying all are listed.
- [ ] Tests: strip renders ≤10 rows + `+M more` when over; heading shows true total; per-site shows the truncation note only when truncated.

## Concern 2 — Vulnerabilities on per-site pages

**Files:**

- Create Airtable field FIRST: Websites `Security advisories` (long text / multiline).
- Modify: `src/audits/security-airtable.ts` (advisory extractor + shared `SecurityAdvisory` type)
- Modify: `src/audits/write-audits-to-airtable.ts` (carry advisories into the atomic write)
- Modify: `src/reports/airtable/websites.ts` (`SecurityAdvisory` field set + slice in `updateAuditFields`; `WebsiteRow.securityAdvisories` + parser)
- Modify: `src/dashboard/render.ts` (render advisory list grouped by severity)
- Test: `tests/audits/security-airtable.test.ts`, `tests/audits/write-audits-to-airtable.test.ts`, `tests/reports/airtable/websites.test.ts` (or wherever mapRow is tested), `tests/dashboard/render.test.ts`, `tests/_helpers/website-row.ts`

- [ ] `SecurityAdvisory = { module: string; severity: "low"|"moderate"|"high"|"critical"; title: string; cves: string[]; url: string | null }`.
- [ ] `advisoriesFromResult(result)` reads `details.advisories ?? []`, normalizes each entry, drops malformed ones.
- [ ] `securityAdvisoryFields(advisories)` → `{ "Security advisories": JSON.stringify(capped) }`, severity-sorted (critical first), capped at 25. An empty array writes `"[]"` so a clean run clears a stale list.
- [ ] `updateAuditFields` gains `securityAdvisories?: SecurityAdvisory[]` slice merged into the atomic write.
- [ ] write-audits: when `sec && hasSecurityCounts(sec)`, also set `audits.securityAdvisories = advisoriesFromResult(sec)`.
- [ ] `WebsiteRow.securityAdvisories: SecurityAdvisory[] | null`; `parseSecurityAdvisories(raw)` validates inner shape, null on absent/empty/invalid; default `null` in `tests/_helpers/website-row.ts`.
- [ ] Per-site render: a `securitySection(site)` listing advisories grouped/sorted by severity; each row `severity · module · title (CVE) ▸ advisory`. Section omitted when `securityAdvisories` is null or empty. Count tile stays.

## Concern 3 — Airtable request throttle

**Files:**

- Create: `src/reports/airtable/throttle.ts`
- Modify: `src/reports/airtable/client.ts` (`openBase` applies it)
- Test: `tests/reports/airtable/throttle.test.ts`

- [ ] `createMinIntervalThrottle({ minIntervalMs, now, delay })` returns `wrap(fn)` that serializes call _starts_ spaced by `minIntervalMs`, preserving argument pass-through and call order. Callback-style safe (does not await the wrapped fn's completion).
- [ ] `applyThrottle(base, opts)` replaces `base._base.runAction` and `base.runAction` with throttled versions (no-op if `_base` absent). Exported for test.
- [ ] `openBase` calls `applyThrottle(base, { minIntervalMs: 220, now: Date.now, delay: setTimeout-promise })`.
- [ ] Tests (fake clock): two rapid calls are spaced ≥ minIntervalMs; args forwarded; order preserved; underlying spy invoked once per call.
