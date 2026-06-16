# ERP Forms Migration — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorm complete)
**Phase:** Fleet Forms 2c — ERP (the bespoke site)

## Goal

Migrate `erp-industrial`'s contact form onto the central `@reddoorla/maintenance` forms-ingest pipeline with no loss of its lead-routing behavior, by adding one **generic** capability to the pipeline — field-based recipient routing with multiple recipients + CC — and porting ERP's form to the standard `createIngestAction` pattern.

## Context — ERP today (to be replaced)

`src/routes/contact/+page.server.ts` does, bespoke:

- **reCAPTCHA Enterprise** verification (score ≥ 0.5, GCP project `energy-related-properties`, secret `RECAPTCHA_SECRET_KEY`, site key hardcoded in `src/lib/recaptcha.ts`).
- **Resend direct** (`RESEND_API_KEY`, from `submissions@reddoorla.com`).
- **Interest-routed recipients**, always CC `tucker@reddoorla.com`:
  - `Leasing` → `BBerry@erpfunds.com`
  - `Investor Relations` → `pespinoza@erpfunds.com`
  - `Property Sales and Acquistions` → `MBerry@erpfunds.com` (note ERP's "Acquistions" spelling)
  - default → `tucker@reddoorla.com`
- Fields: `email`, `interest` (`<select>`), `message`. No name/phone. **No Airtable persistence** (leads never hit the cockpit).

## Decisions (from brainstorm)

1. **Drop reCAPTCHA.** Replace with the fleet-standard honeypot + min-fill-time screen. No captcha code in the pipeline or the site; `recaptcha.ts` + the GCP secret retire.
2. **Routing table = JSON field on the Airtable Websites row** (`Notify Routing`). Operator-editable, generic, parsed defensively.
3. ERP ports to **`createIngestAction`** (progressively-enhanced server form action), like the Phase 2c easy three.

## Architecture

### New pipeline capability: field-based routing (generic, dashboard-side)

A site may declare how to route its notification by a submission field. The routing config lives on the Websites row and is read at notify time. Recipients **always resolve server-side** — the site never supplies a recipient (no open-relay risk).

**Type** (`src/forms/notify.ts` or a small sibling):

```ts
export type NotifyRouting = {
  field: string; // extraFields key to route on, e.g. "interest"
  routes: Record<string, string | string[]>; // field-value → recipient(s)
  default?: string | string[]; // fallback recipient(s)
  cc?: string[]; // CC applied to routed (maintenance) sends
};
```

**Recipient resolution** replaces the current `notifyRecipient(site): string | null` with:

```ts
resolveRecipients(site: WebsiteRow, submission: SubmissionRow): { to: string[]; cc: string[] } | null
```

Semantics:

- `site.status !== "maintenance"` → `{ to: [operatorEmail()], cc: [] }`. **Verify guard preserved** — pre-launch sends go to the operator only, with no routing and no CC.
- `status === "maintenance"` **and** `site.notifyRouting` present → read `value = parsedExtraFields[routing.field]`; `chosen = routing.routes[value] ?? routing.default`; if `chosen` resolves to ≥1 address → `{ to: normalize(chosen), cc: routing.cc ?? [] }`. If nothing resolves, fall through to POC.
- `status === "maintenance"`, no routing (or routing yielded nothing) → `{ to: [pocAddress(site)], cc: [] }` if a POC exists, else `null` (**unchanged for every existing site**).

`normalize()` coerces `string | string[]` → `string[]`, trims, drops empties, de-dupes.

### Config parsing (defensive)

`mapRow` in `src/reports/airtable/websites.ts` gains `notifyRouting: NotifyRouting | null`, via a `parseNotifyRouting(raw: unknown)` helper:

- non-string / blank → `null`
- `JSON.parse` in try/catch → `null` on error
- shape validation: must be an object with a string `field` and an object `routes`; otherwise `null`
- consistent with the pipeline's existing "bad Airtable string degrades quietly, never throws" rule (fmtDate/reportType lessons).

A `null` routing means the site behaves exactly as it does today (single POC). So this change is inert for all current sites until a `Notify Routing` value is set.

### Notification builders

- `buildPocNotification`: call `resolveRecipients`; `null`/empty `to` → return `null`. Set `to` (array) and `cc` (only when non-empty). `replyTo = submission.email` (the lead) — unchanged. `cc`/`to` already supported by `ResendSendInput` + the Resend send fn (no resend.ts change needed).
- `buildAutoresponder`: `replyTo = resolveRecipients(...)?.to[0] ?? FALLBACK_REPLY_TO`.

### ERP site port (`erp-industrial`)

- `contact/+page.server.ts`: delete reCAPTCHA verify, Resend, interest routing. Add `prerender = false`, `load → { formTs: Date.now() }`, and:
  ```ts
  actions.default = createIngestAction({
    formType: "contact",
    getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
    buildPayload: (form, event) => ({
      email: form.get("email")?.toString(),
      message: form.get("message")?.toString(),
      interest: form.get("interest")?.toString() || undefined, // → extraFields.interest, the routing key
      sourceUrl: event.url.href,
    }),
  });
  ```
- `contact/+page.svelte`: remove the `grecaptcha` script (`<svelte:head>`) and the custom `handleSubmit`/`fetch`; convert to a `use:enhance` POST with hidden `ts` + `bot-field` honeypot, success/error via the `form` prop, disabled-while-submitting. Keep the interest `<select name="interest">` (its values must match the Airtable `routes` keys exactly).
- Delete `src/lib/recaptcha.ts`; remove the `resend` dependency; bump `@reddoorla/maintenance` to the version PR1 releases.
- `.env.example`: `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/erp-industrials` + `FORMS_INGEST_TOKEN`; remove `RECAPTCHA_*` / `RESEND_API_KEY` / `CONTACT_TEST_EMAIL` docs.
- **Slug = `erp-industrials`** (`siteSlug("ERP Industrials")` — the Airtable Name is plural, even though the repo is `erp-industrial`).

### Airtable

Add a `Notify Routing` long-text column to Websites. Set the ERP Industrials row to:

```json
{
  "field": "interest",
  "routes": {
    "Leasing": "BBerry@erpfunds.com",
    "Investor Relations": "pespinoza@erpfunds.com",
    "Property Sales and Acquistions": "MBerry@erpfunds.com"
  },
  "default": "tucker@reddoorla.com",
  "cc": ["tucker@reddoorla.com"]
}
```

## Data flow

ERP form → `createIngestAction` → POST `/api/forms/erp-industrials` (dashboard ingest) → `ingestSubmission` normalizes (interest into `extraFields`) → persists to Submissions → `notify` → `resolveRecipients(site, submission)` reads `site.notifyRouting` + `submission.extraFields.interest` → routed POC email (+CC) → autoresponder to the lead.

## Error handling

- Bad/blank `Notify Routing` JSON → `null` → site falls back to single-POC behavior. Never throws.
- Routing value not in `routes` and no `default` → POC → skip (lead still persisted; notifyStatus reflects it). Never loses a lead.
- All notify side-effects remain best-effort/logged downstream of persistence (existing pipeline guarantee).

## Testing (PR1, TDD — repo has vitest)

`resolveRecipients` matrix:

- pre-launch status → `{to:[operator], cc:[]}` (routing ignored).
- maintenance + routing, value matches a route → routed `to` + `cc`.
- maintenance + routing, value missing/unknown → `default` + `cc`.
- maintenance + routing, no match + no default → POC; none → `null`.
- maintenance, no routing → POC (regression guard for existing sites).
- `routes` value as array → multiple `to`.
- bad JSON / wrong shape in `parseNotifyRouting` → `null`.
- `buildPocNotification` emits `cc` only when non-empty; `replyTo` = lead.

## Sequencing

1. **PR1** (reddoor-maintenance): pipeline extension + tests. Merge → dashboard auto-deploys the routing logic on main.
2. **Airtable**: add `Notify Routing` column + set ERP row JSON.
3. **PR2** (erp-industrial): the port. Merge.
4. **Cutover** (operator + verify): set ERP Netlify env (slug `erp-industrials` + shared token) + redeploy; verify capture/notify in `launch period` (operator-only); verify routing safely by temporarily pointing all `routes` → `tucker@reddoorla.com`, flip to `maintenance`, submit one per interest, confirm slot + CC, then swap in real `@erpfunds.com` addresses; remove old `RECAPTCHA_*`/`RESEND_API_KEY` Netlify vars.

## Out of scope

- Per-site captcha in the pipeline (decided against — dropped reCAPTCHA).
- Routing on any field other than what a site configures (generic by design; only ERP uses it now).
