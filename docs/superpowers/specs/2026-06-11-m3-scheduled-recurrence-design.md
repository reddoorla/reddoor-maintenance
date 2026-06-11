# M3 — Scheduled recurrence + the approval-only loop (design)

**Date:** 2026-06-11
**Status:** Design — approved at the architecture level (Tucker, 2026-06-11). Ready for an implementation plan.
**Milestone:** M3 of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md). "The point where the daily value lands."

> Goal (roadmap §6): make **"the only thing I do is look and hit yes"** literally true.
> Keep Airtable's `Approved to send` as the safety interlock.

---

## 1. The reframe: M3 is connective tissue, not new pipeline

A code read (2026-06-11) confirmed the **entire draft→approve→send pipeline already exists** and is reused as-is:

- **Draft** — `reddoor-maint report --due` → `runDueDraft()` → `draftReportForSite()` ([src/reports/draft.ts](../../../src/reports/draft.ts)) → `createDraft()` writes an Airtable `Reports` row (HTML attachment, `Draft ready = TRUE`, `Approved to send = FALSE`, `Sent at = null`). GA/Search enrich with soft-fail.
- **Due calc** — `findDueReports()` ([src/reports/due.ts](../../../src/reports/due.ts)) returns the `(site, reportType)` pairs due as of a date, from per-site `maintenenceFreq`/`testingFreq` + last-sent.
- **Send** — `reddoor-maint report --send-ready` → `sendApprovedReports()` ([src/reports/send/orchestrate.ts](../../../src/reports/send/orchestrate.ts)). Gate (`listSendableReports`): `Draft ready ∧ Approved to send ∧ Sent at BLANK`. Sends via Resend with `idempotencyKey: report:${report.id}`, stamps `Sent at` + `Resend message ID`.
- **Dashboard** — Netlify functions render read-only HTML over live Airtable: `netlify/functions/fleet-homepage.mts` (`GET /`), `site-dashboard.mts` (`GET /s/:slug`), `resend-webhook.mts` (`POST`, the write-function precedent). Auth = HTTP Basic against `DASHBOARD_PASSWORD` (`src/dashboard/basic-auth.ts`).
- **Cron precedent** — `.github/workflows/fleet-lighthouse.yml`: nightly GHA cron, `AIRTABLE_PAT`/`AIRTABLE_BASE_ID` secrets, `concurrency` guard, opens/updates a tracking issue on failure (the #152 mechanism).

So M3 adds only: **a scheduler**, **idempotent drafting**, **a dashboard write-action**, and **a unified digest** — wiring around pieces that work.

## 2. Decisions locked in this brainstorm (2026-06-11)

| Fork             | Decision                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approve UX**   | **Decoupled flag-flip.** The dashboard "Approve" button does one tiny Airtable write (`Approved to send = TRUE` + audit stamp). It never sends directly.                                        |
| **Send cadence** | **One daily run.** A single daily workflow drafts due reports, sends approved-but-unsent, and emails the digest. ~24h max approve→send latency is fine for monthly/quarterly reports.           |
| **Digest**       | **One unified daily operator digest.** M3 builds the frame + the "Ready for your yes" section; M5 later plugs "Needs attention" (vulns, failing Renovate PRs, regressions) into the same email. |

Settled by the research pass (vendor-verified — see §7):

- **Scheduler substrate = GHA cron + keepalive**, minute offset off the top of the hour.
- **Idempotency = Airtable run-ledger (search-before-create on site+period) + single-flight `concurrency` + Resend idempotency key.**

## 3. Architecture

```text
┌─ Daily GHA workflow  (cron "23 9 * * *", keepalive'd, concurrency single-flight) ─┐
│  1. DRAFT    reddoor-maint report --due       (idempotent: skip site+period       │
│                                                 already drafted)                   │
│  2. SEND     reddoor-maint report --send-ready (existing gate; at-least-once)      │
│  3. DIGEST   reddoor-maint report --digest     (one "your fleet today" email)      │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ `Approved to send` set out-of-band, between runs, by:
┌─ Netlify POST function   POST /api/reports/:id/approve  (behind basic-auth) ──────┐
│  dashboard "Approve" button → Airtable: Approved to send = TRUE, Approved At = now │
│  (the audited approval event; idempotent — approving an approved row is a no-op)   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

The approval flag is the only shared state between the two halves. The cron is the executor; the dashboard is the control. Neither sends on the request path.

## 4. Components

### 4.1 Idempotent drafting (the run-ledger)

**New Reports field `Period` (text, `YYYY-MM`).** The `YYYY-MM` of the `dueDate` returned by `findDueReports` for that `(site, reportType)` — unique per recurrence instance (monthly → each month; quarterly/yearly → each cycle's due month), so it's a stable dedup key for exactly one draft per cycle.

`runDueDraft()` gains a guard: before `createDraft()`, **search** Reports for `Site == site ∧ Report type == type ∧ Period == key`. If a row exists → **skip** (already drafted this period); else create with `Period` set. This makes a cron re-fire a no-op. Airtable has **no atomic upsert**, so the search-then-create is a read-then-write race — closed by single-flighting the workflow (`concurrency: { group: m3-daily, cancel-in-progress: false }`); a once-daily job can't realistically overlap, and the Resend key is the send-side backstop regardless.

### 4.2 The daily workflow

`.github/workflows/daily-reports.yml`, cloned from `fleet-lighthouse.yml`:

- `on: schedule: cron "23 9 * * *"` (non-`:00` minute, dodges the documented top-of-hour load spike) + `workflow_dispatch` (manual re-run).
- `concurrency: { group: m3-daily, cancel-in-progress: false }`.
- Steps run the CLI: `report --due` → `report --send-ready` → `report --digest`. Each step emits a summary line for log-gating.
- **Keepalive** (`gautamkrishnar/keepalive-workflow@v2`, API mode — no dummy commits) to neutralize GHA's 60-day public-repo auto-disable, the one _silent_ failure mode for a repo that can go quiet.
- Secrets: existing `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`.
- On failure: open/update a `daily-reports-failing` tracking issue + auto-close on recovery (reuse the #152 pattern).

### 4.3 Dashboard approve action

**New Netlify function `netlify/functions/approve-report.mts`** (`POST /api/reports/:id/approve`), modeled on `resend-webhook.mts`:

- Basic-auth gate (`verifyBasicAuth` against `DASHBOARD_PASSWORD`) — same realm as the dashboard, so the browser reuses creds.
- Updates the Reports row: `Approved to send = TRUE`, `Approved At = now`, `Approved By = "dashboard"` (single-operator marker for the audit trail).
- **Idempotent:** approving an already-approved or already-sent row is a no-op (returns OK without re-writing); never un-approves.
- The handler is a **pure function** with an injected Airtable client (unit-testable; the `.mts` is a thin adapter), matching the existing `src/dashboard/` split.

**Dashboard UI:** `renderSiteDashboardHtml` ([src/dashboard/](../../../src/dashboard/)) gains, on each `Draft ready ∧ ¬Approved ∧ ¬Sent` report, an **"Approve" button** that POSTs to the function (a tiny inline `fetch`, then reflects the new state). A minimal **"Pending your yes"** list at the top of `/s/<slug>` (and a fleet-wide count on `/`). The rich cockpit (triage/filter/sort/pagination) is **M4, not here.**

### 4.4 The unified daily digest

**New subcommand `reddoor-maint report --digest`** + a pure `renderDigestHtml(sections)` (mirrors the report-HTML split: pure render, thin IO wrapper).

Sections:

- **"Ready for your yes"** (built now): every `Draft ready ∧ ¬Approved ∧ ¬Sent` report — site name, report type, period, and a link to `/s/<slug>` (the digest _links to_ the dashboard; it never carries the approve action — email scanners pre-fetch links and would trip accidental approvals).
- **"Needs attention"** (frame now, filled by M5): an extensible section. M5 plugs in `collectRenovateFailures` (already shipped, #156), new-vuln detection, lighthouse regressions, delivery bounces. For M3 it renders whatever is cheaply available (e.g. open `*-failing` tracking issues) or an "all clear" line.

Delivery: Resend to the operator address (`OPERATOR_EMAIL` env, fallback to a constant), `idempotencyKey: digest-${YYYY-MM-DD}` so a cron re-fire can't double-send. **No-noise default:** skip the email when both sections are empty (flippable to always-send later).

## 5. Airtable schema changes

Additive only — two new Reports fields; everything else is reused:

| Field         | Type                         | Purpose                                                       |
| ------------- | ---------------------------- | ------------------------------------------------------------- |
| `Period`      | Single line text (`YYYY-MM`) | Idempotency key for search-before-create drafting             |
| `Approved At` | Date/time                    | Audit: when approval happened (set by the dashboard function) |

`Approved By` (single line text) is **optional** — single operator, but cheap to record `"dashboard"` for a complete audit row. Existing fields reused unchanged: `Draft ready`, `Approved to send`, `Sent at`, `Resend message ID`, `Delivery status`.

## 6. Error handling

- **Drafting:** GA/Search already soft-fail; a missing Lighthouse score blocks _that one_ draft (existing behavior), not the batch. The step prints a `wrote=N skipped=M failed=K` summary.
- **Sending:** per-report try/catch; a failed send leaves `Sent at` null → **retried next daily run** (at-least-once). The Resend idempotency key + the durable `Sent at` record prevent a double-send.
- **Workflow:** any step failing opens/updates the `daily-reports-failing` issue (and the run is visible in the digest's "Needs attention" once M5 wires it). Steps are ordered so a draft failure doesn't block sending already-approved reports — consider `continue-on-error` boundaries per step, decided in the plan.

## 7. Research basis (vendor-verified, 2026-06-11)

- **GHA cron** is documented to be **delayed and can be _dropped_** under top-of-hour load, and **auto-disables after 60 days of no default-branch activity** on public repos → minute-offset + keepalive. ([GitHub schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [disabling workflows](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow))
- **Netlify Scheduled Functions** rejected as the cron: hard **30s cap**, **no URL invocation**, **no payload** — can't fan out over 200 sites. ([Netlify docs](https://docs.netlify.com/build/functions/scheduled-functions/))
- **Resend idempotency**: `Idempotency-Key` dedupes within **24h**, entity-ID key format recommended — the _concurrency/retry_ guard; Airtable `Sent at` is the _durable_ record. ([Resend docs](https://resend.com/docs/dashboard/emails/idempotency-keys))
- **Airtable** has **no unique constraint / atomic upsert** → single-flight the cron; lean on Resend's key for send-side dedupe.
- **Approve-as-audited-event** mirrors GitHub deployment-protection rules: the approval write _is_ the audit record; the side effect keys off it. ([GitHub deployments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments))

## 8. Out of scope (explicit)

- **M4 cockpit** — triage, filtering, sorting, pagination. M3 adds only the approve button + a minimal pending list.
- **M5 alert detectors** beyond the digest frame — M3 ships the "Needs attention" _section shell_; M5 fills it.
- **Inline send-on-click** — rejected (decoupled chosen).
- **Email-link approve** — rejected (scanner pre-fetch trips accidental approvals).

## 9. Suggested PR slices (for the plan)

Independently shippable, dependency-ordered; each lands with TDD + the contract's 3-lens review:

1. **Idempotent drafting** — `Period` field + period-key derivation + search-before-create guard in `runDueDraft`. Internal, fully unit-tested. (Prereq for the cron.)
2. **Daily workflow** — `daily-reports.yml` (draft + send-ready), keepalive, concurrency, failure-issue. Infra; YAML-validated.
3. **Dashboard approve action** — `approve-report.mts` (pure handler + thin adapter) + the approve button + pending list + `Approved At` field.
4. **Unified digest** — `report --digest` + `renderDigestHtml` + the "Ready for your yes" section + the M5-extensible "Needs attention" frame; wire as step 3 of the workflow.

## 10. Success criteria

A real day where: the cron drafts everyone due (no duplicates on re-run), the dashboard shows "N ready for your yes," one click approves (audited), the next daily run sends approved reports (no double-sends), and one digest email summarizes it — Tucker's only action being the click. This is the M3 bar; 1.0's "consistently using the tool" builds on top of it.
