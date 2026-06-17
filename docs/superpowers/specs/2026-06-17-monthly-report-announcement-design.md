# Monthly-Report Announcement — Design

**Date:** 2026-06-17
**Status:** design (awaiting review)

## Goal

Send existing `maintenance` clients a one-time, personalized email introducing the
recurring monthly report they'll start receiving — riding the **existing** report
pipeline so it inherits draft → operator-approve → Resend send → delivery tracking.

## Decisions (settled in brainstorming)

- **Angle:** "Your new monthly report." Introduce what we monitor (performance,
  accessibility, security, uptime), the monthly cadence, and that nothing is
  required of them.
- **Delivery:** per-client, through the existing pipeline (Resend + dashboard
  approve loop). Each client's email is reviewed and approved individually before
  it sends.
- **Audience:** every `maintenance`-status site, personalized (client/site name +
  a **live preview of their real latest Lighthouse scores** — "a snapshot of your
  first report").
- **Tone:** pure value — framed as an included part of working with Reddoor, **no
  pricing / no plan pitch**. Include a soft open door: an invitation to reach back
  if they'd like to expand scope or add features to their site.

## Approach: a new `Announcement` report type (reuse, don't rebuild)

The pipeline is Report-row-based: a row with a `Report type`, drafted with
`Draft ready`, reviewed via the `Rendered HTML` attachment, approved on the
dashboard, then sent by `sendOne` which renders by `reportType` and emails the
site's `Report recipients (To)`. The announcement maps directly onto this as a
third report type alongside `Maintenance`/`Testing`/`Launch`.

This means the send path, approve loop, idempotency, delivery-status tracking, and
the M6a copy layer are **all reused unchanged**. The net new surface is: a type, a
template, a fleet-wide draft recipe, and a CLI command.

### Component changes

1. **`src/reports/types.ts`** — add `"Announcement"` to the `ReportType` union.
2. **`src/reports/airtable/reports.ts`**
   - `toReportType` — accept `"Announcement"` (else it coerces to `Maintenance`
     with a warning, exactly the trap the existing comment documents for `Launch`).
   - `DraftInput` + `createDraft` — add an optional `subjectOverride?: string`,
     written to the `Subject override` field when present. Needed because the
     default subject `"<Site> — <Month> <Type> Report"` reads awkwardly for an
     announcement ("… Announcement Report"). Additive; no caller changes.
3. **`src/reports/announcement-email/template.ts`** — new `buildAnnouncementMjml(data: ReportData)`,
   sibling of `buildLaunchMjml`. Reuses the shared header/branding and the M6a copy
   layer (`data.copy`). Sections:
   - Greeting + one-line "we've set up ongoing monitoring & maintenance for
     `{site}`."
   - What we watch: performance, accessibility, security, uptime (short list).
   - **Live preview:** the four Lighthouse scores from `data.lighthouse`, framed as
     "a snapshot of your first report." Each score degrades to `—` if null.
   - Cadence + "nothing needed from you."
   - Soft open door: "if you'd ever like to expand scope or add features to your
     site, just reply." No pricing.
   - Footer via the copy layer.
4. **`src/reports/render.ts:12`** — extend the dispatch to a 3-way:
   `reportType === "Launch" ? buildLaunchMjml(data) : reportType === "Announcement" ? buildAnnouncementMjml(data) : buildMjml(data)`.
5. **`src/recipes/announce.ts`** — new fleet-wide recipe (does NOT mirror
   `launch`'s bootstrap/audit; it is draft-only over stored data):
   - Read all websites; select `status === "maintenance"`.
   - Optional single-site filter: `announce [site]` drafts just that site (for a
     safe test send to yourself first); no arg = all maintenance sites.
   - For each: map the stored Websites scores (`pScore/rScore/bpScore/seoScore`) →
     `LighthouseScores`; **skip + warn** any site whose scores are entirely unset
     (so `sendOne`'s `if (!report.lighthouse)` guard can't strip it later) — surface
     these so the operator can trigger an audit.
   - Idempotent: `findReportByPeriod(base, site.id, "Announcement", period)` reuse
     (period = `YYYY-MM` of today), exactly like `launch`. Re-runs don't double-draft.
   - `createDraft` with `reportType: "Announcement"`, a sensible `subjectOverride`,
     `periodStart/End/completedOn = today`, `lastTestedDate = null`, the stored
     scores. Then render → upload `Rendered HTML` preview → `setDraftReady(true)`
     (mirrors `launch` steps 3 + the render/upload/ready block).
   - Returns a per-site result list (drafted / reused / skipped-no-scores / error),
     never throwing the whole run on one bad site (mirror the resilient fleet-loop
     pattern).
6. **CLI command `announce`** — mirror the `launch` command wiring so it's runnable
   (`reddoor announce` / `reddoor announce <site>`), printing the per-site result list.

### What is explicitly NOT touched

- **`src/reports/send/orchestrate.ts`** — `sendOne` renders by `report.reportType`
  (auto-picks the new template) and its post-send Status-flip hook is gated
  `if (report.reportType === "Launch")`, so an Announcement sends with **no status
  change** and no other special-casing. No edit needed beyond confirming this.
- The M3 approve loop, idempotency ledger, Resend client, webhook/delivery tracking.

## Data model / Airtable

- **`Report type` single-select** needs an **`Announcement`** option added (Airtable
  API can't add select options → 1-click UI step, same limitation as the
  `launch`→`Launch` rename). Until added, `createDraft` 422s — the recipe should
  fail clearly, not silently.
- No new fields. (`Subject override` already exists.) An Announcement row leaves
  `Status` untouched.

## Edge cases

- **Null scores:** template renders `—`; recipe skips+warns a site with *no* stored
  scores at all (keeps the `sendOne` lighthouse guard satisfied).
- **Missing `Report recipients (To)`:** the recipe still drafts (operator reviews
  anyway), but the run output flags every maintenance site whose recipient is blank
  so they can be filled before approving. Send to a blank recipient is the existing
  pipeline's concern, unchanged.
- **Re-run safety:** dedupe by (site, "Announcement", period) — reuse, don't stack.
- **One-off, not scheduled:** unlike Maintenance/Testing, there's no recurrence; the
  daily draft cron is untouched. It's a manual `announce` run.

## Operational prerequisites

1. Add the `Announcement` option to the Airtable `Report type` field (1 click).
2. Ships in the package + dashboard → needs the next release (Version Packages PR)
   to run for real and to render dashboard-side.
3. Fill `Report recipients (To)` on each maintenance client (the run surfaces blanks).
4. Suggested first run: `announce <one-site>` to a test recipient, eyeball the
   rendered HTML, then run fleet-wide.

## Testing strategy

- `template.ts`: renders the score preview (incl. `—` for null), the soft-CTA copy,
  the no-pricing invariant; reuses the copy layer (override vs default).
- `render.ts`: dispatch picks `buildAnnouncementMjml` for `"Announcement"` and still
  picks Launch/Maintenance correctly.
- `reports.ts`: `toReportType("Announcement")` round-trips; `createDraft` writes
  `Subject override` when supplied and omits it otherwise.
- `announce` recipe (fake base): selects only maintenance sites; single-site filter;
  dedupe reuse; skip+warn on no-scores; recipient-blank surfaced; one bad site
  doesn't abort the run.

## Out of scope

- Pricing/plan/upsell content; any scheduled/recurring announcement; new dashboard
  UI (it uses the existing approve queue); changes to how non-Announcement reports
  render or send.
