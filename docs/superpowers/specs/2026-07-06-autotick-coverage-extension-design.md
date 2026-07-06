# Auto-Tick Coverage Extension — Design

**Date:** 2026-07-06
**Status:** Approved (design) — pending plan
**Repo:** reddoor-maintenance
**Related:** `src/reports/auto-tick.ts`, `src/reports/checklist.ts`, `src/audits/`, `src/reports/airtable/`

## Goal

Extend the report auto-tick system so that **6 of the 7 currently-manual Testing-report checklist
items** gain an automated evidence source, following the same fail-safe pattern the existing
auto-ticks already use. Ticking stays honest: a box is only auto-ticked on a **fresh (≤3-day)
pass**, and each tick stamps a **note that states exactly what was proven** — never more than the
evidence supports.

The seventh item (Interactions & Animations) cannot be trustworthily auto-ticked from the
checkout-free fleet model; it is deferred to a separate follow-up spec (see
[Decomposition](#decomposition)).

## Background: the current auto-tick mechanism

`autoTickChecklist(site, reportType, now, signals)` in `src/reports/auto-tick.ts` returns a
`Map<field, EvidenceRecord>` consumed by `draftReportForSite` (`src/reports/draft.ts`). Types:

```ts
export type EvidenceResult = "pass" | "fail" | "unknown";
export type EvidenceRecord = { result: EvidenceResult; checkedAt: string | null; note: string };
```

**The fail-safe invariant (must be preserved):** only `result === "pass"` ticks a box. `fail`,
`unknown`, and *omission* all leave the box manual. An evidence function returns `null` to omit
(the signal never ran / isn't applicable), so absence of data never fabricates a tick.

**Freshness:** persisted signals are gated by `isFresh(checkedAt, now)` with `STALE_DAYS = 3`.
A stale `pass` degrades to `unknown` (no tick). Each persisted signal therefore needs its own
`*CheckedAt` timestamp on the Websites row.

**Two wiring conventions (do not conflate):**
1. **Inline signals** live in the `AutoTickSignals` object (today: only `search`, fetched live at
   draft time). Google Indexed uses this — its evidence is inherently fresh (`checkedAt = now`).
2. **Persisted signals** are read directly off the `WebsiteRow` argument (`site`) inside each
   `*Evidence` helper. Security, Domain, and the three Browser verdicts use this. **Every new
   evidence source in this spec is a persisted signal** and follows convention 2.

Each tick is a pure helper `*Evidence(site: WebsiteRow, now: Date): EvidenceRecord | null`,
dispatched in `autoTickChecklist` behind a `fields.has("<field>")` guard.

### What ticks today (for reference)

`googleEvidence`, `securityEvidence`, `domainEvidence`, and `browserEvidence` (×3: Desktop /
Mobile / Links). The 7 items below have **no** evidence function.

## Decomposition

"All seven" spans two genuinely different subsystems. This spec is **Spec 1** and covers only the
first; **Spec 2** is a documented follow-up.

- **Spec 1 (this document) — Auto-tick coverage extension.** Entirely within reddoor-maintenance.
  Adds evidence for **Deploy & Function Health, Tested After Updates, Uptime Checked, Page Titles &
  Meta, Form Functionality, CMS Checked** (6 of 7). Server-side signals + evidence functions,
  following the existing audit → Airtable → evidence pattern.
- **Spec 2 (follow-up) — Per-site smoke suite.** Spans reddoor-starter + reddoor-website + a fleet
  clone/run path. Backs **Interactions & Animations** (the 7th) with per-site authored e2e, and
  upgrades Form Functionality from "present & valid" toward real submission coverage. Reuses the
  tri-state verdict storage and evidence-wiring this spec establishes. Sketched in
  [Appendix: Spec 2 preview](#appendix-spec-2-preview); designed in its own cycle.

## Design principles

1. **Honest proxy ticks (chosen policy).** Where a check proves less than the client-facing label
   implies, still tick on a passing proxy, and make the `note` state precisely what was verified
   (e.g. "Netlify build ready" — not "functions pinged"). Labels are unchanged; the note carries
   the truth.
2. **Fail-safe preserved.** Only a fresh pass ticks. Never-ran → omit (manual). Stale → unknown.
   A genuine failure → `fail` (box goes red), never silently manual.
3. **Checkout-free fleet model.** New audits must run without cloning the site repo where possible,
   self-skip cleanly when their input is absent, and never red an unrelated site.

## Prerequisite: tri-state verdict storage

**Problem (latent bug surfaced by the mapping):** an Airtable **checkbox** column round-trips
`false → null` on read (an unchecked box is omitted, and the `typeof === "boolean" ? … : null`
read-guard maps a stored `false` back to `null`). For a verdict, `null` means "never ran" → omit.
So a genuinely **failing** check would silently stay manual instead of going red — the failure is
swallowed. (The fail-safe invariant still holds — it never *falsely* ticks — but a real problem is
hidden from the operator.)

**Fix for this spec:** every **new** verdict column is stored as an Airtable **single-select**
with options `pass` / `fail` (empty = never ran), not a checkbox. The `WebsiteRow` field type is
`"pass" | "fail" | null`:

- audit produces `boolean | null`;
- the write-builder serializes `true → "pass"`, `false → "fail"`, `null → clear the cell`;
- `mapRow` reads `"pass" | "fail"`, anything else → `null`;
- the evidence function keys off the string directly: `null → omit`, stale → `unknown`,
  `"pass" → pass`, `"fail" → fail`.

This distinguishes **fail (red)** from **never-ran (manual)** unambiguously.

**Out of scope:** retrofitting the *existing* boolean verdicts (`crossbrowserOk`, `mobileOk`,
`linksOk`). They inherit the same latent hide-a-failure behavior, but they remain fail-safe and
migrating live columns is a separate change. New columns adopt the correct convention from day one.

## Per-item evidence design

All six are persisted signals read off `WebsiteRow`. New `WebsiteRow` fields are in **bold**.

### 1. Deploy & Function Health — `Maint: Deploy & Function Health`

- **Source:** existing `deployStatus` (from the `netlify-deploy` audit; Airtable "Deploy status").
- **Freshness gate:** **`deployCheckedAt`** — the `netlify-deploy` audit already *writes* "Deploy
  checked at" to Airtable, but `mapRow` does not read it back. Fix: map it into `WebsiteRow`.
  (Do **not** gate on `lastDeployAt` — that is deploy *time*, so a healthy site not redeployed in
  >3 days would wrongly go stale and omit.)
- **Logic (`deployEvidence`):** null status or no `deployCheckedAt` → omit; stale → unknown;
  `deployStatus === "ready"` → **pass**; `error | failed | rejected` → fail; anything in-flight
  (`building | enqueued | processing | …`) → unknown.
- **Note:** `"Netlify production build ready (functions not separately pinged)"`.
- **Honesty:** this is Netlify *build* state, not a serverless-function invocation probe. An actual
  function health-ping is a possible future enhancement (a new audit), out of scope here.

### 2. Tested After Updates — `Test: Verified After Updates`

(Column keeps its original name; the client-facing label is "Tested After Updates".)

- **Source:** existing `defaultBranchCi` (`passing | failing | pending | none`) from the
  `github-signals` sweep. Already persisted, unused by auto-tick.
- **Freshness gate:** existing `githubSignalsAt`.
- **Logic (`updatesEvidence`):** no `githubSignalsAt` → omit; stale → unknown;
  `defaultBranchCi === "passing"` → **pass**; `"failing"` → fail; `"pending"` → unknown;
  `"none"` (repo has no CI) → omit (stays manual).
- **Note:** `"Default-branch CI green on latest commit"`.
- **Honesty:** the starter's CI runs the automated test suite (vitest + Playwright a11y + lint), so
  a green default branch genuinely means "automated tests passed after the latest change." It is
  not a human re-test, and no-CI repos can't tick — both reflected in the omit rules and the note.

### 3. Uptime Checked — `Maint: Uptime Checked`

- **Source:** **`reachableOk`** — a new verdict emitted by the extended `browser` audit. The audit
  already performs `page.goto` against the live URL for every sampled route and records each HTTP
  status; today it folds that into `crossbrowserOk` and discards the reachability signal.
  `reachableOk = true` iff every sampled route returned 2xx/3xx.
- **Freshness gate:** existing `browserCheckedAt` (shared with the other browser verdicts).
- **Logic (`uptimeEvidence`):** `reachableOk === null` or no `browserCheckedAt` → omit;
  stale → unknown; `"pass"` → **pass**; `"fail"` → fail.
- **Note:** `"All sampled routes reachable (point-in-time)"`.
- **Honesty:** a nightly point-in-time check, not continuous monitoring — stated in the note. We do
  **not** add a separate HTTP probe; the browser audit already fetches every route.

### 4. Page Titles & Meta — `Test: Page Titles & Meta`

- **Source:** **`titleMetaOk`** — a new verdict from the extended `browser` audit. On each
  already-open page (chromium only, no extra navigation): `await page.title()` plus one
  `page.evaluate` reading `meta[name="description"]` and OG/canonical tags.
- **Freshness gate:** existing `browserCheckedAt`.
- **Pass rule (`titleMetaOk = true`):** every sampled route has a non-empty `<title>` of length
  ≤ 70 chars **and** a non-empty `meta[name="description"]` **and** no duplicate `<title>` across
  the sampled routes. OG/canonical are recorded in the audit details for the dashboard but are
  **not** required to pass.
- **Logic (`titlesEvidence`):** same tri-state/freshness shape as above.
- **Note:** `"Titles present (≤70 chars, unique) + meta descriptions present"`.

### 5. Form Functionality — `Test: Form Functionality`

- **Source:** **`formOk`** — a new verdict from the extended `browser` audit (safe subset, no live
  submission). On the sampled routes, detect a `<form>`; if present, assert required-field client
  validation blocks an empty submit, and confirm the form's action endpoint responds non-5xx to a
  lightweight probe.
- **Freshness gate:** existing `browserCheckedAt`.
- **Pass rule (`formOk`):** a `<form>` is present **and** required-field validation is enforced
  **and** the submit endpoint responds non-5xx → `true`. Form present but validation missing or
  endpoint unreachable → `false`. **No `<form>` found on any sampled route → `null`** (omit, not
  fail — the site may legitimately have no form).
- **Logic (`formsEvidence`):** tri-state/freshness shape.
- **Note:** `"Form present, required-field validation enforced, endpoint responds (not a live submission)"`.
- **Honesty:** proves presence + validation + reachability, **not** delivered submission. True
  end-to-end submission is blocked by live-prod side effects (real DB rows / emails / webhooks on
  the ingest hot path) and the optional Cloudflare Turnstile widget; that is Spec 2 territory.

### 6. CMS Checked — `Maint: CMS Checked`

- **Source:** **`cmsOk`** — a new checkout-free `prismic-health` audit: `GET
  https://{prismicRepo}.cdn.prismic.io/api/v2` and assert **200** with a `refs` array containing a
  resolvable master ref.
- **Config input:** **`prismicRepo`** — a new per-site Airtable config field holding the Prismic
  repository name. Chosen over reading `slicemachine.config.json` from a clone because the CMS probe
  must stay checkout-free. **Onboarding cost:** the field must be populated per site (12 sites);
  until then, the audit self-skips and the box stays manual.
- **Freshness gate:** **`cmsCheckedAt`** (new, written by the audit).
- **Logic (`cmsEvidence`):** `cmsOk === null` or no `cmsCheckedAt` → omit; stale → unknown;
  `"pass"` → **pass**; `"fail"` → fail.
- **Note:** `"Prismic API reachable, master ref resolves"`.
- **Honesty:** reachability + ref resolution, **not** edit/login/publish health.

### Dispatch summary (in `autoTickChecklist`)

Six new `fields.has(...)` blocks, mirroring the existing ones:

| field | evidence fn |
|---|---|
| `Maint: Deploy & Function Health` | `deployEvidence(site, now)` |
| `Maint: CMS Checked` | `cmsEvidence(site, now)` |
| `Maint: Uptime Checked` | `uptimeEvidence(site, now)` |
| `Test: Page Titles & Meta` | `titlesEvidence(site, now)` |
| `Test: Form Functionality` | `formsEvidence(site, now)` |
| `Test: Verified After Updates` | `updatesEvidence(site, now)` |

## Producer changes

### A. Deploy freshness fix
Add `deployCheckedAt: string | null` to `WebsiteRow` and read "Deploy checked at" in `mapRow`
(`src/reports/airtable/websites.ts`). No audit change — the value is already written.

### B. Browser-audit extension (`src/audits/browser.ts` + its Airtable extractor)
Emit three new verdicts from the existing Playwright runs, computed on the pages already opened:
- `reachableOk` — every sampled route returned 2xx/3xx (already collected, now surfaced).
- `titleMetaOk` — title/meta rule above (chromium only).
- `formOk` — form safe-subset rule above.

Each flows through the existing browser-audit → extractor → write-back path as a **new
single-select column** (`pass`/`fail`, tri-state per the prerequisite). No new timestamp — reuse
`browserCheckedAt`.

### C. New `prismic-health` audit (`src/audits/prismic-health.ts`)
Checkout-free, dependency-light (uses global `fetch`; `import type` only for shared audit types —
no `airtable`/libSQL/mjml static import, so `test:dist` passes). Returns `AuditResult` with
`details: { cmsOk, checkedAt }`. **Self-skips** to `status: "skip"` with **no** details when
`prismicRepo` is absent, so it never reds an unrelated site.

## Wiring: the vertical slice (per new audit / verdict)

Follow the established pattern end-to-end:

1. **Audit impl** returns `AuditResult` with its details + `checkedAt`; self-skips (no details)
   when input absent.
2. **Register** in `src/audits/index.ts` `REGISTRY` and the `AuditName` union (`prismic-health`).
   (Browser verdicts extend the existing `browser` audit — no new registry entry.)
3. **Airtable extractor** (`*-airtable.ts`): `hasXResult` true only when it really ran, plus
   `xResultFromAudit`; `import type` only.
4. **`WebsiteRow` + `mapRow`** read guard for each new field (single-select → `"pass"|"fail"|null`;
   timestamp → string|null).
5. **Write builder** honoring "null clears the cell / guard-not-determined," wired into
   `updateAuditFields`.
6. **`write-audits-to-airtable.ts`** push block + `WriteSummary` union entry.
7. **Audit classification:** add `prismic-health` to `CHECKOUT_FREE_AUDITS` (and it is **not**
   keyed off `netlifyId`, so not in `NETLIFY_ID_AUDITS`).
8. **Nightly workflow:** add `prismic-health` to the checkout-free nightly list
   (`.github/workflows/fleet-lighthouse.yml`). Browser verdicts ride the existing browser run.
9. **Evidence fn** in `auto-tick.ts` + dispatch block in `autoTickChecklist`.

## New Airtable columns (single source of change outside code)

- `Deploy status` freshness — **read** existing "Deploy checked at" (no new column).
- **`Uptime Reachable`** (single-select pass/fail) → `reachableOk`.
- **`Titles & Meta OK`** (single-select pass/fail) → `titleMetaOk`.
- **`Form OK`** (single-select pass/fail) → `formOk`.
- **`CMS OK`** (single-select pass/fail) → `cmsOk`.
- **`CMS Checked At`** (timestamp) → `cmsCheckedAt`.
- **`Prismic Repo`** (text config) → `prismicRepo`.

(Exact column display names finalized in the plan; code keys off the `WebsiteRow` field, not the
label string, except the `mapRow` mapping table.)

## Error handling & fail-safe

- Every audit self-skips (`status: "skip"`, no details) when its input/secret is absent → the
  verdict stays `null` → evidence omits → box manual. No unrelated site is reddened.
- Every evidence fn returns `null` on absent data and `unknown` on stale — only a fresh `pass`
  ticks.
- The nightly fleet summary gate (`FLEET_WRITE_SUMMARY wrote=N failed=M total=T`, reds on
  no-summary / wrote=0 / failed×4>total) is unaffected: a clean self-skip does not count as a
  failure.

## Testing strategy

Coverage is enforced (statements 78 / branches 67 / functions 76 / lines 80) and `include`s
**every** `src/**/*.ts`, so an untested new file scores 0% and trips the floor — each new fn/audit
ships with tests:

- **`tests/reports/auto-tick.test.ts`** — for each of the 6 new evidence fns, cover
  pass / fail / unknown(stale) / omit(absent) branches. Extend the existing suite.
- **`tests/audits/prismic-health.test.ts`** — 200+ref → `cmsOk:true`; non-200/timeout →
  `cmsOk:false`; no `prismicRepo` → skip (no details). Mock `fetch`.
- **`tests/audits/prismic-health-airtable.test.ts`** — extractor tri-state + `hasCmsResult`.
- **Browser extension:** extend `tests/audits/browser*.test.ts` and its airtable extractor test for
  `reachableOk` / `titleMetaOk` / `formOk` (including the no-form → null case).
- Extend `write-audits-to-airtable.test.ts` / `write-fleet-audits.test.ts` for the new push fields.
- All tests write to tmpdir only (working-tree-clean tripwire).

## CI constraints new code must satisfy

`ci.yml` on every push to main and every PR, in order:
1. `pnpm typecheck` = `tsc --noEmit` **and** `tsc --noEmit -p tsconfig.netlify.json` (both).
2. `pnpm lint` = `eslint .` **and** `prettier --check .` (both).
3. `pnpm build` (tsup).
4. `pnpm test:coverage` — enforced thresholds above; new files need tests.
5. `pnpm test:dist` — `smoke-dist.mjs` fails if the audit import graph reaches a central-only
   package (`airtable`, libSQL/Kysely, mjml, …); use `import type` for those; dynamic `import()`
   only inside CLI write-back. Also asserts `--help` lists all commands.
6. Working-tree-clean tripwire.

## Resolved defaults (from the design decisions)

1. **Prismic repo id** → new `Prismic Repo` Airtable config field (checkout-free), not slicemachine
   config. Accepted onboarding cost.
2. **Titles "good"** → non-empty `<title>` ≤70 chars + non-empty meta description + no duplicate
   titles across sampled routes; OG/canonical recorded, not required.
3. **No form found** → omit (manual), not fail.
4. **Tick honesty** → proxy tick + honest note (notes above encode exactly what each proves).
5. **Deploy "Function Health"** → build-ready proxy for now; a real function ping is a future
   enhancement, out of scope.

## Non-goals

- Interactions & Animations auto-tick (Spec 2).
- Real end-to-end form submission (Spec 2).
- Continuous/interval uptime monitoring (point-in-time only).
- Retrofitting existing boolean browser verdicts to tri-state storage.
- Prismic edit/login/publish health (reachability only).
- Serverless-function invocation health-ping.

## Appendix: Spec 2 preview (per-site smoke suite)

Not part of this plan; recorded so this spec's storage/wiring choices anticipate it.

The runner already ships: reddoor-starter carries Vitest 4 + Playwright 1.60 + `@axe-core/playwright`
+ dev fixture routes + `lighthouserc.json`. reddoor-website is the de-facto template — it splits
`test:unit` (vitest) and `test:smoke` (Playwright: per-route HTTP 200, hydration marker, zero
console errors with allowlist, 404 renders error component, nav) and has a real interaction test
(`tests/smoke/portfolio-search.spec.ts`). Spec 2 path: promote that split into the starter so every
`/new-site` inherits it; add one per-site route/expected-content vector (a committed
`tests/smoke.routes.ts` versioned with each site, **or** an Airtable per-site JSON column); reuse
the fleet clone+run path to execute each site's `test:smoke` and write a `smokeOk` verdict to a new
column (same tri-state convention as this spec); bridge it to an `interactionsEvidence` fn and use
it to strengthen `formsEvidence` toward real submission where a site authors that spec.
