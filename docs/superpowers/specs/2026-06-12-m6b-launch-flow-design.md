# M6b — Launch flow (design)

**Date:** 2026-06-12
**Status:** Design — approved at the architecture level (Tucker, 2026-06-12: purpose-built launch email · full go-live orchestration · approve-gated send). Ready for an implementation plan.
**Milestone:** M6 (second of two slices) of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md) (§M6). Builds on [M6a copy flow](2026-06-12-m6a-copy-flow-design.md) and the M3 approve loop. **Completes the M1–M6 vision.**

> Goal: a first-class launch. `launch <site>` runs **bootstrap → first audit → draft a purpose-built launch email**; that email rides the M3 approve loop, and **on send** the site flips **Status → maintenance** and stamps a **`Launched at`** milestone. The launch email reuses the M6a copy layer.

---

## 1. Decisions locked

| Fork                   | Decision                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Launch email**       | **Purpose-built** (Tucker): a distinct go-live email — header · "LAUNCHED" + launch date · a go-live message · a "what we set up" list · contact · footer. **No** maintenance checklist / Lighthouse / analytics. Reuses the M6a copy layer (contact/footer overrides flow through). |
| **Orchestration**      | **Full** (Tucker): one `launch <site>` command runs the chain — bootstrap (`selfUpdating`) → first audit (`runAudits`) → draft the launch email. Mirrors `init`'s step-chain.                                                                                                        |
| **Send gate**          | **Approve-gated** (Tucker): `launch` only **drafts** the launch report; the existing M3 approve loop sends it. **On send**, flip Status → maintenance + stamp `Launched at`. No new direct-send path.                                                                                |
| **Launched milestone** | A new `Launched at` dateTime on Websites + the **first code that writes `Status`** (→ "maintenance"), both stamped when the launch email sends. Sits alongside the onboarding 4/4 (a 5th lifecycle marker).                                                                          |
| **Launch copy**        | Launch-specific defaults live in `DEFAULT_COPY` (`launchHeading`, `launchBody`, `launchSetupItems`) — **default-only** in v1 (light scope); the shared `contact`/`footer` per-site overrides apply.                                                                                  |

## 2. Architecture

```text
launch <site>   (CLI, step-chain like init — drafts only, never sends)
  1. bootstrap   selfUpdating(site)            (CI + Renovate PR if missing)
  2. first audit runAudits(site) + write-airtable   (lighthouse/a11y baseline)
  3. draft       createDraft(reportType="Launch", + the just-audited lighthouse scores)
        → a Reports row, Draft ready, ¬Approved → appears in the dashboard approve queue

[operator approves on the dashboard — the M3 gate]

send path (orchestrate.sendOne, existing)
  • renderReportHtml dispatches reportType==="Launch" → buildLaunchMjml (purpose-built)
  • on a successful send of a Launch report → updateLaunched(site): Status="maintenance" + Launched at=now
```

The launch draft **carries the first-audit Lighthouse scores** so `sendOne`'s existing `report.lighthouse` guard passes — the launch template ignores them, but the row has them (and they're the site's baseline record).

## 3. Components

### 3.1 `Launch` report type

`ReportType = "Maintenance" | "Testing" | "Launch"` ([src/reports/types.ts](../../../src/reports/types.ts)). Add a **"Launch"** option to the Reports `Report type` single-select (live via MCP). `createDraft`/`findReportByPeriod`/the digest already handle any `ReportType` string.

### 3.2 Launch copy (`DEFAULT_COPY`)

