# Fleet Forms Phase 2b — data-dynamiq migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate data-dynamiq's home-page contact modal from Netlify Forms + Cloudflare Turnstile to the dashboard ingest via a `+server.ts` endpoint (keeping the home page prerendered), drop Turnstile, and remove two dead wireframer form stubs.

**Architecture:** Single PR in `data-dynamiq` (no package change — uses the existing `submitToIngest` + `screenSubmission` primitives from `@reddoorla/maintenance@^0.36.0`). A new `POST /api/contact` `+server.ts` screens (honeypot) + forwards; the modal's client `fetch` points at it. The home/index route stays statically prerendered.

**Tech Stack:** SvelteKit (Svelte 5 runes, adapter-netlify, Prismic), pnpm.

## Design context & decisions (user-approved 2026-06-15)

1. **`+server.ts` endpoint, home stays prerendered** (chosen over a page action that would de-prerender the index). The contact form is an inherently JS-gated modal, so a client `fetch` → endpoint is the honest fit. Spam screening = **honeypot only** — a prerendered/static page can't plant a fresh per-request server timestamp, so the 2s timing screen doesn't apply (this is the documented `screenSubmission` behavior; `elapsedMs` omitted → not a rejection).
2. **Drop Cloudflare Turnstile** entirely (the fleet uses honeypot + dashboard-side handling). Remove the `<Turnstile>` usage, the `svelte-turnstile` import, and the dependency.
3. **Notify routing:** data-dynamiq is `Status: maintenance` with POC `rgreenquist@datadynamiq.com`, so the status-aware rule routes real leads to the CLIENT. **During live-verification, temporarily set Status → `launch period`** so test submissions notify the operator (`tucker@reddoorla.com`), then restore `maintenance`. (Controller step, not code.)
4. **Cleanup:** `ContactForm.svelte` + `EmailSubmit.svelte` are dead stubs used only by the unlinked "Reddoor Wireframer" showcase routes `/contacts` and `/ctas`. Remove the two components and their usages.
5. **Slug:** `data-dynamiq` (from Name "Data Dynamiq"). The operator's `FORMS_INGEST_URL` must end in `/api/forms/data-dynamiq` — NOT another site's slug (the alamo lesson: a copied URL mis-routes leads to the wrong Airtable Site).
6. **`sourceUrl`:** the client sends `window.location.href` in the body (the endpoint itself is `/api/contact`, not the source page), so UTM/campaign params are captured.

## File Structure (single PR in `/Users/tuckerlemos/Documents/GitHub/data-dynamiq`)

- Create: `src/routes/api/contact/+server.ts` — POST ingest endpoint.
- Modify: `src/routes/[[preview=preview]]/+page.svelte` — rewire the modal (`handleSubmit` → `/api/contact`; drop Turnstile/data-netlify/form-name/`form.submit()`; add error state).
- Modify: `package.json` — `@reddoorla/maintenance` → `^0.36.0` in `dependencies`; remove `svelte-turnstile`.
- Delete: `src/lib/components/FullWidth/ContactForm.svelte`, `src/lib/components/FullWidth/EmailSubmit.svelte`.
- Modify: `src/routes/contacts/+page.svelte`, `src/routes/ctas/+page.svelte` — remove the deleted-component imports + usages.

---

### Task 1: Branch + dependencies

