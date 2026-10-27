# Fleet Forms Phase 2c — Easy Three (Espada · MSOT · Vineyard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan one site at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the three remaining trivial Netlify-Forms sites (Espada, MSOT, Vineyard) off Netlify Forms onto the central `@reddoorla/maintenance` forms-ingest pipeline via `createIngestAction` — one PR per site.

**Architecture:** Each site has exactly one contact form (`src/lib/components/FullWidth/ContactForm.svelte`, rendered by `src/routes/[[preview=preview]]/contact/+page.svelte`). The port adds a `+page.server.ts` whose `default` action is `createIngestAction(...)`, converts the form from a native Netlify `<form netlify>` to a progressively-enhanced `use:enhance` POST with the honeypot + timing screen, bumps the `@reddoorla/maintenance` dep so the `/forms` subpath resolves, and documents the two Netlify env vars. No dashboard/package change — `createIngestAction` already shipped (0.34.0).

**Tech Stack:** SvelteKit 2 / Svelte 5 runes / adapter-netlify / Prismic / `@reddoorla/maintenance/forms`.

---

## Per-site table (the only things that differ)

|                             | **Espada**                                                                             | **MSOT**                                                                           | **Vineyard**                                                              |
| --------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| repo                        | `reddoorla/espada`                                                                     | `reddoorla/medical-solutions-of-texas`                                             | `reddoorla/vineyard-custom-homes`                                         |
| Airtable Name               | `Espada`                                                                               | `MSOT`                                                                             | `Vineyard Custom Homes `                                                  |
| **slug** (`siteSlug(Name)`) | `espada`                                                                               | `msot`                                                                             | `vineyard-custom-homes`                                                   |
| `FORMS_INGEST_URL`          | `https://reddoor-maintenance.netlify.app/api/forms/espada`                             | `https://reddoor-maintenance.netlify.app/api/forms/msot`                           | `https://reddoor-maintenance.netlify.app/api/forms/vineyard-custom-homes` |
| form fields                 | `firstName`, `lastName`, `email`, `phone`, `message` (+ a dead hidden `select` → DROP) | `name`, `email`, `select` (interest: VA Contracts/DoD Contracts/Both), `message`   | `name`, `email`, `message`                                                |
| honeypot today              | declared `netlify-honeypot` but **no `bot-field` input exists** → ADD one              | `bot-field` input present → keep                                                   | `bot-field` input present → keep                                          |
| extra mapping               | none                                                                                   | `interest: form.get("select")` (folds into `extraFields`, renders in notify email) | none                                                                      |

All three: `Status: maintenance` in Airtable; depend on `@reddoorla/maintenance ^0.28.0` (bump to `^0.40.0`); root layout sets `prerender = "auto"`.

`FORMS_INGEST_TOKEN` is the **shared fleet token** — identical for every site.

---

## The recipe (execute once PER site, in a fresh clone + branch)

### Task 0: Clone, branch, bump the package

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Clone the repo (full, pushable) and branch**

```bash
cd "$(mktemp -d)"
git clone https://github.com/reddoorla/<repo>.git
cd <repo-dir>
git checkout -b feat/forms-ingest-migration
```

(Retry the clone once or twice if it fails with a TLS/x509 OSStatus error — known flake.)

- [ ] **Step 2: Bump the maintenance dep**

In `package.json`, change `"@reddoorla/maintenance": "^0.28.0"` → `"@reddoorla/maintenance": "^0.40.0"`, then:

```bash
pnpm install
```

