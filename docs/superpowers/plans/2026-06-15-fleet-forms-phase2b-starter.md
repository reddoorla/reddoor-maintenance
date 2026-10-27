# Fleet Forms Phase 2b — Starter Recipe + `createIngestAction` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `createIngestAction` factory to `@reddoorla/maintenance/forms` (released as 0.35.0), then bake a canonical, dashboard-wired contact route into reddoor-starter so freshly-cloned sites inherit a working form.

**Architecture:** Two repos, two PRs, sequenced. PR1 (reddoor-maintenance) adds the factory + tests + a changeset; after it merges and the changesets release publishes **0.35.0**, PR2 (reddoor-starter) adds a `src/routes/contact/` route built on the factory + the starter's `Field` components.

**Tech Stack:** TypeScript (ESM/NodeNext, strict), tsup, vitest, changesets, SvelteKit (Svelte 5 runes, adapter-netlify), pnpm.

**Spec:** [docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-starter-design.md](../specs/2026-06-15-fleet-forms-phase2b-starter-design.md)

**Refinement vs spec:** the spec says the route uses the starter's `Form`/`Field` components. During planning we confirmed `use:enhance` is a Svelte action and actions attach to DOM elements, **not** components — so `<Form use:enhance>` is invalid. The recipe therefore uses a native `<form method="POST" use:enhance>` with the starter's accessible `Field` components inside. The `Form` wrapper's only extra feature (a multi-error summary) is unused here anyway (the factory returns a single `error` string). This matches reddoor-website's 2a contact form.

**Key facts established during planning (do not re-derive):**

- `@reddoorla/maintenance` currently published at **0.34.0**; local `package.json` may read `0.33.0` if main isn't pulled — sync first.
- `src/forms/client.ts` exports `submitToIngest`, `screenSubmission`, `MIN_FILL_MS`, `SubmissionPayload`. `src/forms/index.ts` is the public `/forms` barrel. `tsup.config.ts` already lists `"src/forms/index.ts"` as an entry.
- **No file in `src/`, `netlify/`, or `scripts/` imports the `/forms` barrel** — the dashboard imports `src/forms/{ingest,notify,payload,token,types}` directly. So a barrel that pulls in `@sveltejs/kit` never loads in the Node/dashboard runtime. `scripts/smoke-dist.mjs` imports only `dist/index.js`, never `dist/forms/index.js`.
- tsup externalizes everything in `dependencies` + `peerDependencies` by default, so adding `@sveltejs/kit` as a peer dep leaves `import { fail } from "@sveltejs/kit"` external in `dist/forms/index.js`.
- The starter (`reddoor-starter`) uses Svelte 5, TS routes, pnpm, root layout `prerender = "auto"` (`src/routes/+layout.server.ts`), `$lib` + `$components` aliases, Tailwind v4, and a `form-action 'self'` CSP. `src/lib/components/Field.svelte` props: `name`, `label`, `type` (`text|email|tel|url|password|number|search|textarea`), `value` (`$bindable`), `description`, `error`, `required`, `autocomplete`, `placeholder`, `rows`, etc. The a11y gate visits `/dev/a11y-fixtures` only (it does not crawl `/contact`).

---

## File Structure

**PR1 — reddoor-maintenance** (cwd: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`)

- Create: `src/forms/action.ts` — the `createIngestAction` factory (only `/forms` module touching SvelteKit).
- Create: `tests/forms/action.test.ts` — unit tests for the factory.
- Modify: `src/forms/index.ts` — re-export the factory + its types.
- Modify: `package.json` — add `@sveltejs/kit` to `peerDependencies` (optional) + `devDependencies`.
- Create: `.changeset/forms-ingest-action.md` — minor bump.

**PR2 — reddoor-starter** (cwd: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter`)

- Create: `src/routes/contact/+page.server.ts` — `prerender=false`, `load` planting `formTs`, `default` action via the factory.
- Create: `src/routes/contact/+page.svelte` — native `<form use:enhance>` + `Field` components + honeypot/`ts` + success/error.
- Modify: `package.json` — move `@reddoorla/maintenance` to `dependencies` at `^0.35.0`.
- Modify: `.env.example` — add `FORMS_INGEST_URL` + `FORMS_INGEST_TOKEN`.
- Modify: `docs/rfp-handbook.md` — replace the Netlify-Forms recommendation with this recipe.

---

# PR1 — `createIngestAction` factory (reddoor-maintenance)

> All PR1 tasks run in `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`.

