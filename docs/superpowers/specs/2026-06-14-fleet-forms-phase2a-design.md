# Fleet Forms Phase 2a — Shared Helper + reddoor-website Migration — Design Spec

- **Date:** 2026-06-14
- **Status:** Approved (design); ready for implementation planning
- **Owner:** Tucker
- **Builds on:** [[fleet-forms-pipeline-phase1]] (the dashboard ingest endpoint, live & verified). Phase 1 spec: `docs/superpowers/specs/2026-06-14-fleet-forms-resend-dashboard-design.md`.

## Problem

Phase 1 shipped the central dashboard pipeline: `POST /api/forms/:slug` (token-gated) → Airtable `Submissions` + Resend. It is live and end-to-end verified. But **no fleet site uses it yet** — they still rely on Netlify Forms or (in reddoor-website's case) a broken `fetch` to a non-existent endpoint that silently drops submissions.

## Goal (Phase 2a)

Build the **shared client helper** every fleet site will use to forward a submission to the dashboard endpoint, and **migrate one site end-to-end** — reddoor-website, whose contact form is the broken one (highest value, clearest before/after). This proves the full site→dashboard path live. Rolling the proven recipe to the 4 Netlify-Forms sites is **Phase 2b** (out of scope here).

## Non-goals (YAGNI)

- Migrating the other sites (gallerysonder, alamo-anatomy, data-dynamiq) — Phase 2b.
- A shared visual form component / UI kit — each site keeps its own form design; only the submit plumbing is shared.
- Site-side normalization or email — the dashboard already normalizes + sends; the site just forwards.
- CAPTCHA — honeypot + min-fill-time is the v1 bot deterrent (consistent with Phase 1).

## Decisions

| Decision         | Choice                                                                   | Rationale                                                                                                           |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Plumbing home    | **Shared `@reddoorla/maintenance/forms` subpath**                        | Fleet-wide fixes propagate via Renovate (fix-once philosophy); the alternative (per-site copies) reintroduces drift |
| Spec scope       | **Phase 2a = helper + reddoor-website only**                             | Prove the pattern live before applying it to 5 repos                                                                |
| Site → dashboard | Same-origin SvelteKit `+page.server.ts` action forwards server-to-server | No CORS, works without JS, token never exposed client-side                                                          |
| Env shape        | `FORMS_INGEST_URL` (full endpoint incl. slug) + `FORMS_INGEST_TOKEN`     | Slug baked into the URL → action code is identical fleet-wide (only env differs); ideal for the 2b starter template |
| Normalization    | Site forwards raw fields; **dashboard normalizes**                       | The dashboard already normalizes defensively; no duplicate logic on sites                                           |
| Bot screening    | honeypot (`bot-field`) + server-planted-timestamp min-fill-time          | Honeypot is primary; timing safe-degrades on cached pages                                                           |

## Architecture

```text
reddoor-website /contact
  <form method="POST" use:enhance>          ← same-origin, works without JS
        │
        ▼
  +page.server.ts  actions.default
    1. read FormData
    2. screenSubmission({ botField, elapsedMs })  → bot? return {success} silently, DON'T forward
    3. build SubmissionPayload { formType:"contact", name, email, phone, message, company, sourceUrl }
    4. submitToIngest({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN, payload, fetch })
    5. return { success: true } | fail(502, { error })
        │  server-to-server fetch, header x-forms-token
        ▼
  dashboard  POST /api/forms/reddoor        ← Phase 1, already live & verified
        → Airtable Submissions + Resend (POC + autoresponder)
```

The site stays dumb: screen + forward. Every real concern (normalize, store, email, status) is the proven dashboard endpoint.

## Component 1 — Shared subpath `@reddoorla/maintenance/forms` (reddoor-maintenance repo)

The package is published from reddoor-maintenance. A new browser/server-safe subpath is added; the existing dashboard-only modules (`ingest.ts`, `notify.ts`, `token.ts`, the Airtable `submissions.ts`) are **never** exported through it.

### `src/forms/types.ts` (new leaf)

Moves the form-type enum out of the Airtable module so it carries no server coupling:

```ts
export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];
```

`src/reports/airtable/submissions.ts` imports + re-exports these (so its existing consumers — `fleet-cockpit.ts`, `payload.ts` — keep working unchanged); `src/forms/payload.ts` imports from `./types.js`.

### `src/forms/client.ts` (new, site-facing)

- `submitToIngest({ url, token, payload, fetch? }): Promise<{ ok: true; id } | { ok: false; status; error }>` — POSTs JSON with `content-type: application/json` + `x-forms-token`; `fetch` injectable (SvelteKit's `event.fetch`), defaults to global `fetch`. Network throw → `{ ok: false, status: 0, error }`; non-2xx or `{ok:false}` body → `{ ok: false, status, error }`.
- `screenSubmission({ botField?, elapsedMs? }): { ok: true } | { ok: false; reason: "honeypot" | "too-fast" }` — pure. Filled `bot-field` → honeypot; `elapsedMs` present and `< 2000` → too-fast; otherwise ok (missing timing data is not a rejection).
- exports `SubmissionPayload` (the permissive wire type: optional typed fields + index signature for site-specific extras like `company`), and re-exports `SUBMISSION_FORM_TYPES`/`FormType`.

### `src/forms/index.ts` (new barrel)

Exports only `client.ts` + `types.ts` surface (the site-facing API). Never `ingest`/`notify`/`token`.

### Build wiring

- `tsup.config.ts` `entry` array gains `"src/forms/index.ts"` → emits `dist/forms/index.js` + `.d.ts`.
- `package.json` `exports` gains `"./forms": { "types": "./dist/forms/index.d.ts", "import": "./dist/forms/index.js" }`.
- A changeset (minor bump → 0.34.0) — the npm release/publish is a human gate (releases are not auto-merged).

## Component 2 — reddoor-website migration (reddoor-website repo)

- `package.json`: `@reddoorla/maintenance` moved to `dependencies`, bumped to the new release (`^0.34.0`).
- `src/routes/[[preview=preview]]/contact/+page.server.ts`:
  - `load` adds `formTs: Date.now()` (planted server-side per request for the timing check).
  - `actions.default` (thin): read FormData → `screenSubmission` (bot → `{success}` silently) → check env present (`$env/dynamic/private`) → `submitToIngest({ formType:"contact", name, email, phone, message, company, sourceUrl, fetch })` → `{success}` or `fail(502,{error})`.
- `src/routes/[[preview=preview]]/contact/+page.svelte`: drop `data-netlify`/`form-name`/the client `handleSubmit`; use a real `<form method="POST" use:enhance>` posting to the action, **keeping the existing Tailwind design/classes**, the hidden `bot-field` honeypot, and a hidden `ts` field bound to `data.formTs`. Render success/error from the action result (`form?.success` / `form?.error`).

## Config / env (operator, on reddoor-website's Netlify site)

- `FORMS_INGEST_TOKEN` — same value as the dashboard.
- `FORMS_INGEST_URL` — `https://reddoor-maintenance.netlify.app/api/forms/reddoor` (full endpoint incl. the `reddoor` slug).

## Error handling

- Honeypot/timing fail → `{ success: true }` with **no forward** (bots get no signal).
- Env missing → `fail(500, { error })` + server log.
- Ingest non-2xx or network error → `fail(502, { error: "Couldn't send — try again or email info@reddoorla.com." })`.
- No-JS: plain POST → action runs → page re-renders with the result. `use:enhance` upgrades to AJAX when JS is on.

## Testing

- **Package (vitest):** `screenSubmission` (honeypot / too-fast / ok / missing-timing branches); `submitToIngest` with a mocked `fetch` (success `{ok:true,id}` → ok; `401`/`{ok:false,error}` → error; fetch-throw → `{status:0}`). Full gate (lint/typecheck/test/build/test:dist).
- **reddoor-website:** the action is thin glue over the (package-tested) helpers; verification is a live submission through the deployed form (the same approach that validated Phase 1). The site's own CI (lint/svelte-check/build) must stay green.

## Rollout sequence

1. Ship + merge the `/forms` subpath in reddoor-maintenance (auto-merge once green).
2. **Human gate: release the package** (changeset → version-packages release PR → npm publish, e.g. `0.34.0`).
3. reddoor-website PR: dep bump + action + form rewrite. Set the 2 Netlify env vars.
4. Deploy → live-verify a real submission lands in the dashboard (submit through the actual contact form).

## Future (Phase 2b, not here)

Roll the proven recipe to the 4 Netlify-Forms sites (gallerysonder — 4 forms, alamo-anatomy, data-dynamiq), and seed the action + form into reddoor-starter so new sites inherit it. Strip `data-netlify` per site; verify each before the next.
