# Fleet Forms Phase 2b — Starter Recipe + `createIngestAction` Factory

**Date:** 2026-06-15
**Status:** Approved (design)
**Predecessors:** [Phase 1](2026-06-14-fleet-forms-resend-dashboard-design.md) (dashboard ingest + Airtable `Submissions`), [Phase 2a](2026-06-14-fleet-forms-phase2a-design.md) (shared `@reddoorla/maintenance/forms` subpath + reddoor-website migration).

## Purpose

Phase 2b rolls the proven fleet-forms recipe to the remaining live sites and bakes it
into the clone skeleton. This spec covers the **first sub-project only**: a small
package addition (a `createIngestAction` factory) plus baking the canonical
contact-form recipe into **reddoor-starter** so every freshly-cloned site inherits a
working, dashboard-wired contact form.

Each remaining site is its own subsequent spec/plan/PR (see roadmap below).

## Phase 2b roadmap & shared decisions (recorded here for later sub-projects)

Sequence (user-approved 2026-06-15): **starter first** (this spec), then one site at a
time in ascending complexity: **alamo-anatomy → data-dynamiq → gallerysonder**.

Shared decisions that apply to every Phase 2b sub-project:

- **Slugs are derived from the Airtable `Websites.Name` field** via `siteSlug()`
  (`lowercase → non-alphanumeric runs → "-" → strip leading/trailing "-"`). There is
  **no dedicated Slug field**. Confirmed live slugs:
  - data-dynamiq → Name `"Data Dynamiq"` → slug `data-dynamiq` (POC set → notify sends)
  - gallerysonder → Name `"Sonder"` → slug **`sonder`** (POC set → notify sends)
  - alamo-anatomy → Name `"Alamo Anatomy"` → slug `alamo-anatomy` (no POC → notify skips, fine)