### Task 1: Branch + add SvelteKit as an optional peer/dev dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Sync main and create the feature branch**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git checkout main && git pull --ff-only
git checkout -b feat/forms-ingest-action
```

- [ ] **Step 2: Add `@sveltejs/kit` to `peerDependencies` (optional) and `devDependencies`**

In `package.json`, add a `peerDependencies` block and a `peerDependenciesMeta` block (place them adjacent to `dependencies`), and add the dev dep. The peer dep makes kit external in the tsup build; optional means consumers without SvelteKit (none today, but defensive) get no install error; the dev dep lets the package's own vitest + `tsc` resolve `@sveltejs/kit`.

Add these top-level keys:

```json
  "peerDependencies": {
    "@sveltejs/kit": "^2.0.0"
  },
  "peerDependenciesMeta": {
    "@sveltejs/kit": {
      "optional": true
    }
  },
```

And add to `devDependencies` (keep alphabetical with the existing entries; it sorts right after `@netlify/functions`):

```json
    "@sveltejs/kit": "^2.61.1",
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: completes; `@sveltejs/kit` resolves into `node_modules`. (A peer-dep warning about `vite`/`svelte` as kit's own peers is acceptable — they are not needed to import `fail`/types in tests.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(forms): add @sveltejs/kit as optional peer + dev dep for the ingest action factory"
```

---

### Task 2: Implement `createIngestAction` (TDD)

**Files:**

- Test: `tests/forms/action.test.ts`
- Create: `src/forms/action.ts`
- Modify: `src/forms/index.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/forms/action.test.ts`. The factory only touches `event.request.formData()`, `event.fetch`, and `event.url`, so a minimal fake event cast to `RequestEvent` suffices. `fail(status, data)` returns an `ActionFailure` with `.status` and `.data`, so success vs failure is distinguished by the presence of a `status` field.

```ts
import { describe, it, expect, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { createIngestAction } from "../../src/forms/action.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build a fake RequestEvent the factory can consume. `entries` are the submitted
// form fields; `fetchImpl` is the injected fetch.
function fakeEvent(entries: Record<string, string>, fetchImpl: typeof fetch): RequestEvent {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    fetch: fetchImpl,
    url: new URL("https://site.test/contact"),
  } as unknown as RequestEvent;
}

const okConfig = () => ({ url: "https://dash/api/forms/acme", token: "tok" });
// A clock 10s ahead of the planted ts so the timing screen passes.
const now = () => 1_000_000 + 10_000;
const goodTs = String(1_000_000);

describe("createIngestAction", () => {
  it("forwards a clean submission and returns success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form, event) => ({
        name: form.get("name")?.toString(),
        email: form.get("email")?.toString(),
        sourceUrl: `${event.url.origin}${event.url.pathname}`,
      }),
      now,
    });
    const result = await action(fakeEvent({ name: "Ada", email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/acme");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({
      formType: "contact",
      name: "Ada",
      email: "a@b.co",
      sourceUrl: "https://site.test/contact",
    });
  });

  it("silently accepts a filled honeypot without forwarding", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now,
    });
    const result = await action(
      fakeEvent({ email: "a@b.co", ts: goodTs, "bot-field": "i am a bot" }, fetchMock),
    );
    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently accepts a too-fast fill without forwarding", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now: () => 1_000_500, // 500ms after the planted ts → under MIN_FILL_MS
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns fail(500) when env config is missing", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: () => ({}),
      buildPayload: () => ({}),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(500);
    expect((result as { data?: { error: string } }).data?.error).toMatch(/unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns fail(502) when the ingest endpoint rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { ok: false, error: "unauthorized" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(502);
  });

  it("does not treat a missing ts as too-fast (honeypot remains primary)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recY" }));
    const action = createIngestAction({
      formType: "newsletter",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co" }, fetchMock)); // no ts
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).formType).toBe("newsletter");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/forms/action.test.ts`
Expected: FAIL — `Cannot find module '../../src/forms/action.js'` (the file does not exist yet).

- [ ] **Step 3: Implement the factory**

Create `src/forms/action.ts`:

```ts
import { fail, type ActionFailure, type RequestEvent } from "@sveltejs/kit";
import { submitToIngest, screenSubmission, type SubmissionPayload } from "./client.js";

/** Endpoint + token for the dashboard ingest, read per-request from site env. */
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

/**
 * Build a SvelteKit `default` form action that screens for bots, forwards the
 * submission to the dashboard ingest endpoint, and returns SvelteKit-shaped
 * results. The per-form field mapping is the only thing a site must supply.
 */
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

    // Bot screen: a filled honeypot OR an implausibly fast fill is silently
    // accepted (return success, do NOT forward) so bots get no signal.
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

