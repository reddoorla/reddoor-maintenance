# Fleet Forms Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared `@reddoorla/maintenance/forms` subpath that fleet SvelteKit sites import to forward contact-form submissions to the live dashboard ingest endpoint, and migrate reddoor-website (the broken site) onto it end-to-end.

**Architecture:** A new browser/server-safe subpath (`submitToIngest` + `screenSubmission` + types) is added to the package; the existing dashboard-only modules stay un-exported. reddoor-website gets a thin same-origin SvelteKit form action that screens (honeypot/timing) then forwards to `POST /api/forms/reddoor` with the shared token. The dashboard endpoint (Phase 1, already live) does all real work.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), tsup, Vitest, changesets; SvelteKit (Svelte 5 runes, `use:enhance`, `$env/dynamic/private`, adapter-netlify) for reddoor-website.

**Spec:** [docs/superpowers/specs/2026-06-14-fleet-forms-phase2a-design.md](../specs/2026-06-14-fleet-forms-phase2a-design.md).

**Two parts with a release gate:**

- **Part A (Tasks 1–4)** — the package subpath, in `reddoor-maintenance`. Fully testable; ends in a merged PR + a changeset.
- **RELEASE GATE** — Tucker publishes the package to npm (releases are human-gated). Part B cannot deploy until the new version is on npm.
- **Part B (Tasks 5–6)** — reddoor-website migration, in the `reddoor-website` repo.

---

## File Structure

**Part A — `reddoor-maintenance`:**

- Create: `src/forms/types.ts` — the form-type enum, as a leaf (no Airtable coupling).
- Create: `src/forms/client.ts` — `submitToIngest` + `screenSubmission` + `SubmissionPayload`.
- Create: `src/forms/index.ts` — the subpath barrel (site-facing API only).
- Modify: `src/reports/airtable/submissions.ts` — import + re-export the enum from `types.ts`.
- Modify: `src/forms/payload.ts` — import the enum from `./types.js`.
- Modify: `tsup.config.ts` — add the `src/forms/index.ts` entry.
- Modify: `package.json` — add the `./forms` export.
- Create: `.changeset/forms-subpath.md` — minor bump.
- Create: `tests/forms/client.test.ts`, `tests/forms/types.test.ts`.

**Part B — `reddoor-website`:**

- Modify: `package.json` — move `@reddoorla/maintenance` to `dependencies`, bump to `^0.34.0`.
- Create/replace: `src/routes/[[preview=preview]]/contact/+page.server.ts` — `load` (+`formTs`) + `actions.default`.
- Modify: `src/routes/[[preview=preview]]/contact/+page.svelte` — real form action + `use:enhance`, drop Netlify Forms.

---

## Task 1: Leaf form-type module + decouple from Airtable

**Files:**

- Create: `src/forms/types.ts`
- Modify: `src/reports/airtable/submissions.ts`
- Modify: `src/forms/payload.ts`
- Test: `tests/forms/types.test.ts`

- [ ] **Step 1: Create `src/forms/types.ts`**

```typescript
/**
 * Form-type enum, kept in a leaf module (no Airtable/Resend imports) so it can
 * be shared with fleet sites via the `@reddoorla/maintenance/forms` subpath
 * without dragging server SDKs into a site bundle.
 */
export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];
```

- [ ] **Step 2: Update `src/reports/airtable/submissions.ts` to source the enum from the leaf**

Replace the existing local declaration:

```typescript
export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];
```

with an import + re-export (keeps every existing `... from "./submissions.js"` consumer working):

```typescript
import { SUBMISSION_FORM_TYPES, type FormType } from "../../forms/types.js";

export { SUBMISSION_FORM_TYPES };
export type { FormType };
```

Place the `import` with the other top-of-file imports and the `export`/`export type` lines where the declaration used to be (so `toFormType` below still sees `SUBMISSION_FORM_TYPES` in scope).

- [ ] **Step 3: Update `src/forms/payload.ts` import**

Change:

```typescript
import { SUBMISSION_FORM_TYPES, type FormType } from "../reports/airtable/submissions.js";
```

to:

```typescript
import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
```

- [ ] **Step 4: Write the test** — `tests/forms/types.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { SUBMISSION_FORM_TYPES } from "../../src/forms/types.js";
import { SUBMISSION_FORM_TYPES as fromSubmissions } from "../../src/reports/airtable/submissions.js";

describe("form types leaf", () => {
  it("exposes the canonical form-type tuple", () => {
    expect([...SUBMISSION_FORM_TYPES]).toEqual([
      "contact",
      "inquiry",
      "newsletter",
      "rsvp",
      "reserve",
    ]);
  });

  it("is re-exported unchanged from the submissions module (back-compat)", () => {
    expect(fromSubmissions).toBe(SUBMISSION_FORM_TYPES);
  });
});
```

