# Fleet Forms Phase 2b — gallerysonder (design)

**Date:** 2026-06-15
**Status:** approved (decisions below), ready for plan
**Site:** gallerysonder — Airtable `Sonder` (`recSUY16OKTY7NUNb`), slug **`sonder`**, Status `maintenance`, POC `josh@gallerysonder.com`, repo `reddoorla/gallerysonder`, prod `https://gallerysonder.com/`

gallerysonder is the **last** Phase 2b site. It moves off Netlify Forms onto the
central dashboard ingest (`POST /api/forms/:slug` on reddoor-maintenance) +
Airtable `Submissions`, like reddoor-website / alamo / data-dynamiq before it.

## Why this site is different

It is **client-driven**, not action-driven. All four forms are defined once as
hidden `<form>` elements in `src/routes/+layout.svelte` and submitted by JS:
each trigger calls `populateHiddenForm(id, values)` then `submitNetlifyForm(form)`
(`src/lib/utils/forms.ts`), which today URL-encodes the form and POSTs to `/`
(Netlify Forms). So the SvelteKit **action** factory (`createIngestAction`) does
not fit — this is the `+server.ts` **JSON endpoint** shape, the same as
data-dynamiq's modal.

The four forms (all hidden in `+layout.svelte`, triggered elsewhere):

| form-name | formType     | trigger                                    | notable fields (beyond name/email)                          |
| --------- | ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `contact` | `contact`    | TitleBlock slice (inline "Inquire" expand) | company, phone, appointment_date, appointment_time, message |
| `inquiry` | `inquiry`    | Lightbox artwork modal                     | phone, message, piece, artist, role                         |
| `news`    | `newsletter` | NewsletterSignup scroll-modal              | (name optional)                                             |
| `rsvp`    | `rsvp`       | `/rsvp/[uid]` page                         | event, guests                                               |

All four already carry a honeypot (`bot-field`) and five UTM hidden inputs
(`utm_source/medium/campaign/term/content`) bound to params captured at layout
mount. No Turnstile anywhere. All four funnel through the **one** client util.

## Decisions

1. **Factor a `createIngestEndpoint` package helper** — the JSON sibling of
   `createIngestAction`. There are now two consumers of the JSON-endpoint
   boilerplate (data-dynamiq + gallerysonder), so this is de-duplication, not a
   premature abstraction. Released as **0.37.0**.
2. **Retrofit data-dynamiq onto the helper now** — zero fleet drift; both
   client-driven sites share one code path. (3rd PR + redeploy + re-verify.)
3. **One multi-type endpoint** for gallerysonder (`/api/forms`), not four — the
   single client util naturally funnels all forms through one route. formType is
   carried in the body and validated against `SUBMISSION_FORM_TYPES`.
4. **UTM**: client combines the non-empty/non-`none` `utm_*` hidden inputs into a
   single `utm` query string (lands in the dedicated `utm` column), and sends
   `sourceUrl: window.location.href` for page context. Site-specific fields go in
   `extra`.

## Architecture

### Package: `createIngestEndpoint` (`src/forms/endpoint.ts`)

A factory mirroring `createIngestAction` but for a JSON `POST` handler. Returns
`(event: RequestEvent) => Promise<Response>` (structurally a SvelteKit
`RequestHandler`). Exported from the `@reddoorla/maintenance/forms` barrel.

```ts
export type CreateIngestEndpointOptions = {
  /** Read at call time so SvelteKit dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig; // { url?, token? } — reused from action.ts
  /** Map the parsed JSON body to a payload. Must set `formType` UNLESS the fixed
   *  `formType` option is given (then that is authoritative). */
  buildPayload: (body: Record<string, unknown>, event: RequestEvent) => SubmissionPayload;
  /** Fixed formType (single-type endpoints, e.g. data-dynamiq). Omit for
   *  multi-type endpoints where buildPayload derives it from the body. */
  formType?: string;
  /** Honeypot field name in the JSON body. Default "bot-field". */
  botFieldName?: string;
  /** json(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** json(400/502) copy for bad input / ingest failure. */
  errorMessage?: string;
};

export function createIngestEndpoint(
  opts: CreateIngestEndpointOptions,
): (event: RequestEvent) => Promise<Response>;
```

Behavior (the JSON analogue of `action.ts`, all responses via `json()`):

1. Parse body: `await event.request.json()`. On throw OR non-object →
   `json({ ok: false, error: errorMessage }, { status: 400 })`, log `[forms-ingest]`.
2. Honeypot screen: `screenSubmission({ botField: str(body[botFieldName]) ?? null })`
   — **no** timing check (a client POST has no server-planted `ts`;
   `screenSubmission` treats missing `elapsedMs` as OK). If `!ok` →
   `json({ ok: true })` (silently accept, do not forward — bots get no signal).
3. Build payload: `{ ...buildPayload(body, event), ...(opts.formType ? { formType: opts.formType } : {}) }`
   (fixed `formType` spread last = authoritative, matching the action).
4. Validate formType ∈ `SUBMISSION_FORM_TYPES`. If missing/invalid →
   `json({ ok: false, error: errorMessage }, { status: 400 })`, log.
5. Config: `const { url, token } = getConfig()`. If either unset →
   `json({ ok: false, error: unavailableMessage }, { status: 500 })`, log.
6. Forward: `submitToIngest({ url, token, fetch: event.fetch, payload })`.
   On `!ok` → `json({ ok: false, error: errorMessage }, { status: 502 })`, log.