- **Turnstile is dropped** (data-dynamiq) in favor of the fleet honeypot + timing screen.
- **Extra fields → the `Extra fields` JSON blob.** Only `name`/`firstName`/`lastName`/
  `email`/`phone`/`message`/`sourceUrl` map to typed columns; everything else
  (reserve's 26 fields, rsvp guests, inquiry piece/artist, UTM params) rides along in
  the payload and the dashboard normalizer captures it into `Extra fields`. No schema
  changes.
- All form types in use (`contact, inquiry, newsletter, rsvp, reserve`) are **already**
  in `SUBMISSION_FORM_TYPES`. No enum change needed.
- Every site inherits `prerender = "auto"` from its root layout, so **every migrated
  form route needs `export const prerender = false`** (the Phase 2a lesson, now
  fleet-wide). A form `action` on a prerendered route throws _"Cannot prerender pages
  with actions"_ — and `"auto"` hides this past build/check, surfacing only as a live 500.

## Goal (this sub-project)

1. **Package:** add `createIngestAction()` to `@reddoorla/maintenance/forms` so a site's
   form `+page.server.ts` is ~12 lines and the screen/env/forward/error boilerplate
   lives once, propagating fleet-wide via Renovate.
2. **Starter:** add a canonical, self-contained contact route to reddoor-starter built
   on the factory + the starter's existing `Form`/`Field` components, wired to the
   dashboard ingest endpoint.

## Architecture

Two repos, two PRs, sequenced (package released before the starter can consume it,
exactly as in Phase 2a):

- **PR1 — reddoor-maintenance:** new `src/forms/action.ts` (`createIngestAction`) +
  re-export from `src/forms/index.ts` + unit tests + changeset → release **0.35.0**.
- **PR2 — reddoor-starter:** new contact route using `createIngestAction`, dep bump to
  `^0.35.0` (moved to `dependencies`), `.env.example` vars, and a docs update replacing
  the Netlify-Forms recommendation.

### Component 1 — `createIngestAction` factory (PR1)

New leaf module `src/forms/action.ts`. It is the only `@reddoorla/maintenance/forms`
export that touches SvelteKit (`fail`), so SvelteKit becomes an **optional peer
dependency** (and a devDependency so the package's own tests run). tsup externalizes
peer deps, so `dist/forms/index.js` keeps `import { fail } from "@sveltejs/kit"` as an
unbundled external — resolved at the consuming site, where kit is always present. The
dashboard never imports the `/forms` barrel (it imports `src/forms/{ingest,notify,
payload,token,types}` directly), so loading kit is never triggered in the Node/dashboard
runtime.

**Responsibility:** turn a config + per-form field mapping into a ready SvelteKit
`default` action.

```ts
// src/forms/action.ts
import { fail, type ActionFailure, type RequestEvent } from "@sveltejs/kit";
import { submitToIngest, screenSubmission, type SubmissionPayload } from "./client.js";

export type IngestActionConfig = { url?: string; token?: string };

export type CreateIngestActionOptions = {
  /** Stamped onto every payload as `formType` (a SUBMISSION_FORM_TYPES value). */
  formType: string;
  /** Read at call time so SvelteKit's dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig;
  /** Map this form's fields to a payload. `formType` is injected by the factory. */
  buildPayload: (form: FormData, event: RequestEvent) => SubmissionPayload;
  /** Honeypot input name. Default "bot-field". */
  botFieldName?: string;
  /** Hidden timestamp input name (planted in `load`). Default "ts". */
  tsFieldName?: string;
  /** fail(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** fail(502) copy when the ingest endpoint rejects/errors. */
  errorMessage?: string;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
};

export type IngestActionData = { success: true } | ActionFailure<{ error: string }>;

export function createIngestAction(
  opts: CreateIngestActionOptions,
): (event: RequestEvent) => Promise<IngestActionData> {
  const botFieldName = opts.botFieldName ?? "bot-field";
  const tsFieldName = opts.tsFieldName ?? "ts";
  const now = opts.now ?? Date.now;
  const unavailable =
    opts.unavailableMessage ?? "This form is temporarily unavailable. Please email us directly.";
  const failed =
    opts.errorMessage ?? "Something went wrong sending your message. Please try again.";

  return async (event) => {
    const form = await event.request.formData();

    // Bot screen: filled honeypot OR implausibly fast fill → silently accept
    // (return success, do NOT forward) so bots get no signal.
    const screen = screenSubmission({
      botField: form.get(botFieldName)?.toString() ?? null,
      elapsedMs: elapsedMs(form.get(tsFieldName), now),
    });
    if (!screen.ok) return { success: true };

    const { url, token } = opts.getConfig();
    if (!url || !token) return fail(500, { error: unavailable });

    const result = await submitToIngest({
      url,
      token,
      fetch: event.fetch,
      payload: { formType: opts.formType, ...opts.buildPayload(form, event) },
    });
    if (!result.ok) return fail(502, { error: failed });
    return { success: true };
  };
}

function elapsedMs(tsRaw: FormDataEntryValue | null, now: () => number): number | null {
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return now() - ts;
}
```

`src/forms/index.ts` adds: `export { createIngestAction, type CreateIngestActionOptions,
type IngestActionConfig, type IngestActionData } from "./action.js";`

**Why a thunk for config:** SvelteKit's `$env/dynamic/private` must be read at request
time, not module-init; `getConfig()` closes over the site's import and is invoked inside
the action. **Why `fail` over a plain return:** proper HTTP status (500/502) for
monitoring and the non-JS fallback, matching the Phase 2a reddoor-website behavior.

### Component 2 — starter contact route (PR2)

New route `src/routes/contact/` — deliberately _not_ under `[[preview=preview]]` and
_not_ Prismic-backed, so the recipe is self-contained and works in a fresh clone before
Prismic is wired. (Real sites typically relocate it to `[[preview=preview]]/contact`
with Prismic-driven copy; the plumbing transfers unchanged.)

`src/routes/contact/+page.server.ts`:

```ts
import { env } from "$env/dynamic/private";
import { createIngestAction } from "@reddoorla/maintenance/forms";
import type { Actions, PageServerLoad } from "./$types";

// Root layout sets prerender = "auto"; a form action can't run on a prerendered
// route. Opt out — this route is genuinely dynamic.
export const prerender = false;

export const load: PageServerLoad = () => ({ formTs: Date.now() });

export const actions: Actions = {
  default: createIngestAction({
    formType: "contact",
    getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
    buildPayload: (form, event) => ({
      name: form.get("name")?.toString(),
      email: form.get("email")?.toString(),
      phone: form.get("phone")?.toString(),
      message: form.get("message")?.toString(),
      sourceUrl: `${event.url.origin}${event.url.pathname}`,
    }),
  }),
};
```

`src/routes/contact/+page.svelte` uses a native `<form method="POST" use:enhance>` with
the starter's accessible `Field` components inside. (It does **not** use the `Form`
wrapper component: `use:enhance` is a Svelte action and actions attach to DOM elements,
not components, so `<Form use:enhance>` is invalid; the `Form` wrapper's only extra
feature is a multi-error summary, unused here since the factory returns a single `error`
string.) It renders `form?.success` / `form?.error` and includes the two anti-bot inputs
the factory expects:

- a hidden `ts` input valued from `data.formTs` (planted per-request by `load`);
- a hidden honeypot `bot-field` input (`display:none` via `class="hidden"`,
  `tabindex="-1"`, `autocomplete="off"`, `aria-hidden`) — `display:none` keeps it out of
  the a11y tree and tab order while still submitting its value, so naive bots fill it.

A `submitting` `$state` disables the button during flight.

### Component 3 — wiring & docs (PR2)

- **package.json:** move `@reddoorla/maintenance` from `devDependencies` to
  `dependencies` (it is now runtime, imported by the server action) and bump to
  `^0.35.0`.
- **.env.example:** add, with placeholder + comment:
  ```
  # Fleet forms: forward submissions to the central dashboard ingest endpoint.
  # Set BOTH on the site (plural names). Token is the SAME value as the dashboard's
  # FORMS_INGEST_TOKEN; URL points at this site's slug.
  FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/<slug>
  FORMS_INGEST_TOKEN=replace-with-the-shared-forms-ingest-token
  ```
- **CSP:** no change. `form-action 'self'` already permits the same-origin POST to the
  action; the cross-origin hop to the dashboard is server→server (not subject to the
  page CSP).
- **docs/rfp-handbook.md:** replace the Netlify-Forms recommendation with the
  dashboard-forms recipe — point at `src/routes/contact/`, the two env vars, and the
  honeypot/timing screen as the fleet anti-spam approach.

## Data flow

```
Visitor → /contact (SSR, prerender=false) → submits <form method=POST use:enhance>
  → SvelteKit default action = createIngestAction(...)
    → screenSubmission(honeypot, ts-timing)         [bot → return {success:true}, no forward]
    → getConfig() reads $env/dynamic/private
    → submitToIngest(POST JSON + x-forms-token, event.fetch)
      → dashboard POST /api/forms/<slug> → Airtable Submissions row (+ POC/autoresponder)
    → ok → {success:true} ; non-ok → fail(502) ; env missing → fail(500)
  → +page.svelte renders form?.success / form?.error
```

## Error handling

- **Bot (honeypot/too-fast):** silent `{success:true}`, no forward (factory).
- **Env unset:** `fail(500)` with a friendly "email us directly" message; logged by the
  site is optional (the factory does not log — keep it dependency-light; sites may add a
  wrapper if they want logging, but the recipe does not).
- **Ingest non-2xx / network:** `submitToIngest` never throws → factory returns
  `fail(502)` with a retry message. The lead is not silently dropped from the visitor's
  perspective (they see an error and an email fallback).
- **Missing/garbage `ts`:** `elapsedMs` returns `null`; `screenSubmission` does not treat
  null as a rejection (honeypot remains the primary signal).

## Testing

**PR1 (package) — `tests/forms/action.test.ts`** (vitest), using a fake `RequestEvent`
(`{ request: { formData: async () => fd }, fetch: stubFetch, url: new URL(...) }`) and
an injected `now`:

- honeypot filled → resolves `{success:true}`, `stubFetch` NOT called;
- `ts` = now (elapsed ≈ 0 < 2000) → `{success:true}`, NOT forwarded;
- env unset (`getConfig` → `{}`) → `ActionFailure` with `status === 500`;
- happy path → `submitToIngest` called once; asserts the payload carries the injected
  `formType`, mapped fields, and `sourceUrl`; returns `{success:true}`;
- ingest non-ok (stubFetch → 502 / `{ok:false}`) → `ActionFailure` with `status === 502`;
- `ts` old enough (elapsed ≥ 2000) + clean honeypot → forwards.

**PR2 (starter):** `pnpm lint`, `pnpm check`, `pnpm build` green (build must succeed
with the new non-prerendered route present); the existing Playwright + axe a11y gate
still passes. No live submission — the starter is a skeleton with no deploy/slug of its
own; live verification happens per real site in later sub-projects.

## Out of scope

- Refactoring reddoor-website's existing inline action onto the factory (optional later
  cleanup; leave it working as-is).
- Any of the three live sites (each a separate sub-project).
- A reusable honeypot Svelte snippet/component (YAGNI for one route; revisit if the
  per-site forms want to share markup).
- Logging inside the factory (kept dependency-light).

## Operator follow-ups (none blocking this sub-project)

- When the live sites are migrated, set `FORMS_INGEST_URL` (with the right slug) +
  `FORMS_INGEST_TOKEN` (shared value) in each site's Netlify env — plural names.
- Optionally set a POC on the alamo-anatomy Website record so its notifications send.