- [ ] **Step 5: Run the test + full suite + typecheck**

Run: `pnpm vitest run tests/forms/types.test.ts && pnpm typecheck && pnpm test`
Expected: PASS. Typecheck confirms `fleet-cockpit.ts`, `payload.ts`, and `submissions.ts` consumers still resolve `FormType`/`SUBMISSION_FORM_TYPES`.

- [ ] **Step 6: Commit**

```bash
git add src/forms/types.ts src/reports/airtable/submissions.ts src/forms/payload.ts tests/forms/types.test.ts
git commit -m "refactor(forms): extract form-type enum to a leaf module (site-safe)"
```

---

## Task 2: Site-facing client — `submitToIngest` + `screenSubmission`

**Files:**

- Create: `src/forms/client.ts`
- Test: `tests/forms/client.test.ts`

- [ ] **Step 1: Create `src/forms/client.ts`**

```typescript
import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";

/**
 * The JSON a fleet site forwards to the dashboard ingest endpoint. Typed fields
 * are optional; the index signature lets a site include its own extra fields
 * (e.g. `company`) which the dashboard normalizer captures into `extraFields`.
 */
export type SubmissionPayload = {
  formType?: FormType | string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  message?: string;
  sourceUrl?: string;
  utm?: string;
  [key: string]: unknown;
};

export type IngestClientResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

export type SubmitToIngestOptions = {
  /** Full ingest endpoint incl. the site slug, e.g. https://…/api/forms/reddoor */
  url: string;
  /** The shared FORMS_INGEST_TOKEN. */
  token: string;
  payload: SubmissionPayload;
  /** Injectable fetch (pass SvelteKit's `event.fetch`); defaults to global fetch. */
  fetch?: typeof fetch;
};

/**
 * Forward a submission to the dashboard ingest endpoint. Never throws — a network
 * failure or a non-2xx response is returned as `{ ok: false }` so the caller can
 * show a friendly error rather than a 500.
 */
export async function submitToIngest(opts: SubmitToIngestOptions): Promise<IngestClientResult> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forms-token": opts.token },
      body: JSON.stringify(opts.payload),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `network error: ${String(err)}` };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response — fall through to the error path
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (res.ok && obj && obj.ok === true) {
    return { ok: true, id: String(obj.id ?? "") };
  }
  const error = obj && typeof obj.error === "string" ? obj.error : `ingest failed (${res.status})`;
  return { ok: false, status: res.status, error };
}

export type ScreenInput = { botField?: string | null; elapsedMs?: number | null };
export type ScreenResult = { ok: true } | { ok: false; reason: "honeypot" | "too-fast" };

/** Minimum plausible fill time; faster than this reads as a bot. */
export const MIN_FILL_MS = 2000;

/**
 * Cheap bot screen for the site action. A filled honeypot is a bot; a submission
 * faster than MIN_FILL_MS is a bot. Missing timing data (null) is NOT a rejection
 * — a prerendered/cached page can't plant a fresh timestamp, and the honeypot
 * remains the primary signal.
 */
export function screenSubmission(input: ScreenInput): ScreenResult {
  if (typeof input.botField === "string" && input.botField.trim().length > 0) {
    return { ok: false, reason: "honeypot" };
  }
  if (
    typeof input.elapsedMs === "number" &&
    input.elapsedMs >= 0 &&
    input.elapsedMs < MIN_FILL_MS
  ) {
    return { ok: false, reason: "too-fast" };
  }
  return { ok: true };
}

export { SUBMISSION_FORM_TYPES, type FormType };
```

- [ ] **Step 2: Write the test** — `tests/forms/client.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { submitToIngest, screenSubmission, MIN_FILL_MS } from "../../src/forms/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitToIngest", () => {
  it("returns ok + id and sends the token header + JSON body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { formType: "contact", email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out).toEqual({ ok: true, id: "recX" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/reddoor");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({ formType: "contact", email: "a@b.co" });
  });

  it("returns an error result for a non-2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { ok: false, error: "unauthorized" }));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "bad",
      payload: { email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("returns a status-0 error when fetch throws (network failure)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(0);
  });
});

describe("screenSubmission", () => {
  it("passes a clean submission", () => {
    expect(screenSubmission({ botField: "", elapsedMs: MIN_FILL_MS + 1 })).toEqual({ ok: true });
    expect(screenSubmission({})).toEqual({ ok: true });
    expect(screenSubmission({ elapsedMs: null })).toEqual({ ok: true });
  });

  it("rejects a filled honeypot", () => {
    expect(screenSubmission({ botField: "i am a bot" })).toEqual({ ok: false, reason: "honeypot" });
  });

  it("rejects a too-fast fill", () => {
    expect(screenSubmission({ elapsedMs: 500 })).toEqual({ ok: false, reason: "too-fast" });
  });
});
```