Expected: lockfile updates, install succeeds. (This pulls the `/forms` subpath; without it the import in Task 1 will not resolve.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump @reddoorla/maintenance to ^0.40.0 for forms ingest"
```

---

### Task 1: Add the server action

**Files:**

- Create: `src/routes/[[preview=preview]]/contact/+page.server.ts`

- [ ] **Step 1: Write `+page.server.ts`** (use the site's `buildPayload` from the per-site variants below)

```ts
import { env } from "$env/dynamic/private";
import { createIngestAction } from "@reddoorla/maintenance/forms";
import type { Actions, PageServerLoad } from "./$types";

// The root layout sets `prerender = "auto"`; a form action cannot run on a
// prerendered route. Opt out — this route is genuinely dynamic.
export const prerender = false;

// Plant a per-request timestamp for the bot timing screen.
export const load: PageServerLoad = () => ({ formTs: Date.now() });

export const actions: Actions = {
  default: createIngestAction({
    formType: "contact",
    getConfig: () => ({
      url: env.FORMS_INGEST_URL,
      token: env.FORMS_INGEST_TOKEN,
    }),
    buildPayload: BUILD_PAYLOAD, // ← site-specific, see below
  }),
};
```

**Espada `buildPayload`:**

```ts
    buildPayload: (form, event) => ({
      name: [form.get("firstName")?.toString(), form.get("lastName")?.toString()]
        .filter(Boolean)
        .join(" "),
      email: form.get("email")?.toString(),
      phone: form.get("phone")?.toString(),
      message: form.get("message")?.toString(),
      sourceUrl: event.url.href,
    }),
```

**MSOT `buildPayload`:** (`interest` is a non-standard key → captured into `extraFields`, rendered in the notify email since 0.39.0)

```ts
    buildPayload: (form, event) => ({
      name: form.get("name")?.toString(),
      email: form.get("email")?.toString(),
      message: form.get("message")?.toString(),
      interest: form.get("select")?.toString() || undefined,
      sourceUrl: event.url.href,
    }),
```

**Vineyard `buildPayload`:**

```ts
    buildPayload: (form, event) => ({
      name: form.get("name")?.toString(),
      email: form.get("email")?.toString(),
      message: form.get("message")?.toString(),
      sourceUrl: event.url.href,
    }),
```

- [ ] **Step 2: Verify the import resolves**

```bash
pnpm svelte-kit sync && pnpm check
```

Expected: no errors referencing `@reddoorla/maintenance/forms` or `./$types`.

---

### Task 2: Convert `ContactForm.svelte` off Netlify Forms

**Files:**

- Modify: `src/lib/components/FullWidth/ContactForm.svelte`

- [ ] **Step 1: Accept the action result + timestamp as props**

Add to the component's `$props()` (alongside whatever it already declares):

```ts
let { form, formTs }: { form?: { success?: boolean; error?: string }; formTs?: number } = $props();
let submitting = $state(false);
```

- [ ] **Step 2: Rewrite the `<form>` element**

Remove `netlify`, `netlify-honeypot="bot-field"`, and the `<input type="hidden" name="form-name" value="contact">`. Remove any `action="/contact?success=true"`. Make it:

```svelte
<form
  method="POST"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      await update();
      submitting = false;
    };
  }}
>
```

Add `import { enhance } from "$app/forms";` to the `<script>`.

- [ ] **Step 3: Add the anti-bot fields** (just inside `<form>`)

```svelte
<input type="hidden" name="ts" value={formTs} />
<input
  type="text"
  name="bot-field"
  tabindex="-1"
  autocomplete="off"
  aria-hidden="true"
  class="hidden"