`ResolvedCopy` + `DEFAULT_COPY` gain: `launchHeading: string` ("LAUNCHED"), `launchBody: string` (the go-live message), `launchSetupItems: string[]` (the "what we set up" list, e.g. hosting/DNS/SSL, CI + auto-updates, analytics). Default-only; `resolveCopy` is unchanged (these aren't per-site). The launch template still reads `copy.contact`/`copy.footer*` so M6a overrides apply.

### 3.3 Purpose-built launch template

`src/reports/launch-email/template.ts` (new) — `buildLaunchMjml(data: ReportData): string`. Renders: the same header-image tag + style block as the maintenance template (reuse the helpers — extract the shared `headerImageTag`/`headerStyleBlock`/`escapeXml`/`fmtDate` into a shared module or import them), then `copy.launchHeading` + the launch date (`fmtDate(data.completedOn)`), `copy.launchBody`, the `copy.launchSetupItems` list, the closing contact block (`copy.contact`), and the footer (`copy.footerOrg`/`footerAddress` + auto-year copyright). All copy `escapeXml`'d. No checks/Lighthouse/analytics sections.

`src/reports/render.ts` — `renderReportHtml` dispatches: `data.reportType === "Launch" ? buildLaunchMjml(data) : buildMjml(data)`.

### 3.4 The `launch` command

`src/recipes/launch.ts` (new) — `launch(site, deps)`: a step-chain (mirror `src/recipes/init.ts`):

1. `selfUpdating(site)` — bootstrap.
2. `runAudits(site)` + write the scores to Airtable (reuse the init audit step / the fleet-audit writer).
3. Build a launch `DraftInput` (reportType "Launch", `completedOn` = today, the just-audited Lighthouse scores, the site's header) → `createDraft(base, input)`.

Returns a `LaunchResult` (per-step status, like `InitResult`). Stops on the first failed step. **Does not send.** Registered as `cli.command("launch <site>", …)` in `src/cli/bin.ts` (mirror the `init` registration).

### 3.5 Flip-on-send + the launched milestone

- `src/reports/airtable/websites.ts` — `updateLaunched(base, recordId, at)`: writes `Status = "maintenance"` + `Launched at = at`. `WebsiteRow`/`mapRow` gain `launchedAt: string | null`.
- `src/reports/send/orchestrate.ts` — after a Launch report is **successfully sent + marked sent**, call `updateLaunched(base, site.id, new Date().toISOString())`. Wrapped so a flip failure logs but doesn't fail the (already-sent) report. Maintenance/Testing sends are unaffected.

### 3.6 Airtable changes (live via MCP before merge)

- Reports `Report type` single-select: add the **"Launch"** option.
- Websites: new **`Launched at`** dateTime field.

## 4. Error handling

- **`launch` step-chain:** stops on the first errored/failed step (bootstrap or audit), returns a partial `LaunchResult` — no draft is created if bootstrap/audit failed (don't draft a launch for a broken site).
- **Send path:** the launch draft carries Lighthouse scores → `sendOne`'s guard passes; a site missing a header image throws today's clear error (launch a site only once it's onboarded). The flip-on-send is wrapped (a Status-write hiccup never un-sends the email; next manual fix or re-run reconciles).
- **Idempotency:** drafting is idempotent on `(site, "Launch", period)` via the existing `Period` ledger (a re-run `launch` finds the existing draft).

## 5. Out of scope

- Per-site launch-copy overrides (default-only; promotable via the M6a seam).
- A "launched" badge on the cockpit (the data lands here; surfacing is a later cockpit tweak).
- Re-launch / un-launch flows.

## 6. Slice breakdown (for the plan)

Buildable as one slice; the plan may split at the dashed line if large. Each task TDD + the 3-lens review.

1. **Launch type + launch copy** — `ReportType` += "Launch"; `DEFAULT_COPY` launch fields.
2. **Launch template + dispatch** — `buildLaunchMjml` + `renderReportHtml` branch (+ extract/shared the header/escape helpers). Tested via `renderReportHtml({reportType:"Launch", …})`.
3. **Launched milestone** — `Launched at` field + `WebsiteRow`/`mapRow` + `updateLaunched`; fixture updates.
4. **Flip-on-send** — wire `updateLaunched` into the Launch send path.
   --- (the orchestration could be its own PR) ---
5. **The `launch` command** — the `selfUpdating → audit → draft` step-chain recipe + `bin.ts` registration.
6. **Changeset.**

## 7. Success criteria

`launch <site>` bootstraps CI+Renovate, runs a first audit, and drops a **Launch** report into the dashboard approve queue. Approving it sends a **purpose-built go-live email** (header · LAUNCHED + date · message · what-we-set-up · contact · footer, with M6a per-site contact/footer overrides honored), and on send the site **flips to `maintenance`** with a **`Launched at`** stamp. No client email leaves without the one-click approval. With this, **M1–M6 are complete.**
