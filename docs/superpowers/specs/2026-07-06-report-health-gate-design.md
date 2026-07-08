# Report Health Gate (Site-CI) — Design

**Date:** 2026-07-06
**Status:** Approved (design) — pending plan
**Repos:** reddoor-maintenance (gate, audits, cockpit, email), reddoor-starter (`/health`, form test-mode, smoke suite), reddoor-website (smoke-suite reference)
**Supersedes:** `2026-07-06-autotick-coverage-extension-design.md` (that spec's 6 evidence functions are folded in here)

## Goal

Reframe the report checklist from **a to-do list the operator ticks** into **a site-CI health gate**:
every item is an automated health check, and a maintenance/testing email **cannot be sent while any
gating check is red _or_ unknown**. The operator's job becomes "get the site green, then send" —
send stays a deliberate human (RED-tier) action, with a **logged override** for judgment cases.

To make the gate trustworthy, every currently-manual item gains a **real** signal (function-health,
CMS, uptime, titles/meta, real form submission, interactions), so the "honest note" caveats mostly
dissolve into ordinary check descriptions.

## The reframe in one paragraph

Today `isChecklistComplete` (checklist.ts:65-70) returns true iff every checklist box is manually
`=== true`; `report.autoEvidence` exists but is **display-only** (reports.ts:57-60). We flip the
gate to read the **evidence**, not the boxes: a new predicate passes iff every _gating_ item is
`pass` or `n/a`. The critical inversion — a gating item with **no fresh signal maps to `unknown`,
which blocks** (today an absent signal is omitted → manually passable). Health failures route
through the existing `approveBlockers` machinery (preflight.ts:399) so the proven 409 + dashboard
chip carry them. The cockpit reuses the existing green/amber/red site-health bands. The client email
is **unchanged**.

## Client-facing guarantee: the email does not change

Both email templates render the checklist **exclusively** from static copy arrays
`DEFAULT_COPY.maintenanceChecks` / `testingChecklist` (copy.ts:31-49); `checklistRowsSection`
(email-sections.ts:37-59) emits one row per label and **never** reads the checkbox booleans or the
evidence. The gate/evidence layer is a wholly separate data path. **Two hard guardrails** keep the
reframe invisible to clients:

1. **Never rename the 13 label strings.** A mirror test (checklist.test.ts:93-100) forces internal
   labels to equal `DEFAULT_COPY`, so any label edit _is_ a client-copy change by construction.
2. **Never reorder the arrays; keep "Google Indexed" at index 3.** The email hardcodes `i === 3`
   to inject the live "Page 1 Google Result (#position)" line (template.ts:54-55).

Internal **field names and model/variable renames are decoupled from labels** (checklist.ts:36-39)
and need no base migration and no copy change.

## Background: what exists today

- **Single gate predicate** `isChecklistComplete` (checklist.ts:65-70) reads only booleans.
  `checklistFor(type)` (checklist.ts:54-58): Maintenance → 6 items, Testing → 13, Launch/Announcement
  → `[]` (vacuously ungated).
- **Three enforcement points:** approve front door (approve.ts:57-58 → 409 via
  approve-report.mts:126-128), the hard send backstop in `sendOne` (orchestrate.ts:117-123, throws
  even when Approved-to-send was set directly in Airtable), and the UI disable + live re-gate
  (render.ts:129, checklist.ts:42-45).
- **A parallel evidence-free gate already exists as the template:** `approveBlockers`
  (preflight.ts:399-465) → `PreflightFinding[] {level,check,message}`; `formatBlockers` keeps only
  `fail`; gates approve at approve.ts:62-63.
- **Evidence is parsed but display-only:** `report.autoEvidence` (reports.ts:60), an
  `EvidenceRecord {result: "pass"|"fail"|"unknown", checkedAt, note}` map from `autoTickChecklist`
  (auto-tick.ts). reports.ts:57-59 notes "the gate still reads the booleans, not this."
- **No override exists.**
- **Cockpit:** `checklistBlock` (render.ts:100-121) renders a manual checkbox per item + an
  auto-tick provenance badge. An existing **site-Tier three-band** model — `healthy | watch |
attention` = green | amber | red — has real pill tokens (fleet-render.ts:65-67) and verdict
  backgrounds (:79-87). (A separate `NeedsYouGroup` scale carries a **blue** "approval" band — a
  your-move state, **not** health; do not reuse it here.)

## Core model

### Per-item status

Each checklist item resolves, for a given draft, to one of: **`pass` | `fail` | `unknown` | `n/a`**.
This **extends the existing `EvidenceResult` union** (auto-tick.ts:26, today `"pass" | "fail" |
"unknown"`) with `"n/a"`. `n/a` is a _per-site_ not-applicable state (e.g. a site with no contact
form for the Forms check, or a repo with no CI for Tested-After-Updates) and is distinct from an
item being advisory _per report type_ (which is handled by `gatingFields`, below). Statuses come from
evidence functions in `auto-tick.ts`. Note `EvidenceRecord` is persisted in the `autoEvidence` JSON,
so widening the union is backward-compatible (old records never carry `"n/a"`).

### The semantic inversion (the crux)

Today: absent signal → **omit** → the box stays manually passable. Under the gate: an absent signal
on a **gating** item → **`unknown` → blocks**. Two upstream requirements follow:

1. `auto-tick.ts` must emit a **stored status for every gating item** on every draft — not only the
   items it can currently tick — and `draftReportForSite` (draft.ts:202-206) must persist all of
   them into the `autoEvidence` JSON.
2. Every item is **explicitly partitioned** gating vs advisory vs `n/a`; an unwired gating item
   resolves to `unknown` and the gate could never clear.

### Gating partition (per report type)

| Report type               | Gating (blocks on red/unknown)                                                            | Advisory (shown, never blocks) |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **Maintenance**           | Deploy & Function Health, CMS Checked, Domain/DNS/SSL, Security Updates, Uptime Checked   | **Google Indexed**             |
| **Testing**               | **All 13** (the 6 maintenance items _including_ Google Indexed, plus the 7 testing items) | —                              |
| **Launch / Announcement** | — (ungated, unchanged)                                                                    | —                              |

Rationale (the operator's chosen policy): a routine **Maintenance** email only needs the site
**up and secure** (availability/integrity); Google ranking is reported but never blocks. A
**Testing** sign-off is held to the **full** bar — everything green, including SEO and titles.

### The gate predicate

Add, alongside `isChecklistComplete` in checklist.ts, two pure functions:

```ts
// The items that gate for this report type (partition above).
export function gatingFields(type: ReportType): string[];
// Clear iff every gating field is pass or n/a; fail OR unknown/absent blocks.
export function isHealthGateClear(report: {
  reportType: ReportType;
  autoEvidence: Record<string, EvidenceRecord>;
}): boolean;
// Enumerate blockers for messaging (field + status + note).
export function gatingHealth(report): { field: string; status: EvidenceResult | "n/a" }[];
```

**Effective send gate** = `isHealthGateClear(report) || (report.sendOverride && report.overrideReason?.trim())`.

Swap the three enforcement sites (approve.ts:57, orchestrate.ts:117, render.ts:129 + checklist.ts:42)
to the new predicate. Fold health blockers into `approveBlockers` (preflight.ts:399) so the existing
send-blocked reason + 409 + dashboard chip carry them (reuse the second gate; do not add a third).
Rewrite the `sendOne` done/total message (orchestrate.ts:118-122) to enumerate the failing/unknown
checks by **name + note**.

**Manual ticking is retired for gating:** a manual box tick no longer satisfies the gate. The
per-item toggle endpoint `setChecklistItem` (checklist.ts:29-47) is removed from the gating path
(kept only if repurposed for advisory acknowledgement — see Open items).

### The logged override

Add to `ReportRow` (reports.ts:26-61) + `mapRow` + a raw writer mirroring `approveReportRow`
(reports.ts:367-383): `sendOverride: boolean`, `overrideReason: string | null`, `overrideBy`,
`overrideAt`. The override is a **distinct, deliberate action** — its own endpoint/POST param
threaded through approve-report.mts, and a new `"overridden"` branch in the `ApproveResult` union
(approve.ts:7-37) — **never** the default approve path. An empty reason is rejected as a typed
blocked result. It is **logged**: stamp who/when/reason (parallel to `APPROVED_BY` at approve.ts:64)
and emit a `report_sent_with_override` fleet event via `recordFleetEventsBestEffort`
(orchestrate.ts:15) carrying the reason and the failing/unknown checks. The `sendOne` backstop
(orchestrate.ts:117) must read the override off the row so an overridden report sends instead of
throwing.

## Health signals (evidence → checklist item)

| Checklist item            | Evidence source                                                 | New?                                |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| Deploy & Function Health  | `deployStatus === "ready"` (build) **AND** function-health `ok` | build existing; function-health new |
| CMS Checked               | function-health `details.prismic === "ok"` (server-side probe)  | new (folded into /health)           |
| Domain, DNS & SSL         | `domain` audit (resolve + cert > 14d)                           | existing                            |
| Google Indexed            | Search Console (inline at draft)                                | existing                            |
| Security Updates          | `security` audit (0 critical/high)                              | existing                            |
| Uptime Checked            | browser audit `reachableOk` (all sampled routes 2xx/3xx)        | new verdict                         |
| Desktop Browsers          | browser audit `crossbrowserOk`                                  | existing                            |
| Mobile Browsers           | browser audit `mobileOk`                                        | existing                            |
| Page Titles & Meta        | browser audit `titleMetaOk`                                     | new verdict                         |
| Links & Navigation        | browser audit `linksOk`                                         | existing                            |
| Form Functionality        | `form-e2e` audit verdict (real prod submission, test-mode)      | new                                 |
| Interactions & Animations | `smokeOk` (per-site smoke suite)                                | new                                 |
| Tested After Updates      | `defaultBranchCi === "passing"` (github-signals)                | existing data, new evidence fn      |

One `/health` fetch feeds **two** items (Deploy & Function Health, CMS Checked) via its structured
body. Each evidence fn is a pure `*Evidence(site, now): EvidenceRecord | null`, freshness-gated by
`isFresh` (STALE*DAYS = 3). Honest notes remain (e.g. Uptime "point-in-time"), but as \_descriptions*
not apologies.

## Producer subsystems

### A. Starter `/health` endpoint (reddoor-starter)

`src/routes/health/+server.ts`, `export const prerender = false` (deploys as a Netlify function under
adapter-netlify v6). `GET` returns `{ ok, prismic, forms }`:

- **prismic** (`"ok" | "error" | "skipped"`): `createClient({fetch}).getRepository()` (public
  metadata GET, no token; prismicio.ts), short-circuit `"skipped"` when `isPlaceholderRepo`; wrap in
  try/catch + time-box; return **only** a status string, never the repo body. This is the server-side
  CMS probe the audit folds in.
- **forms**: booleans only — `{ ingestUrl: !!FORMS_INGEST_URL, ingestToken: !!FORMS_INGEST_TOKEN,
turnstile: !!PUBLIC_TURNSTILE_SITE_KEY }`. **Never** POST to the ingest.
- **ok**: a rollup the route defines, e.g. `functionRan && prismic !== "error"`.

Public + unauthenticated → booleans/status strings only, nothing more detailed. Contract: `/health`
**must** genuinely probe Prismic before reporting `ok` (the audit trusts it).

### B. Function-health audit + CMS fold (reddoor-maintenance)

`src/audits/function-health.ts`, checkout-free, fetch-based, dep-light (global `fetch`, no Playwright/
node built-ins), modeled on `domain.ts` (pure core + injected deps + graceful skip). `GET
{site.deployedUrl}/health`, 10s timeout:

- **unreachable / non-JSON / absent** → `{present:false}` → **self-skip, no details** → the Airtable
  writer preserves the prior value (the "no details ⇒ preserve prior" contract). Evidence resolves to
  `unknown` (amber: "not yet measured") → blocks.
- **reachable, non-200 or `ok:false`** → `fail` (red: real runtime problem).
- **`ok:true`** → `pass`; record `details = { ok, prismic, forms, checkedAt }`.

Kept **separate from build state**: new columns **"Function health"** + **"Function health checked
at"** and its own details — it must **not** write "Deploy status" (else `isFailedDeployStatus` stops
meaning "the build failed"). CMS reachability rides `details.prismic`, so **no** per-site Prismic
token in maintenance env and **no** "Prismic Repo" identity column are ever built. Wiring mirrors
netlify-deploy/domain: `AuditName` (types.ts:18-26), `functionHealthDeps?` on `AuditContext`
(inject.ts:9-25), REGISTRY (index.ts), a new `function-health-airtable.ts` (copy
`domain-airtable.ts`; `hasFunctionHealthResult` guards on `details.checkedAt`), websites.ts
(`FunctionHealthResult` type + `functionHealthFields` writer + `WebsiteRow` field + `mapRow`
**read-back** — do the read-back netlify-deploy skipped so a freshness gate works + `updateAuditFields`
slice :657-685), and the collect-and-write block at write-audits-to-airtable.ts:145-150. Add to
`CHECKOUT_FREE_AUDITS` and the checkout-free nightly workflow.

### C. Browser-audit extension: `reachableOk` + `titleMetaOk` (reddoor-maintenance)

Emit two new verdicts from the existing Playwright runs, on pages already opened:

- **`reachableOk`** = every sampled route returned 2xx/3xx (already collected in the goto, currently
  discarded).
- **`titleMetaOk`** (chromium only, one `page.title()` + one `page.evaluate` per open page): pass iff
  every sampled route has a non-empty `<title>` ≤ 70 chars **and** a non-empty
  `meta[name="description"]` **and** no duplicate titles across the sample. OG/canonical recorded in
  details, not required.

Both persist as **new single-select `pass`/`fail` columns** (tri-state — see storage note), gated by
the existing `browserCheckedAt`.

### D. Deploy freshness fix (reddoor-maintenance)

The netlify-deploy audit already **writes** "Deploy checked at" but `mapRow` never reads it back
(websites.ts:523-536). Add `deployCheckedAt` to `WebsiteRow` + `mapRow` so `deployEvidence` has a
freshness stamp (do **not** gate on `lastDeployAt` — that's deploy time, not check time).

### E. Per-site smoke suite + fleet smoke audit → `smokeOk` (all three repos)

reddoor-website is the reference (test:unit/test:smoke split; 4-line shared-base `playwright.config`;
`tests/smoke/pages.spec.ts` with per-route 200 + hydration marker + console-error allowlist + 404;
`portfolio-search.spec.ts` real-interaction template). Starter lags (inline config, single a11y spec).

- **Promote into the starter** (so `/new-site` inherits it): package.json `test` → `test:unit`
  (`vitest run`), replace `test:a11y` with `test:smoke` (`playwright install chromium && playwright
test`); replace inline `playwright.config.ts` with the 4-line `...base` spread of
  `@reddoorla/maintenance/configs/playwright-a11y` (+ `reducedMotion:"reduce"`); move
  `tests/a11y.spec.ts` → `tests/a11y/fixtures.spec.ts`; add `tests/smoke/pages.spec.ts` +
  `attachConsoleWatcher` + a committed **per-site manifest** `tests/smoke/routes.ts`
  (`{path,name,hydrationMarker?,expectStatus?}[]`), shipping the safe default (`/` + footer marker)
  that each site's figma-slices build grows. Real-interaction specs stay per-site.
- **Fleet run + persist (Route A):** new `smoke` `AuditName` + `src/audits/smoke.ts` that runs each
  site's own `pnpm test:smoke` in `site.path` (reuse `cloneIfNeeded`/`prepareFleetSites` + the
  5-min-timeout/`--strictPort` treatment from a11y.ts); exit 0 → `pass`. Persist **"Smoke OK"** +
  **"Last Smoke At"** columns, a `smokeFields()` builder, an `updateAuditFields` branch, a `smoke`
  case in write-audits-to-airtable + `WriteSummary.audit` union, and a `WebsiteRow.smokeOk`
  read-back (the Interactions evidence reads it like `a11yViolations` today).
- **Off-disk CI:** the authoritative reusable workflow `reddoorla/.github` (pinned `@45ded88`) must be
  bumped to invoke `test:unit` + `test:smoke` — the single lever that makes the split run on PRs.

### F. Form-L2 synthetic end-to-end (reddoor-starter + reddoor-maintenance central ingest)

The chosen path: **submit to the real production form; central ingest recognizes a test-mode marker
and suppresses routing.** Ingest path: `contact/+page.server.ts` → `createIngestAction`
(@reddoorla/maintenance/forms) → `submitToIngest` POSTs to `FORMS_INGEST_URL` → central
`ingestSubmission` (src/forms/ingest.ts). All inbox/DB/webhook routing is central + slug-driven.

- **Starter:** add a hidden `testMode` field via `buildPayload` (rides through as an `extraField`, no
  schema change).
- **Central (`ingestSubmission`):** a `testMode` branch that **suppresses side effects** — writes to a
  test table / stamps `notify:"skipped"` / skips fan-out — **and skips Turnstile enforcement** (the
  marker routes away from real sinks, so it grants no bypass benefit to a bot). This suppression
  **must** be central; the starter alone cannot stop the real inbox firing.
- **Turnstile:** the e2e uses Cloudflare's public test sitekey `1x00000000000000000000AA` to satisfy
  the client widget; central verify is fail-open and the testMode branch skips enforcement. **No
  secret lives on the site.**
- **New `form-e2e` fleet audit** (Playwright against the deployed prod URL, like browser.ts): fills
  the contact form, submits with the `testMode` marker, asserts the success response. Persists a
  **"Form E2E OK"** + checked-at verdict → the Forms evidence fn. `n/a` when the site has no contact
  form.

## Tri-state verdict storage (prerequisite)

An Airtable **checkbox** round-trips `false → null` on read, so a genuinely **failing** verdict would
be indistinguishable from "never ran" and (under the gate) both map to `unknown`. That is acceptable
for the _gate_ (both block) but loses the **red vs amber** distinction the cockpit needs. Therefore
every **new** verdict column (`reachableOk`, `titleMetaOk`, `Function health`, `Smoke OK`, `Form E2E
OK`) is a **single-select `pass`/`fail`** (empty = never ran); `WebsiteRow` field type is
`"pass" | "fail" | null`; the writer serializes `true→"pass"`, `false→"fail"`, `null→clear`. Existing
boolean browser verdicts are **not** retrofitted (out of scope; they stay fail-safe).

## Cockpit reframe

Reframe `checklistBlock` (render.ts:100-121): each item's **health** is the primary signal — a
Tier-colored status, not a checkbox + side badge. Map `EvidenceResult` onto the existing Tier tokens:
**pass → green/healthy** ("clear to send"), **fail → red/attention** ("blocks send"), **unknown/no
signal → amber/watch** ("needs your eyes"); advisory items show their color but are annotated
"advisory — never blocks." Reuse the pill/verdict classes already in render.ts (`.check-item`/
`.auto-badge` :431-434) — **no new color tokens, no fourth scale**, and **not** the blue
`NeedsYouGroup` band. `approveButton` (:128-132), the approve gate (approve.ts:57-58), and the live
re-gate (checklist.ts:42) move in lockstep with the reframed "all green" rule.

## Error handling & fail-safe

- Every audit self-skips (`status:"skip"`, no details) when its input is absent → verdict stays
  `null` → evidence `unknown` → **blocks** (safe: can't confirm health → don't send). This means a
  site must adopt `/health` and the smoke suite before its gate can clear.
- `/health` outage semantics: **absent/unreachable → skip → `unknown` (amber)**; **present but
  non-200/`ok:false` → `fail` (red)**. Both block; the distinction is operator-facing.
- Only a fresh `pass` clears; stale → `unknown`.
- The nightly fleet summary gate (`FLEET_WRITE_SUMMARY wrote=N failed=M total=T`) is unaffected: a
  clean self-skip is not a failure.

## Testing strategy

Coverage is enforced (statements 78 / branches 67 / functions 76 / lines 80) and `include`s every
`src/**/*.ts`, so each new file ships with tests:

- **auto-tick.test.ts** — every new evidence fn: pass / fail / unknown(stale) / n/a / absent; plus
  the gate predicate `isHealthGateClear` and `gatingFields` per report type.
- **checklist.test.ts** — the label-mirror + array-order guardrails stay green (they are the
  client-email tripwire); add gating-partition assertions.
- **audits:** `function-health.test.ts` (+ `-airtable`), `smoke.test.ts` (+ `-airtable`),
  `form-e2e.test.ts` (+ `-airtable`); extend browser + browser-airtable for `reachableOk`/
  `titleMetaOk`; extend write-audits/write-fleet-audits.
- **override:** approve + orchestrate tests for the `"overridden"` branch, empty-reason rejection,
  the fleet event, and the backstop honoring the override.
- **starter:** a unit test for `/health` (Prismic ok/error/skipped, forms booleans, never-POST);
  smoke-suite promotion validated by the suite running.
- All tests write to tmpdir (working-tree-clean tripwire).

## CI constraints

`ci.yml` per push/PR: `pnpm typecheck` (`tsc --noEmit` **and** `-p tsconfig.netlify.json`), `pnpm
lint` (eslint **and** prettier), `pnpm build` (tsup), `pnpm test:coverage` (floors above), `pnpm
test:dist` (`smoke-dist.mjs` — audit import graph must not reach central-only packages; `import type`
for airtable, dynamic `import()` only in CLI write-back), working-tree-clean tripwire. New audits go
in `CHECKOUT_FREE_AUDITS` (function-health) or the clone-based path (smoke, form-e2e).

## Phasing

Each phase ships working, testable software. `dependsOn` drives ordering.

1. **Starter `/health` endpoint** — `{ok, prismic, forms}`, leak-safe, server-side Prismic probe. _(none)_
2. **Function-health audit + CMS fold** — checkout-free `/health` fetch → `pass`/`fail`/skip; "Function health" + checked-at columns, separate from Deploy status. _(1)_
3. **Browser-audit extension** — `reachableOk` + `titleMetaOk` verdicts (tri-state columns) + the Deploy freshness read-back fix. _(none)_
4. **Promote per-site smoke suite into the starter** — test:unit/test:smoke split, shared playwright config, `tests/smoke` + committed route manifest; bump the off-disk `reddoorla/.github` CI. _(none)_
5. **Fleet smoke audit + `smokeOk` persistence** — `src/audits/smoke.ts` runs each site's `test:smoke`; "Smoke OK" + "Last Smoke At" + read-back. _(4)_
6. **Form-L2 synthetic e2e** — starter `testMode` marker + central ingest suppression + Turnstile skip; `form-e2e` audit against prod → "Form E2E OK". _(1)_
7. **Evidence for every gating item** — extend `auto-tick.ts` (deploy+function, cms, uptime, titles, forms, interactions, tested-after-updates) and `draft.ts` to emit + persist a `pass|fail|unknown|n/a` status for **every** item; add the `n/a` state and the semantic inversion. _(2, 3, 5, 6)_
8. **Flip the gate** — `isHealthGateClear`/`gatingFields`/`gatingHealth` in checklist.ts (fail AND unknown block), folded into `approveBlockers`, swapped into approve.ts / orchestrate.ts (by-name message) / render.ts / checklist.ts; manual ticking retired. _(7)_
9. **Cockpit health-status reframe** — `checklistBlock` renders Tier-colored per-check health, advisory items annotated; approveButton/CSS aligned. _(7)_
10. **Logged send-anyway override** — `sendOverride`/`overrideReason`/`overrideBy`/`overrideAt`, reason-required `"overridden"` branch, distinct endpoint, audit stamp + `report_sent_with_override` event, honored in approve **and** the `sendOne` backstop. _(8)_

## Resolved decisions

1. **Gate partition** — Maintenance gates availability only (Deploy+Function, CMS, Domain, Security,
   Uptime); Google Indexed advisory. Testing gates all 13. Launch/Announcement ungated.
2. **Form-L2** — real prod submission + central test-mode suppression + CF public test sitekey; no
   secret on the site.
3. Reuse `approveBlockers` (not a third gate).
4. Manual ticking retired for gating; the logged override is the only human bypass.
5. `/health` returns a structured `{ok, prismic, forms}` (CMS gets its own visibility).
6. `/health` outage: absent → amber/unknown; present-bad → red/fail (both block).
7. Smoke runs as its own `smoke` audit (clean verdict), not coupled to a11y.
8. Per-site route manifest committed with each site (`tests/smoke/routes.ts`).
9. Tri-state single-select storage for all new verdicts.

## Open items (deferred, not blocking)

- **Launch/Announcement gating** — currently ungated (`checklistFor` → `[]`). Whether to gate an
  announcement on site health is deferred (would touch the imminent Monday rollout). Flagged, not
  built.
- **Fate of `setChecklistItem`** — retired from the gating path; whether to repurpose it for advisory
  acknowledgement of amber items is a small follow-up.
- **Off-disk CI ownership** — bumping `reddoorla/.github@45ded88` to run both test lanes is required
  for Phase 4 to actually run on PRs; owned as part of Phase 4 but lives outside these three repos.

## Non-goals

- Continuous/interval uptime monitoring (point-in-time only).
- Retrofitting existing boolean browser verdicts to tri-state.
- Prismic edit/login/publish health (reachability only, server-side).
- A per-site Prismic token or "Prismic Repo" column (folded into `/health`).
- Changing anything the client sees in the email.