/>
```

(MSOT/Vineyard already have a `bot-field` input — keep exactly one. Espada has none — this adds it. Match the site's existing hidden-field styling convention if it differs from `class="hidden"`.)

- [ ] **Step 4: Success + error UI, and disable while submitting**

Wrap the form so success replaces it, and surface errors. Preserve the site's existing thank-you copy/markup where it has one:

```svelte
{#if form?.success}
  <!-- the site's existing thank-you block, or: -->
  <p role="status">Thanks — your message is on its way. We'll be in touch soon.</p>
{:else}
  {#if form?.error}
    <p role="alert">{form.error}</p>
  {/if}
  <form method="POST" use:enhance={…}> … </form>
{/if}
```

Set the submit button `disabled={submitting}` and (optionally) swap its label while submitting.

- [ ] **Step 5: Espada only — delete the dead hidden `select`** (it is `hidden`, never populated, unlabeled).

- [ ] **Step 6: Remove the now-unused Netlify type augmentation** if present (e.g. the `netlify`/`netlify-honeypot` JSX-attr lines in `src/global.d.ts`). Leave the file if it carries other declarations.

---

### Task 3: Wire the route page to pass `form` + `formTs` into `ContactForm`

**Files:**

- Modify: `src/routes/[[preview=preview]]/contact/+page.svelte`

- [ ] **Step 1: Forward the props**

Add `form` to the page's `$props()` and pass both down:

```svelte
let { data, form }: { data: PageData; form: ActionData } = $props();
…
<ContactForm {form} formTs={data.formTs} />
```

Import `ActionData` from `./$types` if not already.

- [ ] **Step 2: MSOT only — drop the `?success=true` URL-param success logic** in `+page.svelte` (success is now driven by the `form` action result inside `ContactForm`).

---

### Task 4: Document the env vars

**Files:**

- Modify (or create): `.env.example`

- [ ] **Step 1: Append**

```bash
# Fleet forms: forward contact submissions to the central dashboard ingest.
# Set both in this site's Netlify env. Token = the shared FORMS_INGEST_TOKEN.
FORMS_INGEST_URL=<the site's URL from the per-site table>
FORMS_INGEST_TOKEN=replace-with-the-shared-forms-ingest-token
```

---

### Task 5: Verify green locally

- [ ] **Step 1: Lint, check, build**

```bash
pnpm lint && pnpm check && pnpm build
```

Expected: all pass. If `pnpm lint` reports formatting, run `pnpm lint --fix` or `npx prettier --write` and re-run (CI prettier-checks every file).

- [ ] **Step 2: Commit the migration**

```bash
git add src/routes/'[[preview=preview]]'/contact/+page.server.ts \
        src/routes/'[[preview=preview]]'/contact/+page.svelte \
        src/lib/components/FullWidth/ContactForm.svelte \
        .env.example
# also: git add src/global.d.ts  (if the Netlify type augmentation was removed)
git commit -m "feat(forms): migrate contact form off Netlify Forms to central ingest"
```

---

### Task 6: Push + open PR

- [ ] **Step 1: Push and open**

```bash
git push -u origin feat/forms-ingest-migration
gh pr create --repo reddoorla/<repo> --base main \
  --title "feat(forms): migrate contact form off Netlify Forms to central ingest" \
  --body "Phase 2c. Ports the contact form onto the shared createIngestAction pipeline (Airtable Submissions + dashboard + status-aware notify). Slug: <slug>. Requires FORMS_INGEST_URL + FORMS_INGEST_TOKEN in Netlify env.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Wait for `ci / ci` = success on the PR HEAD SHA, then merge** (squash). Gate on the HEAD SHA's check, not `--watch`.

---

### Task 7: Operator + live verification (after deploy)

- [ ] **Step 1 (operator, manual):** In the site's **Netlify** env, set `FORMS_INGEST_URL` (from the table) and `FORMS_INGEST_TOKEN` (shared). Trigger a redeploy.
- [ ] **Step 2 (verify guard):** Flip the site's Airtable `Status` → `launch period` so `notifyRecipient` routes to the operator (`tucker@reddoorla.com`), not the client POC.
- [ ] **Step 3:** Submit a real test through the deployed contact form. Confirm: a row appears in Airtable `Submissions` for the right Site, and the operator gets the notify email (with `interest` shown for MSOT).
- [ ] **Step 4:** Restore Airtable `Status` → `maintenance`.
- [ ] **Step 5:** In the **Netlify UI**, remove the old Netlify Forms form definition/notifications so no zombie/duplicate submissions linger.

---

## Notes / gotchas carried from prior ports

- **Slug must match the SITE** — the `alamo` bug was a `FORMS_INGEST_URL` pointed at the wrong site's slug. Double-check each against the per-site table.
- `prerender = false` on the contact route is mandatory; a server action on a `prerender="auto"` route 500s live.
- `sourceUrl: event.url.href` (full URL incl. query) so UTM params are captured.
- Verify guard = flip Status to `launch period` so the test notify reaches the operator, not the client. **Restore to `maintenance` immediately after** — these are live business sites.
- `@example.com` test emails are fine for ingest/notify (only Mailchimp rejects them; none of these three has newsletter/Mailchimp).
