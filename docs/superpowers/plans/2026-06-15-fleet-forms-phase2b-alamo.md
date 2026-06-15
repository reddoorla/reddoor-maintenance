# Fleet Forms Phase 2b — alamo-anatomy migration (+ 0.36.0: `redirectTo` & status-aware notify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate alamo-anatomy's two Netlify-Forms (contact + 26-field reserve) onto the dashboard-forms recipe, preserving its dedicated `/thank-you` redirect, and add two reusable `@reddoorla/maintenance` capabilities first: a factory `redirectTo` option and a status-aware notify recipient (pre-launch sites route leads to the operator).

**Architecture:** Two repos, sequenced. **PR3 (reddoor-maintenance)** adds `redirectTo` to `createIngestAction` + a status-aware notify recipient in `notify.ts`, released as **0.36.0**. After release, **PR4 (alamo-anatomy)** migrates both form routes onto `createIngestAction({ redirectTo: "/thank-you" })`.

**Tech Stack:** TypeScript (ESM/NodeNext, strict, tsup, vitest, changesets), SvelteKit (Svelte 5, adapter-netlify, Prismic), pnpm.

**Predecessor specs/plans:** `docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-starter-design.md`, `docs/superpowers/plans/2026-06-15-fleet-forms-phase2b-starter.md`. This is the next Phase 2b sub-project (alamo).

---

## Design context & decisions (user-approved 2026-06-15)

1. **Keep `/thank-you` via a factory `redirectTo` option.** Alamo's two forms both redirect to a polished, shared `/thank-you` page (`src/routes/thank-you/+page.svelte`, noindex). Rather than regress to inline success or hand-roll a per-site wrapper, `createIngestAction` gains an optional `redirectTo`; on a successful **or bot-screened** submission it throws `redirect(303, redirectTo)` (bots get the same signal as humans). Reusable by any future site with a thank-you page.

2. **Status-aware notify recipient (new fleet rule).** Pre-launch sites should route leads to the operator who is monitoring them, not a client who isn't live. Rule: **`site.status !== "maintenance"` → operator email; `"maintenance"` → the client POC** (current `pointOfContact ?? reportRecipientsTo`, may be null → skip). Operator email = `process.env.OPERATOR_EMAIL` (trimmed) or fallback **`tucker@reddoorla.com`**. The `Status` union is `"launch period" | "maintenance" | "hosting" | … | "deprecated"`; `launchSite()` flips a site to `"maintenance"` at launch, so this tracks the lifecycle. Alamo is `"launch period"` → its leads go to `tucker@reddoorla.com` with no client POC needed.

3. **Extras → `Extra fields` JSON** (the existing Phase 2b decision). Only `name`/`firstName`/`lastName`/`email`/`phone`/`message`/`sourceUrl` map to typed columns; reserve's other fields ride along in the payload (the dashboard normalizer captures them into `Extra fields`).

4. **Airtable audit:** alamo `recc4GlKJDnatGdDi` (Name "Alamo Anatomy" → slug `alamo-anatomy`, Git repo correct, Status "launch period") is **missing `url`** (set it once the live URL is known) and has **no `point of contact`** (intentionally left unset — the status rule covers it during launch). These are data fixes done via the Airtable MCP, not code (Task 9).

5. **`sourceUrl = event.url.href`** (full URL incl. query string) so UTM/campaign params are captured — same as the starter recipe.

---

## File Structure