- [ ] **Step 3: Run the test + typecheck**

Run: `pnpm vitest run tests/forms/client.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/forms/client.ts tests/forms/client.test.ts
git commit -m "feat(forms): site-facing submitToIngest + screenSubmission client"
```

---

## Task 3: Subpath barrel + build wiring + changeset

**Files:**

- Create: `src/forms/index.ts`
- Modify: `tsup.config.ts`
- Modify: `package.json`
- Create: `.changeset/forms-subpath.md`

- [ ] **Step 1: Create `src/forms/index.ts`**

```typescript
/**
 * Public `@reddoorla/maintenance/forms` subpath — the site-facing API for
 * forwarding contact-form submissions to the dashboard ingest endpoint. Exports
 * ONLY browser/server-safe code; the dashboard-only modules (ingest/notify/token,
 * the Airtable submissions module) are intentionally not re-exported here.
 */
export {
  submitToIngest,
  screenSubmission,
  MIN_FILL_MS,
  type SubmissionPayload,
  type IngestClientResult,
  type SubmitToIngestOptions,
  type ScreenInput,
  type ScreenResult,
} from "./client.js";
export { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
```

- [ ] **Step 2: Add the tsup entry** — `tsup.config.ts`

In the `entry` array, add `"src/forms/index.ts"` (e.g. after `"src/index.ts"`):

```typescript
  entry: [
    "src/index.ts",
    "src/forms/index.ts",
    "src/cli/bin.ts",
    "src/cli/commands/audit.ts",
    "src/configs/lighthouse.ts",
    "src/configs/eslint.ts",
    "src/configs/prettier.ts",
    "src/configs/playwright-a11y.ts",
    "src/configs/svelte.ts",
    "src/util/git.ts",
    "src/util/pkg.ts",
    "src/recipes/sync-configs.ts",
  ],
```

(Match the existing array exactly; only the `"src/forms/index.ts"` line is new.)

- [ ] **Step 3: Add the export map entry** — `package.json`

In `exports`, after the `"."` entry, add:

```json
    "./forms": {
      "types": "./dist/forms/index.d.ts",
      "import": "./dist/forms/index.js"
    },
```

- [ ] **Step 4: Add the changeset** — `.changeset/forms-subpath.md`

```markdown
---
"@reddoorla/maintenance": minor
---

Add the `@reddoorla/maintenance/forms` subpath: `submitToIngest` + `screenSubmission` (and `SubmissionPayload`/`FormType`) for fleet SvelteKit sites to forward contact-form submissions to the dashboard ingest endpoint.
```

- [ ] **Step 5: Build and verify the subpath emits + resolves**

Run: `pnpm build && node -e "import('@reddoorla/maintenance/forms').then(m => console.log(Object.keys(m).sort().join(',')))"`

Expected: build succeeds; the import prints (order may vary):
`FormType` is a type (absent at runtime) — the runtime keys should include `MIN_FILL_MS,SUBMISSION_FORM_TYPES,screenSubmission,submitToIngest`.

If the import can't resolve `@reddoorla/maintenance/forms`, confirm `dist/forms/index.js` exists and the `package.json` `exports."./forms"` paths match.

- [ ] **Step 6: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:dist`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/forms/index.ts tsup.config.ts package.json .changeset/forms-subpath.md
git commit -m "feat(forms): expose @reddoorla/maintenance/forms subpath + changeset"
```

---

