# Airtable → Turso migration: implementation plan

Design: [`specs/2026-08-17-airtable-to-turso-migration-design.md`](../specs/2026-08-17-airtable-to-turso-migration-design.md)
Tracking issue: **#539**
Written: 2026-08-17 · **Status refreshed: 2026-08-26**

**Status: phases 0–4 complete, phase 5 (freeze) in progress. The flip is the week
of Monday 2026-08-31.**

Read the design first. It records the four decisions and the verified baseline;
this file is only the ordering and the checks.

> **Why this file was rewritten.** It sat only on the unmerged branch
> `docs/airtable-to-turso-spec` for nine days while phases 4 and 5 landed, so
> anyone reading `main` had no design doc for the largest project in flight, days
> before an irreversible step. Its Phase 5 section also still said "parity runs
> for one week", which the 2026-08-25 decisions (#612) reversed. Both are fixed
> below. The branch itself must **not** be merged: it is nine days behind `main`
> and would delete ~5,200 lines of docs that have since landed.

## Before you start

The Airtable quota was raised on 2026-08-17, so nothing here is urgent and the
API is available throughout. That removes the original forcing function — do not
let the freeze get rushed on the theory that something is on fire.

## Phase 0 — persist before enrich ✅ COMPLETE

Shipped via the **dead-letter path**, which is the second option this plan
offered rather than the reorder. `ingestSubmission` catches a failing
`getWebsiteBySlug`, writes the payload to `deadletter`, and returns an honest
"accepted"; `db replay-deadletters` re-runs it through the same function once the
store recovers. `src/db/deadletter.ts`.

## Phase 1 — foundation ✅ COMPLETE

- **1.1 Writer map** — `specs/2026-08-23-websites-writer-map.md`.
- **1.2 Schema + migrations** — `sites`, `site_health`, `site_schedule`,
  `reports`, forward-only in `src/db/migrations.ts`. PKs are the Airtable `rec…`
  ids (design D1).
- **1.3 Importer** — `db import-airtable`, idempotent. Later hardened: it was
  UPSERT-ONLY, so one Airtable deletion wedged the sync red for 15 runs (#584 adds
  a reap plus a refusal guard).
- **1.4 Parity harness** — `db parity`, field-by-field, `FLEET_PARITY` on every
  run including zero.
- **1.5 Nightly backup with a rehearsed restore** — `fleet-db-backup.yml`.

**Gate — passed.** Parity was shown green on the pre-cutover state before any
mismatch it reported was treated as evidence.

## Phase 2 — readers ✅ COMPLETE

Cockpit → `site_health`; site detail → `sites`; form ingest → `sites`. The
site-detail editor extension shipped early in the phase as planned, and reached
full field coverage in #590 / #591 / #593.

## Phase 3 — writers ✅ COMPLETE

`write-audits-to-airtable`, the report scheduler and `github-signals` all repointed
and batched. `writeNextDueDates` is scoped to maintained sites.

⚠️ One writer's dual-write **never ran** for a period: the workflow step had no
`TURSO_*` env, and the only tell was a _missing_ `mirrored=` suffix in the log
(#585). An absent success marker is not a passing check.

## Phase 4 — console ✅ COMPLETE

Fleet table, site create/archive, report review with commentary, rendered-HTML
preview, full editor field coverage. The **site-status vocabulary** landed here
across stages 1–3 (#571 / #576 / #589): aliases are gone, `canonicalizeStatus` is
the identity, and `status` ≡ `statusRaw`. Live values are
`building | launching | maintained | hosted-only | external | archived`.

⚠️ Two defects shipped in this phase and **both were caught by running the thing,
not by reading it**: #595 (the checkbox and multi-select could not save — the
dashboard's inline script is a template string no test had executed) and #603
(commentary offered on templates that ignore it, found by a production render
probe).

## Phase 5 — freeze 🔶 IN PROGRESS

**This section was rewritten 2026-08-26.** The original text — _"Airtable goes
read-only. Parity runs for one week."_ — contradicts the decisions taken on
2026-08-25 and recorded in **#612**:

- **No more Airtable hand-editing.** The console replaces it.
- **Both the hourly import and recurring parity STOP at the flip.** Parity runs
  **once**, as the go/no-go, not continuously afterwards.
- **Dual-write continues for one week**, then Phase 6 deletes it. The week is the
  rollback window; it is not a period of continued reconciliation.
- **Flip: week of Monday 2026-08-31.**

**The flip is not a config change.** Every mirror's error semantics are backwards
for a frozen world, because today a Turso failure is swallowed on the theory that
the import converges it. With no import, that same swallow is permanent
divergence. Three outcomes change meaning:

| log               | today                        | after the flip              |
| ----------------- | ---------------------------- | --------------------------- |
| `mirrored=0`      | the sync will fix it         | that write is gone          |
| `mirrored=missed` | the site is not imported yet | impossible, therefore a bug |
| `mirrored=absent` | no creds, Airtable has it    | every write was discarded   |

Done so far: `makeReportMirror` (#606), `makeSiteMirror` (#607), the `ensureSite`
create-mirror (#608), the digest-state migration (#610 — a _migration_, not a
mirror, so parity does not cover it; the fleet homepage now touches Airtable zero
times), and `mirrorWrite` bringing the four Netlify request handlers under the
switch with a lockstep gate to keep them there.

⚠️ **Rollback is unrehearsed.** No Turso restore has ever been performed into a
real target. `db restore --url --file` exists for it; run it once before the flip.

## Phase 6 — retire ⬜ NOT STARTED

One week after the flip. Delete `src/reports/airtable/**` and its callers. Keep
the frozen base as an archive; there is no reason to delete it.

## Free-tier guard-rails

- ✅ **Build fails on an unindexed query.** `tests/db/query-plans.test.ts`.
  ⚠️ It was green while three request-path raw scans shipped, because it tested
  function _names_ rather than predicate _shapes_; it is now driven by a filter
  matrix, and an index-ordered `SCAN` with no `LIMIT` counts as a full read
  (Turso meters rows, not pages).
- 🔶 **No `COUNT(*)` on request paths.** Three remain, now visible and justified in
  the gate's allowlist rather than invisible. The fix is to fold them into the
  nightly `digest_state` singleton, at the cost of figures up to 24h stale —
  **an operator decision, still open.**
- ✅ **Index `submissions.resend_message_id`** — migration `0008`.
- ❌ **Nightly Turso usage check, alarming at 50% of any metric — NEVER BUILT.**
  Nothing in this repo has ever spoken to the Turso Platform API. It has therefore
  never run, never been green, and by this repo's first rule is not evidence of
  anything. **Blocked on the operator: it needs a Turso _platform_ token; the
  database-level `TURSO_AUTH_TOKEN` cannot read usage.**

## Open threads carried in

- ✅ `fix/skip-spam-for-in-development` — **merged 2026-08-23 as #551**, gating on
  `building`. (A 2026-08-26 review briefly reported this as an unpushed, inert
  branch; that was a stale local worktree, not the repository.)
- ⬜ `fix/form-e2e-budget-attribution` — still a `wip(` commit with no tests.
  Splits the form-e2e probe's timing so `BUDGET_THIN` compares the POST span
  against `INGEST_TIMEOUT_MS` rather than click→banner. Unrelated to the
  migration; finish or discard it independently.
- ⬜ `beachfront-dentistry`'s `AppointmentModal.svelte` renders `message` as a
  single-line input — missing `type="textarea"`. Different repo, one-line fix.
- ⬜ `data-dynamiq` and `la-homelessness-initiative` have never recorded a
  submission and are not covered by the form-e2e probe. Unverified, not known
  broken.