7. Success → `json({ ok: true })`.

Response shape `{ ok: boolean, error? }` matches what data-dynamiq's client
already expects. Defaults: `unavailableMessage` = "This form is temporarily
unavailable. Please email us directly."; `errorMessage` = "Something went wrong
sending your message. Please try again."; `botFieldName` = "bot-field".

### gallerysonder site changes

- **`src/routes/api/forms/+server.ts` (new)** — `export const POST` =
  `createIngestEndpoint({ getConfig, buildPayload })` (multi-type; no fixed
  formType). `getConfig` reads `$env/dynamic/private` (`FORMS_INGEST_URL` /
  `FORMS_INGEST_TOKEN`). `buildPayload` pulls the typed fields (formType, name,
  email, phone, message, sourceUrl, utm) and bundles all remaining non-control
  keys into `extra`. `export const prerender = false`.
- **`src/lib/utils/forms.ts`** — keep `populateHiddenForm` unchanged. Replace
  `submitNetlifyForm` with `submitForm(form: HTMLFormElement)`:
  - read all FormData entries into an object;
  - derive `formType` from `form-name` (`news`→`newsletter`, else passthrough);
  - combine non-empty/non-`none` `utm_*` entries into a single `utm` query string
    (omit if empty); drop the individual `utm_*` keys and `form-name`;
  - attach `sourceUrl: window.location.href`;
  - keep `bot-field` (endpoint screens it);
  - JSON `POST` to `/api/forms`; return `{ success: boolean, status: number }`
    (same shape callers already handle).
- **`src/routes/+layout.svelte`** — drop `data-netlify="true"` and
  `data-netlify-honeypot="bot-field"` from all four `<form>`s. Keep the
  `form-name` hidden input (now just the formType marker the client reads), the
  `bot-field` honeypot, and the UTM hidden inputs.
- **Four trigger sites** (`TitleBlock/index.svelte`, `Lightbox.svelte`,
  `NewsletterSignup.svelte`, `rsvp/[uid]/+page.svelte`) — rename the import +
  call `submitNetlifyForm` → `submitForm`. No other change (the
  `populateHiddenForm` step and success/error UX stay).
- **`package.json`** — move `@reddoorla/maintenance` to **`dependencies`** at
  `^0.37.0` (it is now a server-runtime import in `/api/forms`, not just
  build-time `createSvelteConfig`).

### data-dynamiq retrofit

Replace the hand-written body of `src/routes/api/contact/+server.ts` with
`export const POST = createIngestEndpoint({ formType: "contact", getConfig,
buildPayload })` (fixed formType; buildPayload maps name/email/message/sourceUrl).
Bump `@reddoorla/maintenance` to `^0.37.0`. Behavior must stay byte-identical at
the wire (same `{ ok }` shape, same status codes). Redeploy + re-verify live.

## Error handling

The helper never throws. Bad JSON / invalid formType → 400; missing env → 500;
ingest non-2xx or network error → 502; bot → silent `{ ok: true }`. All non-200
paths log a `[forms-ingest]` line server-side. The client utils show the existing
per-form fallback message (`info@gallerysonder.com`) on any `success: false`.

## Testing

- **Package** (vitest, `test/forms/endpoint.test.ts`): bad JSON → 400; honeypot
  filled → 200 `{ok:true}` and **no** forward; missing formType → 400; invalid
  formType → 400; fixed `formType` overrides body; multi-type derives from body
  and validates; env missing → 500; ingest `{ok:false}` → 502; happy path →
  forwards exactly the built payload (with `formType`) and returns 200. Inject a
  fake `fetch` and a fake `getConfig`; assert on the forwarded request.
- **gallerysonder**: `pnpm lint`, `pnpm check` (svelte-check), `pnpm build`
  green. No unit tests in that repo — correctness is covered by the live-verify.
- **data-dynamiq**: `pnpm lint` / `check` / `build` green; live re-verify.

## Rollout / live-verify

1. PR-A (reddoor-maintenance): helper + tests → merge → **0.37.0** release PR
   (human-gated) → publish + dashboard redeploy.
2. PR-B (gallerysonder) on `^0.37.0`: migrate → CI green → merge → deploy.
3. PR-C (data-dynamiq) on `^0.37.0`: retrofit → CI green → merge → deploy.
4. Operator sets gallerysonder Netlify env: `FORMS_INGEST_URL =
https://reddoor-maintenance.netlify.app/api/forms/sonder` (**slug must be
   `sonder`** — the alamo lesson) + `FORMS_INGEST_TOKEN`.
5. **Verify guard**: flip Sonder Status → `launch period` so test notifications
   route to the operator, not Josh. POST one of each of the four formTypes to
   `https://gallerysonder.com/api/forms` (with a UTM-bearing `sourceUrl`).
   Confirm each `Submissions` row links `Site → recSUY16OKTY7NUNb`, correct
   `formType`, `utm`/`Source URL` populated, `Notify status: sent`. Delete the
   test rows. Restore Status → `maintenance`.
6. Re-verify data-dynamiq with the same flip-guard (its POC is set too).

## Out of scope / YAGNI

- No new form types (all four already in `SUBMISSION_FORM_TYPES`).
- No Turnstile (never present).
- No starter change — the starter bakes the **action** recipe; the endpoint
  recipe is for client-driven sites and isn't the default new-site shape.
- The `screenSubmission` MIN_FILL_MS fast-legit-drop risk remains a separate
  fast-follow (ingest-side metric), not addressed here.