- [ ] **Step 4: Re-export from the barrel**

In `src/forms/index.ts`, append after the existing `client.js` re-export block:

```ts
export {
  createIngestAction,
  type CreateIngestActionOptions,
  type IngestActionConfig,
  type IngestActionData,
} from "./action.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/forms/action.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/forms/action.ts src/forms/index.ts tests/forms/action.test.ts
git commit -m "feat(forms): add createIngestAction factory to the /forms subpath"
```

---

### Task 3: Changeset for the 0.35.0 release

**Files:**

- Create: `.changeset/forms-ingest-action.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/forms-ingest-action.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Add `createIngestAction` to the `@reddoorla/maintenance/forms` subpath — a factory that builds a SvelteKit `default` form action (bot screen → forward to the dashboard ingest endpoint → SvelteKit-shaped results). Fleet sites now wire a contact form in ~12 lines by supplying only a per-form `buildPayload`. SvelteKit is added as an optional peer dependency (only this module imports it).
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/forms-ingest-action.md
git commit -m "chore(forms): changeset for createIngestAction (minor → 0.35.0)"
```

---

### Task 4: Full gate, push, open PR

- [ ] **Step 1: Run the complete pre-merge gate**

Run each and confirm green (this is the gate from memory: lint + typecheck + test + build + test:dist):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist
```

Expected:

- `pnpm lint` — no eslint/prettier errors.
- `pnpm typecheck` — `tsc --noEmit` and the `tsconfig.netlify.json` pass clean (action.ts resolves `@sveltejs/kit` types via the new dev dep).
- `pnpm test` — full suite passes including the new `tests/forms/action.test.ts`.
- `pnpm build` — tsup succeeds; inspect `dist/forms/index.js` and confirm it contains `from "@sveltejs/kit"` left as an **external** import (not inlined).
- `pnpm test:dist` — smoke gate passes (it imports only `dist/index.js`; unaffected).

- [ ] **Step 2: Verify the dashboard barrel-import invariant still holds**

Run: `grep -rn "forms/index\|@reddoorla/maintenance/forms" src netlify scripts | grep -v "src/forms/index.ts"`
Expected: no matches — confirming nothing in the Node/dashboard runtime loads the kit-importing barrel.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/forms-ingest-action
gh pr create --title "feat(forms): createIngestAction factory for fleet form actions" \
  --body "$(cat <<'EOF'
Phase 2b (starter sub-project), PR1 of 2. Adds `createIngestAction` to `@reddoorla/maintenance/forms` so fleet sites wire a dashboard-forwarding contact form in ~12 lines (supply only a per-form `buildPayload`). The factory screens bots (honeypot + timing), forwards via `submitToIngest`, and returns SvelteKit `fail(500/502)` / `{success:true}`.

SvelteKit is now an **optional peer dependency** — only `src/forms/action.ts` imports it (`fail`), tsup leaves it external, and nothing in the dashboard/Node runtime loads the `/forms` barrel.

Spec: docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-starter-design.md
Releases as 0.35.0. PR2 (reddoor-starter contact recipe) consumes ^0.35.0 after release.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After CI is green and review is clean, merge per the merge-authority policy**

Gate the merge on the PR HEAD SHA's `build` check = completed:success, then merge. The changesets "Version Packages" release PR (bump to 0.35.0 + publish) is **human-gated** — do not self-merge the release PR. Wait for 0.35.0 to appear on npm before starting PR2.

Run to confirm the publish landed: `npm view @reddoorla/maintenance version`
Expected: `0.35.0`.

---

# PR2 — Starter contact recipe (reddoor-starter)

> All PR2 tasks run in `/Users/tuckerlemos/Documents/GitHub/reddoor-starter`. **Do not start until `npm view @reddoorla/maintenance version` reports `0.35.0`.**

### Task 5: Branch + adopt 0.35.0 as a runtime dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Sync main and branch**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter
git checkout main && git pull --ff-only
git checkout -b feat/contact-form-recipe
```

- [ ] **Step 2: Move `@reddoorla/maintenance` to `dependencies` at `^0.35.0`**

In `package.json`, remove the `"@reddoorla/maintenance": "^0.28.0"` line from `devDependencies` and add it to the existing `dependencies` block:

```json
    "@reddoorla/maintenance": "^0.35.0",
```