## Task 4: Part A gate + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Full pre-merge gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green (`test:dist` confirms the handlers + the new subpath resolve).

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/forms-phase2a
gh pr create --base main --title "feat(forms): @reddoorla/maintenance/forms subpath (Phase 2a Part A)" --body "Adds the site-facing forms subpath (submitToIngest + screenSubmission) + leaf form-type module. Phase 2a Part A; Part B (reddoor-website migration) follows after the npm release. Changeset included."
```

- [ ] **Step 3:** After CI is green, merge (per merge-authority policy, non-release feat auto-merges once review-clean). Note: the changeset means a `version-packages` release PR will appear — that release is the human gate below.

---

## RELEASE GATE (human)

**Tucker:** merge the `version-packages` release PR (changesets) to publish `@reddoorla/maintenance@0.34.0` to npm. Part B below cannot deploy until this version is on npm. Confirm with `npm view @reddoorla/maintenance version` → `0.34.0`.

---

## Task 5: reddoor-website migration

**Repo:** `/Users/tuckerlemos/Documents/GitHub/reddoor-website` (work on a branch `feat/forms-ingest`).
**Files:**

- Modify: `package.json`
- Create/replace: `src/routes/[[preview=preview]]/contact/+page.server.ts`
- Modify: `src/routes/[[preview=preview]]/contact/+page.svelte`

- [ ] **Step 1: Bump + move the dependency** — `reddoor-website/package.json`

Remove `"@reddoorla/maintenance": "^0.28.0"` from `devDependencies` and add it to `dependencies` at the released version:

```json
  "dependencies": {
    "@reddoorla/maintenance": "^0.34.0",
    …existing deps…
  }
```

Run `pnpm install` to update the lockfile.

- [ ] **Step 2: Replace `contact/+page.server.ts`**

Read the current file first to preserve the exact `load` return shape (titles/meta/metaImage). Then write:

```typescript
import { fail } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { submitToIngest, screenSubmission } from "@reddoorla/maintenance/forms";
import metaImage from "$lib/assets/icons/logos/printedReddoor.png";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  return {
    title: "Contact | Reddoor Creative",
    meta_description: "We design beautiful marketing materials that help you thrive. Talk to us.",
    meta_title: "Contact | Reddoor Creative",
    meta_image: metaImage,
    // Planted per-request for the bot timing check (see screenSubmission).
    formTs: Date.now(),
  };
};

function elapsedMs(tsRaw: FormDataEntryValue | null): number | null {
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Date.now() - ts;
}

export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();

    // Bot screen: a filled honeypot or an implausibly fast fill is silently
    // accepted (no forward) so bots get no signal.
    const screen = screenSubmission({
      botField: form.get("bot-field")?.toString() ?? null,
      elapsedMs: elapsedMs(form.get("ts")),
    });
    if (!screen.ok) return { success: true };

    if (!env.FORMS_INGEST_URL || !env.FORMS_INGEST_TOKEN) {
      console.error("[contact] FORMS_INGEST_URL / FORMS_INGEST_TOKEN not set");
      return fail(500, {
        error: "The contact form is temporarily unavailable. Please email info@reddoorla.com.",
      });
    }

    const result = await submitToIngest({
      url: env.FORMS_INGEST_URL,
      token: env.FORMS_INGEST_TOKEN,
      fetch,
      payload: {
        formType: "contact",
        name: form.get("name")?.toString(),
        email: form.get("email")?.toString(),
        phone: form.get("phone")?.toString(),
        message: form.get("message")?.toString(),
        company: form.get("company")?.toString(),
        sourceUrl: "https://www.reddoorla.com/contact",
      },
    });

    if (!result.ok) {
      console.error(`[contact] ingest failed (${result.status}): ${result.error}`);
      return fail(502, {
        error:
          "Something went wrong sending your message. Please try again or email info@reddoorla.com.",
      });
    }
    return { success: true };
  },
};
```

(If reading the current `load` reveals different meta strings or a different metaImage import, keep those exact values — only add `formTs`.)

- [ ] **Step 3: Rewrite the form in `contact/+page.svelte`**

Read the current file. Apply these precise changes, **keeping all existing Tailwind classes and field layout**:

1. Replace the `<script>` submission logic. Remove the `handleSubmit`/`fetch("/contact")` block and the `myForm`/`submitting`/`submitted`/`submitError` state. Add Svelte 5 runes + `enhance` + the action result prop:

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let submitting = $state(false);
</script>
```

2. Change the `<form>` opening tag — drop `onsubmit`, `data-netlify`, `data-netlify-honeypot`; add the action enhancement:

```svelte
<form
  class="…keep the existing classes…"
  method="POST"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      await update({ reset: true });
      submitting = false;
    };
  }}
>
```

3. Remove the Netlify hidden input `<input type="hidden" name="form-name" value="contact" />`. Add two hidden fields (keep the honeypot accessible-hidden as it was):