**PR3 — reddoor-maintenance** (cwd: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`)

- Modify: `src/forms/action.ts` — add `redirectTo` option + `redirect` import + single success path.
- Modify: `tests/forms/action.test.ts` — redirect cases.
- Modify: `src/forms/notify.ts` — `operatorEmail()` + `notifyRecipient(site)`; use in `buildPocNotification` (`to`) and `buildAutoresponder` (`replyTo`).
- Create: `tests/forms/notify.test.ts` (or extend an existing notify test if present) — status-aware recipient cases.
- Create: `.changeset/forms-redirect-and-status-notify.md` — minor → 0.36.0.

**PR4 — alamo-anatomy** (cwd: `/Users/tuckerlemos/Documents/GitHub/alamo-anatomy`)

- Modify: `package.json` — `@reddoorla/maintenance` → `^0.36.0` (already a dependency).
- Modify: `src/routes/[[preview=preview]]/contact/+page.server.ts` — add `prerender=false`, `load` `formTs`, `actions.default` via factory (`redirectTo:"/thank-you"`).
- Modify: `src/routes/[[preview=preview]]/contact/+page.svelte` — swap `data-netlify`→`use:enhance`, drop `form-name`/`action`, add hidden `ts`, keep `bot-field` honeypot, add inline error render.
- Modify: `src/routes/[[preview=preview]]/reserve/+page.server.ts` — same, `formType:"reserve"`, 26-field `buildPayload`.
- Modify: `src/routes/[[preview=preview]]/reserve/+page.svelte` — same mechanism swap; keep datepicker/fieldsets/checkboxes untouched.

---

# PR3 — reddoor-maintenance 0.36.0

> cwd `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`. Branch: `git checkout main && git pull --ff-only && git checkout -b feat/forms-redirect-status-notify`.

### Task 1: `redirectTo` option on `createIngestAction` (TDD)

**Files:** `src/forms/action.ts`, `tests/forms/action.test.ts`

- [ ] **Step 1: Add failing tests** to `tests/forms/action.test.ts` (append inside the existing `describe`). SvelteKit `redirect(status, location)` throws a `Redirect` object with `status` + `location`; assert via `.rejects`.

```ts
it("redirects on success when redirectTo is set", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    redirectTo: "/thank-you",
    now,
  });
  await expect(action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock))).rejects.toMatchObject(
    { status: 303, location: "/thank-you" },
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("redirects a bot-screened submission too (no signal to bots)", async () => {
  const fetchMock = vi.fn();
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: () => ({}),
    redirectTo: "/thank-you",
    now,
  });
  await expect(
    action(fakeEvent({ email: "a@b.co", ts: goodTs, "bot-field": "bot" }, fetchMock)),
  ).rejects.toMatchObject({ status: 303, location: "/thank-you" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does NOT redirect on ingest failure (stays on page with the error)", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(502, { ok: false, error: "down" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    redirectTo: "/thank-you",
    now,
  });
  const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
  expect((result as { status?: number }).status).toBe(502);
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/forms/action.test.ts` (the redirect tests fail; `redirectTo` not yet handled).

- [ ] **Step 3: Implement.** In `src/forms/action.ts`: add `redirect` to the kit import; add the `redirectTo?: string` option (with JSDoc); route both the bot-screen path and the final success through one `succeed()` helper that redirects when configured.

Change the import:

```ts
import { fail, redirect, type ActionFailure, type RequestEvent } from "@sveltejs/kit";
```

Add to `CreateIngestActionOptions`:

```ts
  /** If set, a successful OR bot-screened submission throws redirect(303, redirectTo)
   *  instead of returning {success:true} (e.g. a dedicated /thank-you page). */
  redirectTo?: string;
```

Replace the returned action body so both success points funnel through `succeed()`:

```ts
return async (event) => {
  let form: FormData;
  try {
    form = await event.request.formData();
  } catch {
    console.error(`[forms-ingest] ${opts.formType}: could not parse form body`);
    return fail(400, { error: failed });
  }

  const screen = screenSubmission({
    botField: form.get(botFieldName)?.toString() ?? null,
    elapsedMs: elapsedMs(form.get(tsFieldName), now),
  });
  if (!screen.ok) return succeed();

  const { url, token } = opts.getConfig();
  if (!url || !token) {
    console.error(`[forms-ingest] config missing for formType=${opts.formType}`);
    return fail(500, { error: unavailable });
  }

  const result = await submitToIngest({
    url,
    token,
    fetch: event.fetch,
    payload: { ...opts.buildPayload(form, event), formType: opts.formType },
  });
  if (!result.ok) {
    console.error(`[forms-ingest] ${opts.formType} → ${result.status}: ${result.error}`);
    return fail(502, { error: failed });
  }
  return succeed();
};

function succeed(): { success: true } {
  if (opts.redirectTo) redirect(303, opts.redirectTo);
  return { success: true };
}
```

(`succeed()` is declared inside `createIngestAction` so it closes over `opts`. `redirect()` returns `never`, so the trailing `return` keeps the `{ success: true }` type.)

- [ ] **Step 4: Run → PASS** — `pnpm vitest run tests/forms/action.test.ts` (original 8 + 3 new = 11 green).

- [ ] **Step 5: Commit** — `git add src/forms/action.ts tests/forms/action.test.ts && git commit -m "feat(forms): add redirectTo option to createIngestAction"`

---

### Task 2: Status-aware notify recipient (TDD)

**Files:** `src/forms/notify.ts`, `tests/forms/notify.test.ts`

First check whether a notify test file already exists: `ls tests/forms/`. If `notify.test.ts` exists, append to it; otherwise create it.

- [ ] **Step 1: Add failing tests.** Create/extend `tests/forms/notify.test.ts`. Build minimal `WebsiteRow`/`SubmissionRow` fakes (cast `as WebsiteRow` / `as SubmissionRow`; only the fields the code reads matter: `status`, `name`, `pointOfContact`, `reportRecipientsTo`, and submission `formType`/`email`).

```ts
import { describe, it, expect, afterEach } from "vitest";
import { buildPocNotification } from "../../src/forms/notify.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

function site(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    name: "Alamo Anatomy",
    status: "launch period",
    pointOfContact: null,
    reportRecipientsTo: null,
    ...over,
  } as WebsiteRow;
}
const sub = { formType: "contact", name: "A", email: "lead@x.co" } as SubmissionRow;

