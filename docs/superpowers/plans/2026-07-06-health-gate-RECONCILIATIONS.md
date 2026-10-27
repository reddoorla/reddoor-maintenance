# Health Gate — Cross-Plan Reconciliations & Prerequisites

> **Authoritative overlay.** Read before executing any of the four Health Gate plans
> (`2026-07-06-health-gate-plan{1,2,3,4}-*.md`). Where a task's text conflicts with a rule here,
> **this document wins.** These are the seams the plan authors flagged at their boundaries, resolved.

## Execution order

1. **Plan 1 (starter)** — ships `/health` + the smoke suite. Establishes the `/health` `{ok, prismic,
forms}` contract and the `REDDOOR_SMOKE_PORT` contract that Plans 2 and 3 consume.
2. **Plan 2 (health audits)** and **Plan 3 (smoke & form audits)** — may run in parallel after Plan
   1's contracts are fixed. Plan 2 **owns `toVerdict`** (see §3).
3. **Plan 4 (gate/cockpit/override)** — LAST. It will not typecheck until Plans 2 and 3 have added the
   `WebsiteRow` producer fields and their `makeWebsiteRow` test-factory defaults.

Each plan is independently testable at its own boundary (deps are injected in tests), so a plan can be
built and its unit tests pass before the plan it depends on is _deployed_ — the dependency is on the
produced Airtable columns/contracts in production, not on compile-time-before-tests.

## Operator prerequisite (one-time, manual — do before the first nightly write-back)

The audits write to Airtable columns that must **exist first** — a write to a truly-absent column
throws `UNKNOWN_FIELD_NAME` and reds the whole write. Create these on the **Websites** table:

| Column                       | Type                          | Written by |
| ---------------------------- | ----------------------------- | ---------- |
| `Function health`            | single-select (`pass`,`fail`) | Plan 2     |
| `CMS Reachable`              | single-select (`pass`,`fail`) | Plan 2     |
| `Function health checked at` | date/time                     | Plan 2     |
| `Uptime Reachable`           | single-select (`pass`,`fail`) | Plan 2     |
| `Titles & Meta OK`           | single-select (`pass`,`fail`) | Plan 2     |
| `Smoke OK`                   | single-select (`pass`,`fail`) | Plan 3     |
| `Last Smoke At`              | date/time                     | Plan 3     |
| `Form E2E OK`                | single-select (`pass`,`fail`) | Plan 3     |
| `Form E2E checked at`        | date/time                     | Plan 3     |

On the **Reports** table:

| Column            | Type             | Written by |
| ----------------- | ---------------- | ---------- |
| `Send override`   | checkbox         | Plan 4     |
| `Override reason` | long text        | Plan 4     |
| `Override by`     | single-line text | Plan 4     |
| `Override at`     | date/time        | Plan 4     |

`Deploy checked at` already exists (the `netlify-deploy` audit writes it; Plan 2 only starts _reading_
it). The 13 checklist columns and `Checklist auto-evidence` already exist.

## Off-repo prerequisite

The authoritative CI is the pinned reusable workflow `reddoorla/.github@45ded88` (outside all three
repos). Bump it to invoke **both** `pnpm test:unit` and `pnpm test:smoke` so the smoke split actually
runs on each site's PRs. Owned as the Plan 4 / Phase 4 follow-up; until done, `Smoke OK` is only
produced by the nightly fleet `smoke` audit, not on PRs.

## Reconciliations by plan

### Plan 1 (starter)

- **R1.1 — `REDDOOR_SMOKE_PORT`.** The promoted smoke Playwright config (or the `test:smoke` script)
  MUST, when `process.env.REDDOOR_SMOKE_PORT` is set, pass `--port <n> --strictPort` to the dev server
  it boots, binding to exactly that port. Plan 3's `smoke` audit allocates a free port and exports it
  under this exact name; a mismatched or ignored name silently loses zombie-vite immunity.
- **R1.2 — `/` on the bare placeholder.** Accepted as-is: the committed manifest's `/` case 404s on the
  unwired placeholder starter and turns green once Prismic is wired on a real `/new-site` clone.
  Starter acceptance is "the smoke suite runs and discovers its specs," not "green on the placeholder."

### Plan 2 (health audits)