```svelte
  <input type="hidden" name="ts" value={data.formTs} />
  <!-- honeypot: keep the existing visually-hidden bot-field input -->
  <p hidden aria-hidden="true">
    <label>Don't fill this out: <input name="bot-field" tabindex="-1" autocomplete="off" /></label>
  </p>
```

4. Keep the existing `name`, `company`, `phone`, `email`, `message` inputs unchanged (same `name` attributes). Ensure the submit button is `type="submit"` (no JS click handler).

5. Replace the old success/error UI with the action-result driven version (place near the form, matching the existing styling approach):

```svelte
{#if form?.success}
  <p class="…existing success styling…">Thanks — your message is on its way. We'll be in touch shortly.</p>
{:else if form?.error}
  <p class="…existing error styling…" role="alert">{form.error}</p>
{/if}
```

- [ ] **Step 4: Verify the site builds + type-checks**

Run (in reddoor-website): `pnpm install && pnpm check && pnpm build`
Expected: `svelte-check` clean, build succeeds. (`pnpm check` is the svelte-check script; if the script name differs, use the repo's check script.)

- [ ] **Step 5: Commit + PR**

```bash
git add package.json pnpm-lock.yaml src/routes/[[preview=preview]]/contact/+page.server.ts src/routes/[[preview=preview]]/contact/+page.svelte
git commit -m "feat(contact): forward submissions to the dashboard ingest endpoint"
git push -u origin feat/forms-ingest
gh pr create --base main --title "feat(contact): wire contact form to the central ingest pipeline" --body "Replaces the broken Netlify-Forms fetch with a same-origin SvelteKit action that screens (honeypot/timing) and forwards to the dashboard ingest endpoint via @reddoorla/maintenance/forms. Requires FORMS_INGEST_URL + FORMS_INGEST_TOKEN Netlify env vars."
```

---

## Task 6: Deploy + live verification

**Files:** none (ops + verification).

- [ ] **Step 1: Set Netlify env (operator)** on the reddoor-website site:
  - `FORMS_INGEST_TOKEN` = the same value as the dashboard.
  - `FORMS_INGEST_URL` = `https://reddoor-maintenance.netlify.app/api/forms/reddoor`
  - Trigger a deploy (env vars apply on a new deploy).

- [ ] **Step 2: Live end-to-end check.** After deploy, submit the real contact form at the deployed URL with a test email you control (e.g. your own). Confirm:
  - the page shows the success message;
  - a row appears in the Airtable `Submissions` table linked to the Reddoor site (`Status=new`);
  - it shows in the dashboard cockpit 📥 strip and on `/s/reddoor`;
  - the autoresponder email arrives.
    Then archive/delete the test submission row.

- [ ] **Step 3: Negative check.** Confirm a submission with the honeypot filled (or submitted in <2s) does not create a row (screened), and that the form still renders/works with JS disabled (plain POST).

---

## Self-Review

**1. Spec coverage:**

| Spec section                                                | Task                              |
| ----------------------------------------------------------- | --------------------------------- |
| `src/forms/types.ts` leaf + decouple                        | Task 1                            |
| `submitToIngest` / `screenSubmission` / `SubmissionPayload` | Task 2                            |
| `src/forms/index.ts` barrel (site-facing only)              | Task 3                            |
| tsup entry + `./forms` export + changeset                   | Task 3                            |
| reddoor-website action + form rewrite + dep bump            | Task 5                            |
| Env (`FORMS_INGEST_URL` + `FORMS_INGEST_TOKEN`)             | Task 5 (code) + Task 6 (operator) |
| Error handling (honeypot silent / 500 env / 502 ingest)     | Task 5 (`+page.server.ts`)        |
| Testing (screen + submit unit; site live-verify)            | Tasks 2, 6                        |
| Rollout incl. release gate                                  | Task 4 → RELEASE GATE → Task 5    |

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The reddoor-website `+page.svelte` edits reference "keep existing classes" by necessity (design-preserving migration of a file whose full current markup lives in another repo) — the structural changes (attributes to drop/add, hidden fields, result rendering, script) are all given as exact code; the implementer reads the current file to preserve styling. ✓

**3. Type consistency:** `SUBMISSION_FORM_TYPES`/`FormType` defined in Task 1 (`types.ts`), imported by Task 2 (`client.ts`) and re-exported by Task 3 (`index.ts`). `submitToIngest`/`screenSubmission`/`SubmissionPayload`/`IngestClientResult` defined in Task 2 are consumed unchanged in Task 5's `+page.server.ts`. `MIN_FILL_MS` defined in Task 2, exported in Task 3. ✓
