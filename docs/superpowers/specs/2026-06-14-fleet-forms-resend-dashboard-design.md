# Fleet Forms → Resend + Dashboard — Design Spec

- **Date:** 2026-06-14
- **Status:** Approved (design); ready for implementation planning
- **Owner:** Tucker
- **Related:** [[fleet-scale-vision-2026-06]], [[m4-cockpit-complete]], [[m6-complete-1.0-vision-shipped]], [[shared-package-fix-once-2026-06-04]]

## Problem

The fleet's form layer is fragmented and partly broken:

- **4 sites depend on Netlify Forms** (gallerysonder, alamo-anatomy, data-dynamiq, and reddoor-website's markup) via `data-netlify="true"` + a honeypot. Submissions land in Netlify's per-site UI — invisible to any central operator view, and tied to the Netlify host.
- **reddoor-website silently drops submissions** — its contact form does a client `fetch` POST to `/contact`, but there is no `+page.server.ts` action to receive it. Submissions are lost.
- **No standardization** — no SvelteKit form actions or `use:enhance` anywhere; field naming is inconsistent (`name` vs `first_name`/`last_name`); honeypot is the only spam protection; every site hand-rolls its form. Nothing is shared.

Meanwhile the dashboard (`reddoor-maintenance`) already has the plumbing this needs: Resend is deeply integrated (`src/reports/send/resend.ts`, sending from `reports@reddoorla.com`, with a delivery-status webhook), plus established Netlify `.mts` handler, Airtable, cockpit-render, Basic-Auth, CSRF, and rate-limit patterns.

## Goal

Replace the fragmented form layer with **one pipeline**: every fleet form submits the same way, the submission is emailed via Resend (to the site's point-of-contact, with an autoresponder to the submitter), and every submission is captured in Airtable and surfaced in the operator dashboard.

## Non-goals (YAGNI)

- Per-site verified Resend sending domains (single verified `reddoorla.com` sender for v1).
- Per-site ingest tokens (single shared token for v1).
- CAPTCHA / hCaptcha / reCAPTCHA (honeypot + timing + server-to-server ingest is sufficient for v1).
- A dedicated database (Airtable is the store).
- A bespoke submissions UI beyond the existing cockpit/site-dashboard HTML rendering.
- File/attachment uploads through forms.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | **Hybrid** — same-origin site form action forwards server-to-server to a central dashboard ingest endpoint | No CORS; works without JS; secrets stay in the dashboard; sites stay thin |
| Notifications | **POC notify + autoresponder to submitter**; operator watches the dashboard (no per-submission email) | Scales to ~200 sites without inbox flood; client gets the lead directly |
| Storage | **Airtable `Submissions` table** in the existing base | Consistent, already wired into the dashboard, mobile-reviewable, zero new infra |
| Ingest auth | **Single shared `FORMS_INGEST_TOKEN`** | Server-side only, never exposed; per-site tokens are a future hardening |
| Sender | **Single `forms@reddoorla.com`** on the already-verified domain | Per-site domains add verification overhead; defer |
| Airtable `Site` field | **Linked record → Websites** | Joins to POC/copy fields; consistent with Reports |

## Architecture

```
[site <form>]  --same-origin POST-->  [site +page.server.ts action]
   honeypot (visible)                    1. honeypot check (drop bots silently, return success)
                                         2. timing check (reject implausibly fast fills)
                                         3. normalize fields
                                         4. server-side fetch with FORMS_INGEST_TOKEN
                                              |
                                              v
                              [dashboard  POST /api/forms/:slug]   (new Netlify .mts handler)
                                 - verify shared token (constant-time)
                                 - per-slug rate limit
                                 - write Airtable Submissions row
                                 - fire Resend: POC notify + submitter autoresponder
                                 - stamp Notify status + Resend message id
                                 - return 200 { ok: true }
```

The public-facing surface is each **site's own form action** (same-origin). The dashboard ingest endpoint is reachable only by callers holding the shared token (the site servers), so it is not a public spam target. Spam mitigation for the visible form is the honeypot + a minimum fill-time check at the site action.

**Failure isolation:** the Airtable write happens before the Resend send. If Resend fails, the submission is still captured and `Notify status` is stamped `failed` — a notification outage never loses a lead. If the dashboard ingest is unreachable, the site action returns a user-facing error (and may log), but does not crash the page.

## Data model — Airtable `Submissions` table

New table in the existing base (same base as Websites/Reports).

| Field | Type | Notes |
|---|---|---|
| `Submission ID` | autonumber | primary field |
| `Site` | link → Websites | which site the form is on |
| `Form type` | single-select | `contact` / `inquiry` / `newsletter` / `rsvp` / `reserve` (extensible) |
| `Name` | single line text | normalized from `name` or `first_name` + `last_name` |
| `Email` | email | submitter email (used as Reply-To on the POC notification) |
| `Phone` | single line text | optional |
| `Message` | long text | optional |
| `Extra fields` | long text (JSON) | any per-form fields not mapped above (company, product, event, guests, dates, …) so no data is lost despite inconsistent fleet field names |
| `Source URL` | url | the page the form was on |
| `UTM` | single line text | UTM params if present (gallerysonder already captures these) |
| `Submitted at` | dateTime | server-stamped at ingest |
| `Status` | single-select | `new` / `read` / `archived` / `spam` (default `new`) |
| `Notify status` | single-select | `sent` / `failed` / `skipped` |
| `Resend message id` | single line text | id of the POC notification email |

The `Extra fields` JSON blob is the central YAGNI move: it absorbs each site's idiosyncratic fields without a schema change per site. The normalizer maps known synonyms into the typed columns and dumps the rest into `Extra fields`.

## Security model

- **Ingest auth:** `FORMS_INGEST_TOKEN` compared constant-time (reuse the `timingSafeEqual` approach from `src/dashboard/basic-auth.ts`).
- **Rate limiting:** the ingest endpoint limits **per site slug** (the per-IP limit used by other handlers is wrong here — the caller is the site's Netlify egress IP). The visible-form throttle is honeypot + minimum fill-time at the site action.
- **Honeypot:** keep the existing `bot-field` convention; a filled honeypot returns a success response without writing/sending (bots get no signal).
- **Timing check:** a hidden timestamp planted on render; submissions faster than a small threshold are dropped as bots.
- **Status endpoint** (`/api/submissions/:id/status`): operator-only — Basic-Auth (`DASHBOARD_PASSWORD`) + CSRF (Sec-Fetch-Site / Origin-Referer), mirroring `approve-report.mts`.
- **Secrets placement:** `RESEND_API_KEY`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID` live only in the dashboard. Each site holds only `FORMS_INGEST_TOKEN` and the ingest URL.

## Email behavior (Resend)

Reusing the verified `reddoorla.com` domain and the existing `src/reports/send/resend.ts` client.

- **POC notification:**
  - `From: "<Site Name> Forms" <forms@reddoorla.com>`
  - `Reply-To: <submitter email>` — so the client replies straight to the lead
  - `To:` the Websites `point of contact` (fallback: `Report recipients (To)`)
  - Body: the normalized fields + message + source URL.
- **Autoresponder to submitter:**
  - `From: "<Site Name>" <forms@reddoorla.com>`
  - `Reply-To: <POC>`
  - Subject: "We got your message."
  - Body may reuse the per-site `Copy Intro` / `Copy Contact` / `Copy Footer` Websites fields.
- **Operator:** no per-submission email. Operator reviews via the dashboard.
- Notification result is stamped to `Notify status` (`sent` / `failed`) with the `Resend message id`.

## Dashboard surface

- **Cockpit** (`src/dashboard/fleet-cockpit.ts` + `src/dashboard/fleet-render.ts`): a pinned "📥 N new submissions" queue mirroring the existing pending-approvals queue, plus a per-site `new` count on each site card. Reads Airtable only (no request-path GitHub), consistent with the existing cockpit.
- **Per-site dashboard** (`src/dashboard/render.ts`): a Submissions list for that site (newest first, full message, status).
- **Status actions:** `POST /api/submissions/:id/status` to move `new → read → archived` or mark `spam`. Operator-only, idempotent decision logic extracted to a pure function (like `approveReport`).

## Code organization & fleet propagation

Following the fix-once philosophy ([[shared-package-fix-once-2026-06-04]]): shared package = plumbing, design stays per-site.

- **`@reddoorla/maintenance` (plumbing, propagates via Renovate):** a server-only subpath `@reddoorla/maintenance/forms` exporting:
  - the ingest client (server-to-server POST with token),
  - the field normalizer (`name` / `first_name`+`last_name` → typed columns + `Extra fields` JSON),
  - the honeypot + timing validator,
  - shared TypeScript types for the submission payload.
  - Fleet-wide fixes ship as a version bump. (Note: this introduces a runtime import of the shared package by site server code — verify the package's exports/build support an ESM server subpath during planning.)
- **reddoor-starter (design skeleton):** the standard accessible `<form>` markup built on the existing `src/lib/components/Form.svelte` error wrapper, plus a thin `+page.server.ts` action that calls the shared helper. New sites inherit it.
- **Dashboard (this repo):** the ingest endpoint, status endpoint, Airtable `Submissions` module (`src/reports/airtable/submissions.ts`), and the cockpit/site rendering additions.

## Config / env vars

- **Dashboard (Netlify):** existing `RESEND_API_KEY`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `DASHBOARD_PASSWORD`; **new** `FORMS_INGEST_TOKEN`.
- **Each fleet site (Netlify):** **new** `FORMS_INGEST_TOKEN` (matching the dashboard) and `FORMS_INGEST_URL` (the dashboard ingest base, e.g. `https://reddoor-maintenance.netlify.app/api/forms`).

## Rollout sequence (prove, then propagate)

1. **Dashboard side end-to-end** — Airtable `Submissions` table + ingest endpoint + Resend notify/autoresponder + cockpit/site rendering + status endpoint. Testable in isolation.
2. **Publish the shared `@reddoorla/maintenance/forms` helper.**
3. **Prove on reddoor-website** (currently broken → highest value, clearest before/after).
4. **Migrate the 4 Netlify-Forms sites** one at a time (strip `data-netlify`, add the action + shared helper), verifying each before the next.
5. **New sites inherit from the starter** automatically.

## Testing

Vitest unit coverage (handlers stay thin so logic is unit-testable, per repo convention):

- field normalizer — the messy `name` vs `first_name`/`last_name` cases + `Extra fields` JSON capture,
- honeypot + timing validator,
- ingest token verification (constant-time),
- submission status state-machine,
- cockpit submissions model (counts, pinned queue),
- ingest handler happy-path + failure isolation (Airtable ok / Resend fails → `Notify status=failed`, still 200).

Plus `pnpm lint`, `pnpm typecheck` (incl. `.mts` via `tsconfig.netlify.json`), `pnpm test`, `pnpm build`, `pnpm test:dist` before merge ([[pre-merge-gate-includes-test-dist]]).

## Future enhancements (not in v1)

- Per-site verified Resend sending domains.
- Per-site ingest tokens (rotate one site without touching others).
- A digest/daily summary email of new submissions to the operator.
- Submission search/filter in the dashboard.
- Spam scoring beyond honeypot/timing.