- **R2.1 — `/health` outage color (supersedes the "all non-2xx ⇒ skip" text).** Map the fetch result
  precisely so a _deployed-but-erroring_ function reds while a _not-yet-adopted_ `/health` stays amber:
  - fetch throw / timeout / DNS failure → **skip** (unreachable → Plan 4 "unknown"/amber, blocks).
  - HTTP **404** → **skip** (endpoint not deployed = not adopted yet → amber, blocks).
  - any **other non-2xx** (5xx, 403, …) → **fail** (`functionHealth:"fail"` → red, blocks).
  - HTTP 200 non-JSON → **fail**.
  - HTTP 200 JSON `ok:false` → **fail**.
  - HTTP 200 JSON `ok:true` → **pass**.
    Add two test cases: `404 → skip`, `500 → fail`.
- **R2.2 — `cmsReachable` from the prismic sub-status.** `prismic === "ok"` → `"pass"`; `prismic ===
"error"` → `"fail"`; `prismic === "skipped"` (placeholder repo) → **`null`** (never-ran, NOT
  `"fail"`) so a placeholder never reds CMS. Only `functionHealth` keys off `body.ok`.
- **R2.3 — `toVerdict` ownership.** Plan 2 lands first, so **Plan 2 defines** the single-select reader
  `toVerdict(raw: unknown): "pass" | "fail" | null` in `src/reports/airtable/websites.ts` and uses it
  for the `functionHealth`/`cmsReachable`/`reachableOk`/`titleMetaOk` `mapRow` read-backs. Plan 3
  **imports/reuses** it and MUST NOT redeclare it.

### Plan 3 (smoke & form audits)

- **R3.1 — reuse `toVerdict`.** Do NOT declare `toVerdict` in this plan; import the one Plan 2 adds to
  `websites.ts` (see R2.3). If Plan 3 is somehow built first, move the `toVerdict` definition into
  Plan 2's diff, not both.
- **R3.2 — a missing `test:smoke` script → skip, not fail.** A site whose `package.json` has no
  `test:smoke` script has simply not adopted the suite yet; it must resolve to **`skip`**
  (→ Plan 4 "unknown"/amber, blocks) — NOT `fail` (red). Before spawning, read the site's
  `package.json`; if `scripts["test:smoke"]` is absent, return `{status:"skip", summary:"no test:smoke
script"}` with no details. Keep ENOENT-on-`pnpm` → skip as well. Add a test: site without a
  `test:smoke` script → `skip`. (Only a site that HAS the suite and it exits non-zero is `fail`.)
- **R3.3 — `REDDOOR_SMOKE_PORT`.** Set exactly this env name (see R1.1).
- **R3.4 — form-e2e `n/a` encoding (shared with Plan 4).** For a site with no contact form the audit
  writes a **fresh `Form E2E checked at`** while **clearing `Form E2E OK` (null)**. Plan 4's
  `formsEvidence` reads "`formE2eOk === null` AND `formE2eCheckedAt` fresh" as **`n/a`**; null verdict
  with a null/stale checked-at is "never ran" → `unknown`. Keep these two in lockstep.

### Plan 4 (gate / cockpit / override)

- **R4.1 — build the override UI affordance (not API-only).** The override must have an operator-facing
  control, not just the `?override=1`+reason endpoint param. In the cockpit reframe task (render.ts),
  when `!isHealthGateClear(report)`, render a "Send anyway…" control on the per-site approve card that
  collects a required reason and POSTs it to the approve endpoint with the override param. Disabled/hidden
  when the gate is already clear. Add this as an explicit step; the override is not "done" while API-only.
- **R4.2 — evidence-fn test timing.** The value assertions for the 7 new evidence functions are green
  only once `autoTickChecklist` dispatches them. Run `tests/reports/auto-tick.test.ts` at the **end of
  the dispatch task** (Task 3), not at the end of the fn-authoring task (Task 2).
- **R4.3 — `n/a` encoding.** Adopt R3.4 verbatim for `formsEvidence`. For `updatesEvidence`,
  `defaultBranchCi === "none"` → `n/a` (repo has no CI), distinct from `unknown` (stale signal).

## Not changed (accepted as authored)

- Browser audit's overall `status` rollup stays unchanged; `reachableOk`/`titleMetaOk` are persisted
  verdicts only (scope discipline).
- `testMode` ingest branch suppresses by **skipping persistence entirely** (no row), not a test table —
  tightest suppression, zero schema change.
- `report_sent_with_override` fleet event is emitted at **send** time (orchestrate), matching the
  spec's `orchestrate.ts:15` reference; approve only stamps who/when/reason.
- `setChecklistItem` becomes advisory-only (no longer gates); retiring/repurposing it is a deferred
  Open item.