(It is now imported by server-side route code at runtime, so it belongs in `dependencies`.)

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: resolves `@reddoorla/maintenance@0.35.0`; `@sveltejs/kit` (already a starter dep) satisfies the new optional peer.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: adopt @reddoorla/maintenance ^0.35.0 as a runtime dependency"
```

---

### Task 6: Contact route server action

**Files:**

- Create: `src/routes/contact/+page.server.ts`

- [ ] **Step 1: Create the server module**

Create `src/routes/contact/+page.server.ts`:

```ts
import { env } from "$env/dynamic/private";
import { createIngestAction } from "@reddoorla/maintenance/forms";
import type { Actions, PageServerLoad } from "./$types";

// The root layout sets `prerender = "auto"`; a form `action` cannot run on a
// prerendered route ("Cannot prerender pages with actions"). Opt out — this
// route is genuinely dynamic.
export const prerender = false;

// Plant a per-request timestamp for the bot timing screen.
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

- [ ] **Step 2: Sync types so `./$types` resolves**

Run: `pnpm exec svelte-kit sync`
Expected: completes; `.svelte-kit/types/.../contact/$types.d.ts` is generated (no output is fine).

- [ ] **Step 3: Commit**

```bash
git add src/routes/contact/+page.server.ts
git commit -m "feat(contact): server action forwarding to the dashboard ingest via createIngestAction"
```

---

### Task 7: Contact route page (form UI)

**Files:**

- Create: `src/routes/contact/+page.svelte`

- [ ] **Step 1: Create the page**

Create `src/routes/contact/+page.svelte`. Uses a native `<form method="POST" use:enhance>` (enhance must attach to a DOM element) with the starter's `Field` components, a hidden `ts` field, a `display:none` honeypot (`bot-field`), and success/error rendering.

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import Field from "$lib/components/Field.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let name = $state("");
  let email = $state("");
  let phone = $state("");
  let message = $state("");
  let submitting = $state(false);
</script>

<svelte:head>
  <title>Contact</title>
</svelte:head>

<main class="max-w-2xl mx-auto px-8 py-16 space-y-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-bold">Contact us</h1>
    <p class="text-secondary">Send us a message and we'll get back to you.</p>
  </header>

  {#if form?.success}
    <p role="status" class="border-2 border-green-600 bg-green-50 rounded p-4 text-green-900">
      Thanks — your message is on its way. We'll be in touch soon.
    </p>
  {:else}
    <form
      method="POST"
      class="space-y-4"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          await update();
          submitting = false;
        };
      }}
    >
      {#if form?.error}
        <p role="alert" class="border-2 border-red-600 bg-red-50 rounded p-4 text-red-900">
          {form.error}
        </p>
      {/if}

      <!-- Anti-bot: per-request timing token + a hidden honeypot. Naive bots
           fill the honeypot; a too-fast fill is caught by the timing screen. -->
      <input type="hidden" name="ts" value={data.formTs} />
      <input
        type="text"
        name="bot-field"
        tabindex="-1"
        autocomplete="off"
        aria-hidden="true"
        class="hidden"
      />

      <Field name="name" label="Name" autocomplete="name" required bind:value={name} />
      <Field
        name="email"
        label="Email"
        type="email"
        autocomplete="email"
        required
        bind:value={email}
      />
      <Field name="phone" label="Phone" type="tel" autocomplete="tel" bind:value={phone} />
      <Field name="message" label="Message" type="textarea" required bind:value={message} />

      <button
        type="submit"
        disabled={submitting}
        class="px-4 py-2 bg-primary text-white rounded bump disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send message"}
      </button>
    </form>
  {/if}
