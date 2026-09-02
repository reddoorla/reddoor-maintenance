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

## Phase 5 — freeze ✅ COMPLETE — flipped 2026-08-31 (#643)

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

**Flipped 2026-08-31, 17:45 PT — #643, main `dadb073`.** `TURSO_IS_AUTHORITATIVE`
is `true` and `fleet-db-sync` is deleted in the same commit. Go/no-go recorded on
issue #612 immediately before: `FLEET_PARITY sites=44 health=44 schedule=44
reports=17 mismatches=0`. A four-track pre-merge review (lead-path trace, sweep,
week-of-evidence, design-vs-diff) found three regressions the one-line flip would
have exposed, fixed in the same PR: the send batch never mirrored
`Sent at`/`Resend message ID` (its exclusion cited "the hourly sync converges
those"), and `fleet-prismic-drift` + `fleet-security`'s renovate-dispatch step
had no Turso credentials for mirrors that now refuse to build without them. A
second, narrower round on the fix commit found nothing.

Two things about the rollback week that are deliberate, not gaps: Airtable shadow
writes are **still fatal** to their callers (a shadow you might roll back to is one
you keep trustworthy — an Airtable quota outage still reds writes until Phase 6),
and `db import-airtable` / `db sync` refuse under the freeze unless `--force`,
because a habitual import would overwrite authoritative rows from the frozen
archive. `db parity` stays free — "did the shadow drift?" is the rollback-week
question. The window closes ~2026-09-07.

✅ **Rollback is rehearsed — three times.** #630 restored into a local `turso dev`
target; #636 restored into a real hosted database and thereby exposed that
`db restore` sent no auth token (a defect neither `:memory:` nor `turso dev` could
show — fixed in the same PR); and on 2026-08-31, hours before the flip, the
_actual nightly artifact_ was downloaded, decrypted locally with
`BACKUP_PASSPHRASE`, and restored into a fresh hosted database:
`RESTORE loaded=true tables=11 rows=803 blob_bytes=7777769 mismatches=0`,
independently confirmed by a `turso db shell` count check. A full fleet restore
takes seconds.

## Phase 6 — retire ⏳ SCHEDULED — not before 2026-09-07

Delete `src/reports/airtable/**` and its callers; keep the frozen base as an
archive. **The order is load-bearing — see #646 for the dependency-ordered
checklist.** In short: relocate the pure helpers `fleet-state.ts` value-imports
from the Airtable layer (they run on every lead read), port `resend-webhook`'s
report lookup to Turso, replace `ensure-site` (the only sites-INSERT path is
driven by the Airtable create), move batch enumeration off `listWebsites(base)`
(including the nightly form-e2e), ~~remove `form-ingest`'s Airtable env gate
_before_ pulling the env vars~~ (**done 2026-09-02**: the gate is gone from
`form-ingest` and from the vestigial copy in `submissions-page`, and a
handler-level test reds if either comes back —
`tests/forms/form-ingest-handler.test.ts` for the lead path,
`tests/dashboard/submissions-bulk-read.test.ts` for the page. The ordering
constraint is now enforced by the suite rather than by this checklist)
— and only then delete. #645 (post-flip lead-path
hardening) should land first.

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
- ✅ **Nightly Turso plan-quota check — built in #634 (2026-08-26).** `db usage`
  reads the Platform API with the account-level `TURSO_FLEET_USAGE` token (the
  database-level `TURSO_AUTH_TOKEN` cannot read quota) and runs as
  `fleet-db-backup`'s separate `quota` job, gated on
  `FLEET_DB_USAGE … verdict=ok`. ⚠️ It has timed out once (2026-08-29, the job's
  5-minute limit) — a probe failure reds the job rather than reading as headroom,
  which is the right direction, but the probe wants hardening now that Turso is
  the only store and `overages: false` makes a quota crossing a total outage.

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