afterEach(() => {
  delete process.env.OPERATOR_EMAIL;
});

describe("buildPocNotification — status-aware recipient", () => {
  it("routes a non-maintenance (launch period) site to the operator fallback", () => {
    const out = buildPocNotification(site({ status: "launch period" }), sub);
    expect(out?.to).toEqual(["tucker@reddoorla.com"]);
  });

  it("honors OPERATOR_EMAIL for a non-maintenance site", () => {
    process.env.OPERATOR_EMAIL = "ops@reddoorla.com";
    const out = buildPocNotification(site({ status: "hosting" }), sub);
    expect(out?.to).toEqual(["ops@reddoorla.com"]);
  });

  it("routes a maintenance site to its POC", () => {
    const out = buildPocNotification(
      site({ status: "maintenance", pointOfContact: "client@site.com" }),
      sub,
    );
    expect(out?.to).toEqual(["client@site.com"]);
  });

  it("skips (null) a maintenance site with no POC", () => {
    const out = buildPocNotification(site({ status: "maintenance" }), sub);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/forms/notify.test.ts`.

- [ ] **Step 3: Implement.** In `src/forms/notify.ts`, add the operator constant + helpers near the top (after `FALLBACK_REPLY_TO`), and replace `pocAddress` usage. Keep `pocAddress` (still the maintenance-path source).

Add:

```ts
/** Single-operator fleet fallback when OPERATOR_EMAIL is unset (pre-launch leads). */
const OPERATOR_FALLBACK = "tucker@reddoorla.com";

function operatorEmail(): string {
  return process.env.OPERATOR_EMAIL?.trim() || OPERATOR_FALLBACK;
}

/**
 * Where a submission notification goes. Pre-launch sites (anything not yet in
 * "maintenance") route to the operator, who is monitoring them; once a site is in
 * maintenance, leads go to its client POC (null → notify skips).
 */
function notifyRecipient(site: WebsiteRow): string | null {
  if (site.status !== "maintenance") return operatorEmail();
  return pocAddress(site);
}
```

In `buildPocNotification`, change `const to = pocAddress(site);` → `const to = notifyRecipient(site);`.
In `buildAutoresponder`, change `replyTo: pocAddress(site) ?? FALLBACK_REPLY_TO` → `replyTo: notifyRecipient(site) ?? FALLBACK_REPLY_TO`.

(Fix the typo: write `Single-operator fleet`.)

- [ ] **Step 4: Run → PASS** — `pnpm vitest run tests/forms/notify.test.ts` and the full `pnpm test` (no regressions in existing notify/submission tests; existing tests used maintenance sites with explicit POCs, which still resolve to the POC).

- [ ] **Step 5: Commit** — `git add src/forms/notify.ts tests/forms/notify.test.ts && git commit -m "feat(forms): route pre-launch (non-maintenance) submission notifications to the operator"`

---

### Task 3: Changeset + gate + PR

- [ ] **Step 1: Changeset** — create `.changeset/forms-redirect-and-status-notify.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Forms: `createIngestAction` gains an optional `redirectTo` (303-redirect on success/bot-screen, e.g. a dedicated `/thank-you` page). Submission notifications are now status-aware — sites not yet in `maintenance` (launch period, hosting, etc.) route leads to the operator (`OPERATOR_EMAIL` or `tucker@reddoorla.com`); sites in `maintenance` go to the client POC as before.
```

Commit: `git add .changeset/forms-redirect-and-status-notify.md && git commit -m "chore(forms): changeset for redirectTo + status-aware notify (minor → 0.36.0)"`

- [ ] **Step 2: Full gate** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:dist`. All PASS. Confirm `dist/forms/index.js` still has `from "@sveltejs/kit"` external.

- [ ] **Step 3: Push + PR** (do not self-merge yet — reviewer runs first):

```bash
git push -u origin feat/forms-redirect-status-notify
```

Then `gh pr create` titled `feat(forms): redirectTo + status-aware notify (0.36.0)` describing both changes, linking this plan, noting it releases 0.36.0 and PR4 (alamo) consumes ^0.36.0.

---

# PR4 — alamo-anatomy migration

> cwd `/Users/tuckerlemos/Documents/GitHub/alamo-anatomy`. **Do not start until `npm view @reddoorla/maintenance version` reports `0.36.0`.** Branch: `git checkout main && git pull --ff-only && git checkout -b feat/forms-dashboard-ingest`.

### Task 4: Adopt 0.36.0

- [ ] **Step 1:** In `package.json`, set `@reddoorla/maintenance` to `^0.36.0` (it is already a `dependencies` entry at `^0.26.0`). Run `pnpm install`. Commit `package.json` + `pnpm-lock.yaml` (`build: @reddoorla/maintenance ^0.36.0`).

### Task 5: Contact form migration

**Files:** `src/routes/[[preview=preview]]/contact/+page.server.ts`, `.../contact/+page.svelte`

- [ ] **Step 1: Server module.** Edit `contact/+page.server.ts` — keep the Prismic `load` (it must continue returning `page`/`title`/meta), but ADD `prerender=false`, plant `formTs`, and add the action. The existing `load` is an async function; add `formTs: Date.now()` to its returned object and add the new exports:

```ts
import { error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { createIngestAction } from "@reddoorla/maintenance/forms";
import { createClient } from "$lib/prismicio";
import type { Actions } from "./$types";

// Root layout sets prerender = "auto"; a form action can't run on a prerendered route.
export const prerender = false;

export async function load({ fetch, cookies }) {
  const client = createClient({ fetch, cookies });
  try {
    const page = await client.getSingle("contact");
    return {
      page,
      title: page.data.title,
      meta_description: page.data.meta_description,
      meta_title: page.data.meta_title,
      meta_image: page.data.meta_image?.url,
      formTs: Date.now(),
    };
  } catch {
    error(404, { message: "Page not found" });
  }
}

export const actions: Actions = {
  default: createIngestAction({
    formType: "contact",
    redirectTo: "/thank-you",
    getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
    buildPayload: (form, event) => {
      const first = form.get("first_name")?.toString() ?? "";
      const last = form.get("last_name")?.toString() ?? "";
      return {
        name: `${first} ${last}`.trim(),
        firstName: first || undefined,
        lastName: last || undefined,
        email: form.get("email")?.toString(),
        phone: form.get("phone")?.toString(),
        message: form.get("message")?.toString(),
        sourceUrl: event.url.href,
      };
    },
  }),
};
```

(Remove the old `export function entries()` — a non-prerendered route doesn't need it.)

- [ ] **Step 2: Page.** Edit `contact/+page.svelte`: the form currently has `name="contact" method="POST" action="/thank-you" data-netlify="true" netlify-honeypot="bot-field"` and a hidden `form-name`. Replace those form attributes with `method="POST" use:enhance`; remove the `form-name` hidden input; keep the existing `bot-field` honeypot `<p class="hidden">`; add a hidden `ts` input; add an inline error block (only shown on ingest failure since success redirects). Pull `data.formTs` and `form` from props and import `enhance`.

Top of `<script>`:

```ts
import { enhance } from "$app/forms";
let { data, form } = $props();
```

Add just inside the `<form …>` (before the honeypot), the error + timing token:

```svelte
        {#if form?.error}
          <p role="alert" class="rounded-sm bg-red-50 p-4 text-red-900">{form.error}</p>
        {/if}
        <input type="hidden" name="ts" value={data.formTs} />
```

Change the `<form …>` open tag to:

```svelte
      <form method="POST" use:enhance class="flex flex-col gap-5">
```

(Delete the `name="contact"`, `action="/thank-you"`, `data-netlify`, `netlify-honeypot` attributes and the `<input type="hidden" name="form-name" value="contact" />` line. Leave the `<p class="hidden"><label>Don't fill this out: <input name="bot-field" /></label></p>` honeypot as-is.)

- [ ] **Step 3: Commit** — `git add src/routes/'[[preview=preview]]'/contact/+page.server.ts src/routes/'[[preview=preview]]'/contact/+page.svelte && git commit -m "feat(contact): forward to dashboard ingest, redirect to /thank-you"`

### Task 6: Reserve form migration

**Files:** `src/routes/[[preview=preview]]/reserve/+page.server.ts`, `.../reserve/+page.svelte`

- [ ] **Step 1: Server module.** Same shape as contact, but `formType:"reserve"` and a 26-field `buildPayload`. The catering checkboxes share `name="catering"` (multiple values) → use `form.getAll`. Map the contact-ish fields to typed columns; everything else rides into `Extra fields`.

```ts
import { error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { createIngestAction } from "@reddoorla/maintenance/forms";
import { createClient } from "$lib/prismicio";
import type { Actions } from "./$types";

export const prerender = false;

export async function load({ fetch, cookies }) {
  const client = createClient({ fetch, cookies });
  try {
    const page = await client.getSingle("reserve");
    return {
      page,
      title: page.data.title,
      meta_description: page.data.meta_description,
      meta_title: page.data.meta_title,
      meta_image: page.data.meta_image?.url,
      formTs: Date.now(),
    };
  } catch {
    error(404, { message: "Page not found" });
  }
}

const str = (form: FormData, key: string) => form.get(key)?.toString();

export const actions: Actions = {
  default: createIngestAction({
    formType: "reserve",
    redirectTo: "/thank-you",
    getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
    buildPayload: (form, event) => ({
      // typed columns
      name: str(form, "main_contact_name"),
      email: str(form, "requestor_email"),
      phone: str(form, "requestor_phone"),
      message: str(form, "event_description"),
      sourceUrl: event.url.href,
      // everything else → Extra fields (multi-value catering joined)
      preferred_start_date: str(form, "preferred_start_date"),
      preferred_end_date: str(form, "preferred_end_date"),
      number_of_stations: str(form, "number_of_stations"),
      time_slots: str(form, "time_slots"),
      estimated_attendees: str(form, "estimated_attendees"),
      c_arm_needed: str(form, "c_arm_needed"),
      drills_needed: str(form, "drills_needed"),
      arthroscope_needed: str(form, "arthroscope_needed"),
      tissue_type: str(form, "tissue_type"),
      procedure_description: str(form, "procedure_description"),
      catering: form.getAll("catering").map(String).join(", ") || undefined,
      additional_catering_info: str(form, "additional_catering_info"),
      diet_accommodations: str(form, "diet_accommodations"),
      requestor_company: str(form, "requestor_company"),
      day_of_contact: str(form, "day_of_contact"),
      ap_contact_name: str(form, "ap_contact_name"),
      ap_contact_phone: str(form, "ap_contact_phone"),
      ap_contact_email: str(form, "ap_contact_email"),
      billing_street: str(form, "billing_street"),
      billing_city: str(form, "billing_city"),
      billing_state: str(form, "billing_state"),
      billing_zip: str(form, "billing_zip"),
    }),
  }),
};
```

(Remove the old `entries()`.)

- [ ] **Step 2: Page.** Edit `reserve/+page.svelte` exactly like the contact page's mechanism swap: change the `<form>` open tag to `method="POST" use:enhance` (dropping `name="reserve"`, `action="/thank-you"`, `data-netlify`, `netlify-honeypot`); delete the `<input type="hidden" name="form-name" value="reserve" />`; keep the `bot-field` honeypot; add `{#if form?.error}…{/if}` + `<input type="hidden" name="ts" value={data.formTs} />` just inside the form. Add `import { enhance } from "$app/forms";` and pull `form` from props (the script already has `let { data } = $props()` — extend to `let { data, form } = $props()`). **Leave all 4 fieldsets, the `use:datepicker` inputs, and the catering checkboxes untouched.**

- [ ] **Step 3: Commit** — `git add src/routes/'[[preview=preview]]'/reserve/+page.server.ts src/routes/'[[preview=preview]]'/reserve/+page.svelte && git commit -m "feat(reserve): forward to dashboard ingest, redirect to /thank-you"`

### Task 7: Gate + PR

- [ ] **Step 1: Gate** — `pnpm lint` (run `pnpm format` first if prettier flags the edited files), `pnpm check`, `pnpm build` (confirm BOTH `/contact` and `/reserve` build as server entries, not prerendered — look under `.svelte-kit/output/server/entries/pages/.../contact` and `.../reserve`; there must be NO `Cannot prerender pages with actions` error), and `pnpm test:a11y` if the repo has it (else skip).

- [ ] **Step 2: Push + PR** titled `feat(forms): route contact + reserve to the dashboard ingest`, body describing the mechanism swap, the `/thank-you` redirect via `redirectTo`, prerender opt-out, and the operator note (env vars below). Do not self-merge until reviewed + CI green.

---

### Task 8: Operator wiring (manual — surface to the user)

Not code. After PR4 merges + alamo redeploys, alamo's Netlify site needs:

- `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/alamo-anatomy`
- `FORMS_INGEST_TOKEN=<the shared forms-ingest token>` (same value as the dashboard's)

Env only applies on a new deploy. (The dashboard already has the status-aware notify after PR3's reddoor-maintenance redeploy.)

### Task 9: Airtable + live verification (controller)

- [ ] Set the alamo Websites record `url` (deployed URL, once known) via the Airtable MCP (`recc4GlKJDnatGdDi`). Leave `point of contact` unset (status rule covers launch period).
- [ ] After the operator sets env + redeploys: submit the live contact form and the reserve form once each; confirm a Submissions row lands for each (Site link = Alamo Anatomy, formType contact/reserve, reserve's extra fields in `Extra fields`, `sourceUrl` set), `Notify status` = `sent` to `tucker@reddoorla.com` (launch-period rule), and the browser landed on `/thank-you`. Delete the test rows.

---

## Self-Review

**Spec/decision coverage:** redirectTo (Task 1) ✓; status-aware notify w/ tucker fallback (Task 2) ✓; 0.36.0 release (Task 3) ✓; contact migration + /thank-you + prerender=false + sourceUrl.href (Task 5) ✓; reserve 26-field map incl. multi-value catering (Task 6) ✓; Airtable url set + POC left unset (Task 9) ✓; operator env wiring surfaced (Task 8) ✓.

**Placeholder scan:** `<the shared forms-ingest token>` / `<deployed URL>` are intentional operator placeholders in non-code tasks. All code steps show complete code. No TBD/"handle edge cases".

**Type consistency:** `createIngestAction`, `CreateIngestActionOptions.redirectTo`, `getConfig`, `buildPayload`, `formType`, `FORMS_INGEST_URL`/`FORMS_INGEST_TOKEN` consistent across PR3 and PR4. `notifyRecipient`/`operatorEmail`/`OPERATOR_FALLBACK` defined once (Task 2) and used in both `buildPocNotification` and `buildAutoresponder`. Reserve `buildPayload` keys match the form `name=` attributes confirmed in recon. `succeed()` returns `{ success: true }`, matching `IngestActionData`.