</main>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/contact/+page.svelte
git commit -m "feat(contact): accessible contact form page (Field components + enhance + honeypot)"
```

---

### Task 8: Env example + handbook docs

**Files:**

- Modify: `.env.example`
- Modify: `docs/rfp-handbook.md`

- [ ] **Step 1: Add the form env vars to `.env.example`**

Append to `.env.example` (create the file if it does not exist):

```bash
# Fleet forms: forward contact submissions to the central dashboard ingest
# endpoint. Set BOTH on the deployed site (plural names). The token is the SAME
# value as the dashboard's FORMS_INGEST_TOKEN; the URL ends in this site's slug
# (derived from the Airtable Websites `Name`, e.g. .../api/forms/acme).
FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/<slug>
FORMS_INGEST_TOKEN=replace-with-the-shared-forms-ingest-token
```

- [ ] **Step 2: Update the handbook**

Open `docs/rfp-handbook.md`, find the section recommending **Netlify Forms** for contact forms, and replace it with the dashboard-forms recipe. The replacement must state:

- New sites get a working contact form at `src/routes/contact/` out of the box.
- It posts to a SvelteKit action built with `createIngestAction` from `@reddoorla/maintenance/forms`, which forwards to the central dashboard ingest endpoint (submissions land in the operator dashboard + Airtable, with POC notification + autoresponder).
- Spam is handled by the built-in honeypot + 2s timing screen (no Netlify Forms, no CAPTCHA).
- Deploy requires setting `FORMS_INGEST_URL` (with the site slug) and `FORMS_INGEST_TOKEN` in Netlify env (plural names).
- The route sets `export const prerender = false` because the root layout prerenders by default and an action cannot run on a prerendered page.

(Read the current Netlify-Forms wording first and mirror the handbook's prose style; do not invent unrelated sections.)

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/rfp-handbook.md
git commit -m "docs: replace Netlify Forms recommendation with the dashboard-forms recipe"
```

---

### Task 9: Full gate, push, open PR

- [ ] **Step 1: Run the starter gate**

```bash
pnpm lint
pnpm check
pnpm build
pnpm test:a11y
```

Expected:

- `pnpm lint` — prettier + eslint clean (run `pnpm format` first if prettier flags the new files, then re-run).
- `pnpm check` — `svelte-check` passes; `form?.success`/`form?.error` and `data.formTs` are typed from the generated `./$types`.
- `pnpm build` — succeeds; the new `/contact` route is built as a server route (not prerendered).
- `pnpm test:a11y` — the existing Playwright + axe gate still passes (it visits `/dev/a11y-fixtures`; `/contact` is not crawled).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/contact-form-recipe
gh pr create --title "feat(contact): dashboard-wired contact form recipe (Phase 2b)" \
  --body "$(cat <<'EOF'
Phase 2b (starter sub-project), PR2 of 2. Bakes a canonical contact form into the clone skeleton: a self-contained `src/routes/contact/` route that forwards submissions to the central dashboard ingest endpoint via `createIngestAction` (from @reddoorla/maintenance ^0.35.0).

- `prerender = false` (root layout prerenders by default; actions can't run on prerendered routes).
- Native `<form use:enhance>` + the starter's accessible `Field` components.
- Honeypot + 2s timing screen for spam (no Netlify Forms, no CAPTCHA).
- `.env.example` documents `FORMS_INGEST_URL` + `FORMS_INGEST_TOKEN` (plural).
- `rfp-handbook.md` updated from Netlify Forms to this recipe.

Spec: reddoor-maintenance docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-starter-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After CI green + review clean, merge per the merge-authority policy**

Gate on the PR HEAD SHA's `ci / ci` check = completed:success, then merge.

---

## Self-Review

**1. Spec coverage:**

- Factory `createIngestAction` (spec Component 1) → Task 2. Barrel re-export → Task 2 Step 4. Optional peer dep + tsup-external behavior → Task 1 + Task 4 Step 1. ✓
- Release 0.35.0 via changeset → Task 3 + Task 4 Step 4. ✓
- Starter contact route `+page.server.ts` (prerender=false, load, factory action) → Task 6. ✓
- Starter `+page.svelte` (Field + enhance + honeypot + ts + success/error) → Task 7. ✓
- Dep bump to `^0.35.0` in `dependencies` → Task 5. ✓
- `.env.example` vars → Task 8 Step 1. ✓
- `rfp-handbook.md` swap → Task 8 Step 2. ✓
- CSP: spec says no change needed — correctly omitted (no task). ✓
- Testing (package unit tests; starter lint/check/build/a11y) → Task 2 + Task 9. ✓

**2. Placeholder scan:** The only `<slug>` tokens are intentional example values inside `.env.example` content. No TBD/TODO/"add error handling"/"similar to". Every code step shows complete code. ✓

**3. Type consistency:** `createIngestAction`, `CreateIngestActionOptions`, `IngestActionConfig`, `IngestActionData`, `getConfig`, `buildPayload`, `formType` are spelled identically across the factory (Task 2), the barrel export (Task 2 Step 4), the test (Task 2 Step 1), and the starter action (Task 6). `FORMS_INGEST_URL` / `FORMS_INGEST_TOKEN` (plural) are consistent across the factory `getConfig`, the starter action, and `.env.example`. Field names (`name`/`email`/`phone`/`message`/`ts`/`bot-field`) match between `+page.svelte` (Task 7) and the action `buildPayload` (Task 6). ✓