- [ ] **Step 1:** `git checkout main && git pull --ff-only && git checkout -b feat/forms-dashboard-ingest`
- [ ] **Step 2:** In `package.json`: move/ensure `@reddoorla/maintenance` is in `dependencies` at `^0.36.0` (it's currently `^0.28.0` in `dependencies` — just bump the version); and REMOVE the `svelte-turnstile` line from `dependencies`. Run `pnpm install`. Commit `package.json` + `pnpm-lock.yaml` (`build: @reddoorla/maintenance ^0.36.0, drop svelte-turnstile`).

### Task 2: The ingest endpoint

**Files:** Create `src/routes/api/contact/+server.ts`

- [ ] **Step 1:** Create the endpoint:

```ts
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { submitToIngest, screenSubmission } from "@reddoorla/maintenance/forms";
import type { RequestHandler } from "./$types";

// POST-only ingest endpoint; never prerendered.
export const prerender = false;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const POST: RequestHandler = async ({ request, fetch }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Bot screen: honeypot only (a prerendered page has no fresh server timestamp
  // for the timing check; screenSubmission treats a missing elapsedMs as OK).
  const screen = screenSubmission({ botField: str(body["bot-field"]) ?? null });
  if (!screen.ok) return json({ ok: true }); // silently accept, do not forward

  if (!env.FORMS_INGEST_URL || !env.FORMS_INGEST_TOKEN) {
    console.error("[contact] FORMS_INGEST_URL / FORMS_INGEST_TOKEN not set");
    return json(
      { ok: false, error: "The contact form is temporarily unavailable." },
      { status: 500 },
    );
  }

  const result = await submitToIngest({
    url: env.FORMS_INGEST_URL,
    token: env.FORMS_INGEST_TOKEN,
    fetch,
    payload: {
      formType: "contact",
      name: str(body.name),
      email: str(body.email),
      message: str(body.message),
      sourceUrl: str(body.sourceUrl),
    },
  });
  if (!result.ok) {
    console.error(`[contact] ingest failed (${result.status}): ${result.error}`);
    return json(
      { ok: false, error: "Something went wrong sending your message. Please try again." },
      { status: 502 },
    );
  }
  return json({ ok: true });
};
```

- [ ] **Step 2:** `pnpm exec svelte-kit sync` so `./$types` resolves. Commit (`feat(contact): /api/contact ingest endpoint`).

### Task 3: Rewire the home modal

**Files:** Modify `src/routes/[[preview=preview]]/+page.svelte`

- [ ] **Step 1: `<script>` edits.**
  - Remove `import { Turnstile } from "svelte-turnstile";` (line ~25).
  - Add an error state near the other `$state` decls: `let errorMsg = $state("");`
  - Replace the `handleSubmit` function (currently a sync fn doing `fetch("/", …)`) with:

```ts
const handleSubmit = async (event: SubmitEvent) => {
  event.preventDefault();
  errorMsg = "";
  const myForm = event.target as HTMLFormElement;
  const payload: Record<string, string> = { sourceUrl: window.location.href };
  new FormData(myForm).forEach((value, key) => {
    payload[key] = value.toString();
  });
  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (res.ok && data.ok) {
      submitted = true;
      myForm.reset();
    } else {
      errorMsg = data.error ?? "Something went wrong. Please try again.";
    }
  } catch {
    errorMsg = "Network error. Please try again.";
  }
};
```

- [ ] **Step 2: Form markup edits** (the `<form>` ~lines 172-221):
  - On the `<form>` tag, REMOVE `name="contact"`, `data-netlify="true"`, `data-netlify-honeypot="bot-field"`. KEEP `bind:this={form}`, `method="POST"`, `onsubmit={handleSubmit}`, and the `class`.
  - DELETE the `<input type="hidden" name="form-name" value="contact" />` line.
  - KEEP the existing honeypot block (`<p class="hidden"><label>Don't fill this out if you're human: <input name="bot-field" /></label></p>`) and the name/email/message inputs.
  - DELETE the `<Turnstile siteKey="0x4AAAAAAAjylnwnKtVp2F7G" />` line.
  - Change the submit button from `<ContactButton text="request info" click={() => form?.submit()} />` to `<ContactButton text="request info" />`. (ContactButton renders a default-type `<button>`, which inside the form is an implicit submit → clicking it fires the form's `onsubmit={handleSubmit}`. The old `form.submit()` bypassed the handler and is removed.)
  - Add an error message above the submit button, inside the `{:else}` form branch:
    ```svelte
    {#if errorMsg}
      <p role="alert" class="text-primary text-sm">{errorMsg}</p>
    {/if}
    ```

- [ ] **Step 3:** Commit (`feat(contact): forward modal to /api/contact, drop Netlify Forms + Turnstile`).

### Task 4: Remove dead form stubs

**Files:** Delete `src/lib/components/FullWidth/ContactForm.svelte` + `EmailSubmit.svelte`; modify `src/routes/contacts/+page.svelte` + `src/routes/ctas/+page.svelte`.

- [ ] **Step 1:** In `src/routes/contacts/+page.svelte`, remove the `import ContactForm …` line and every `<ContactForm … />` usage. In `src/routes/ctas/+page.svelte`, remove the `import EmailSubmit …` line and every `<EmailSubmit … />` usage. (Leave the rest of each showcase page intact — they demo other components.)
- [ ] **Step 2:** `git rm src/lib/components/FullWidth/ContactForm.svelte src/lib/components/FullWidth/EmailSubmit.svelte`
- [ ] **Step 3:** Confirm nothing else references them: `grep -rn "ContactForm\|EmailSubmit" src` → no matches. Commit (`chore: remove dead ContactForm + EmailSubmit wireframer stubs`).

### Task 5: Gate + PR

- [ ] **Step 1:** `pnpm lint` (run `pnpm format` first if prettier flags edits), `pnpm check` (0 errors — confirms no dangling Turnstile/component refs), `pnpm build`. CONFIRM the home/index route is STILL prerendered (look for `.svelte-kit/output/prerendered/pages/index.html` or similar; the `/api/contact` endpoint must NOT be prerendered and should appear as a server function). If the repo defines `pnpm test:a11y`, run it; else skip.
- [ ] **Step 2:** Push + `gh pr create` (do not self-merge until reviewed + CI green). Title: `feat(forms): route contact modal to the dashboard ingest`. Body: describe the endpoint approach (home stays prerendered), Turnstile removal, stub cleanup, and the operator follow-up (set `FORMS_INGEST_URL=…/api/forms/data-dynamiq` — correct slug! — + shared `FORMS_INGEST_TOKEN`, redeploy).

---

### Task 6: Operator wiring (manual — surface to user)

Set on data-dynamiq's Netlify env: `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/data-dynamiq` (⚠️ slug `data-dynamiq`, not a copied one) + `FORMS_INGEST_TOKEN=<shared token>`; redeploy.

### Task 7: Live verification (controller)

- [ ] Temporarily set the data-dynamiq Websites record (`recAj2cCoH9pKimcL`) `Status` → `launch period` (so test notifies route to tucker, not the client).
- [ ] POST a test submission to `https://www.datadynamiq.com/api/contact` (or the deployed origin) with `{name,email:"contact@tuckerlemos.com",message,sourceUrl}` and a JSON body; expect `{ok:true}`. Also confirm the live modal still renders (home page prerendered).
- [ ] Verify a Submissions row lands: Site = Data Dynamiq (`recAj2cCoH9pKimcL`), formType `contact`, sourceUrl set, Notify status `sent`. Delete the test row.
- [ ] **Restore** the data-dynamiq `Status` → `maintenance`.

---

## Self-Review

- Endpoint approach (decision 1) → Task 2. Turnstile drop (2) → Tasks 1 (dep) + 3 (markup). Notify test-guard (3) → Task 7. Stub cleanup (4) → Task 4. Slug warning (5) → Tasks 6/7. sourceUrl from client (6) → Task 3 handleSubmit. ✓
- Placeholders: `<shared token>` is an intentional operator placeholder. All code steps complete. ✓
- Consistency: `formType:"contact"`, `FORMS_INGEST_URL`/`FORMS_INGEST_TOKEN`, `bot-field`, `sourceUrl`, `submitted`/`errorMsg` state names match between the endpoint and the modal. The honeypot input name (`bot-field`) matches what `screenSubmission` reads via `body["bot-field"]`. ✓
