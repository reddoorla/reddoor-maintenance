# Fleet Forms Phase 2b — gallerysonder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate gallerysonder off Netlify Forms onto the central dashboard ingest, via a new reusable `createIngestEndpoint` package helper; retrofit data-dynamiq onto the same helper.

**Architecture:** A JSON-endpoint factory (`createIngestEndpoint`) is the client-driven sibling of `createIngestAction`. gallerysonder gets one multi-type `/api/forms` endpoint that all four hidden forms POST to; data-dynamiq's existing single-type endpoint is rewritten to use the helper too.

**Tech Stack:** TypeScript, SvelteKit 2 (Svelte 5), `@sveltejs/kit` (`json`, `RequestEvent`), vitest, tsup, changesets, adapter-netlify.

**Three PRs, with a release gate:**
- **PR-A** (reddoor-maintenance): `createIngestEndpoint` + tests + barrel export → merge → **0.37.0** release (human-gated) → npm publish.
- **PR-B** (gallerysonder): migrate, consuming `^0.37.0`. *Blocked on the 0.37.0 publish.*
- **PR-C** (data-dynamiq): retrofit, consuming `^0.37.0`. *Blocked on the 0.37.0 publish.*

Reference spec: `docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-gallerysonder-design.md`.

---

## PR-A — `createIngestEndpoint` (reddoor-maintenance)

Branch off `main`: `feat/forms-ingest-endpoint`. Commit the spec + this plan first.

### Task 1: `createIngestEndpoint` factory (TDD)

**Files:**
- Create: `src/forms/endpoint.ts`
- Test: `tests/forms/endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/forms/endpoint.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { createIngestEndpoint } from "../../src/forms/endpoint.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build a fake RequestEvent whose request.json() resolves to `body`, or throws
// when `body` is the BAD_JSON sentinel (simulating a non-JSON request body).
const BAD_JSON = Symbol("bad-json");
function fakeEvent(body: unknown, fetchImpl: typeof fetch): RequestEvent {
  return {
    request: {
      json: async () => {
        if (body === BAD_JSON) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    },
    fetch: fetchImpl,
    url: new URL("https://site.test/api/forms"),
  } as unknown as RequestEvent;
}

const okConfig = () => ({ url: "https://dash/api/forms/sonder", token: "tok" });

describe("createIngestEndpoint", () => {
  it("forwards a clean multi-type submission and returns ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({
        formType: body.formType as string,
        name: body.name as string,
        email: body.email as string,
      }),
    });
    const res = await endpoint(
      fakeEvent({ formType: "inquiry", name: "Ada", email: "a@b.co" }, fetchMock),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/sonder");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({
      formType: "inquiry",
      name: "Ada",
      email: "a@b.co",
    });
  });

  it("silently accepts a filled honeypot without forwarding", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
    });
    const res = await endpoint(
      fakeEvent({ formType: "contact", email: "a@b.co", "bot-field": "i am a bot" }, fetchMock),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-JSON / unparseable body", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: () => ({ formType: "contact" }),
    });
    const res = await endpoint(fakeEvent(BAD_JSON, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when formType is missing", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ email: body.email as string }),
    });
    const res = await endpoint(fakeEvent({ email: "a@b.co" }, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when formType is not a known submission type", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "evil" }, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the fixed formType even when the body carries another", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recZ" }));
    const endpoint = createIngestEndpoint({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "evil", email: "a@b.co" }, fetchMock));
    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).formType).toBe("contact");
  });

  it("returns 500 when env config is missing", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: () => ({}),
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "contact" }, fetchMock));
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the ingest endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, error: "no" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "contact" }, fetchMock));
    expect(res.status).toBe(502);
  });

  it("bundles a buildPayload `extra` object into the forwarded payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recE" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({
        formType: body.formType as string,
        email: "a@b.co",
        extra: { piece: "Untitled", guests: "2" },
      }),
    });
    await endpoint(fakeEvent({ formType: "rsvp" }, fetchMock));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).extra).toEqual({
      piece: "Untitled",
      guests: "2",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/forms/endpoint.test.ts`
Expected: FAIL — `createIngestEndpoint` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/forms/endpoint.ts`:

```ts
import { json, type RequestEvent } from "@sveltejs/kit";
import { submitToIngest, screenSubmission, type SubmissionPayload } from "./client.js";
import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
import type { IngestActionConfig } from "./action.js";

/**
 * Options for {@link createIngestEndpoint} — the JSON sibling of
 * `createIngestAction` for client-driven forms (modals / lightboxes / fetch)
 * that POST JSON to a `+server.ts` route instead of using a form action.
 */
export type CreateIngestEndpointOptions = {
  /** Read at call time so SvelteKit's dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig;
  /**
   * Map the parsed JSON body to a payload. Must set `formType` UNLESS the fixed
   * `formType` option is provided (then that is authoritative and overrides it).
   */
  buildPayload: (body: Record<string, unknown>, event: RequestEvent) => SubmissionPayload;
  /** Fixed formType for single-type endpoints; omit for multi-type endpoints
   *  where `buildPayload` derives formType from the body. */
  formType?: string;
  /** Honeypot field name in the JSON body. Default "bot-field". */
  botFieldName?: string;
  /** json(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** json(400/502) copy for bad input / ingest failure. */
  errorMessage?: string;
};

function isFormType(v: unknown): v is FormType {
  return typeof v === "string" && (SUBMISSION_FORM_TYPES as readonly string[]).includes(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Build a JSON `POST` handler that screens for bots, forwards the submission to
 * the dashboard ingest endpoint, and returns `{ ok }`-shaped JSON. The per-form
 * field mapping (`buildPayload`) is the only thing a site must supply. The
 * returned function is structurally a SvelteKit `RequestHandler`.
 */
export function createIngestEndpoint(
  opts: CreateIngestEndpointOptions,
): (event: RequestEvent) => Promise<Response> {
  const botFieldName = opts.botFieldName ?? "bot-field";
  const unavailable =
    opts.unavailableMessage ?? "This form is temporarily unavailable. Please email us directly.";
  const failed =
    opts.errorMessage ?? "Something went wrong sending your message. Please try again.";

  return async (event) => {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await event.request.json();
      if (!parsed || typeof parsed !== "object") throw new Error("body is not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.error("[forms-ingest] could not parse JSON body");
      return json({ ok: false, error: failed }, { status: 400 });
    }

    // Bot screen: honeypot only. A client POST carries no server-planted ts, and
    // screenSubmission treats a missing elapsedMs as OK. A filled honeypot is
    // silently accepted (return ok, do NOT forward) so bots get no signal.
    const screen = screenSubmission({ botField: str(body[botFieldName]) ?? null });
    if (!screen.ok) return json({ ok: true });

    const payload: SubmissionPayload = {
      ...opts.buildPayload(body, event),
      ...(opts.formType ? { formType: opts.formType } : {}),
    };
    if (!isFormType(payload.formType)) {
      console.error(`[forms-ingest] invalid formType: ${String(payload.formType)}`);
      return json({ ok: false, error: failed }, { status: 400 });
    }

    const { url, token } = opts.getConfig();
    if (!url || !token) {
      console.error(`[forms-ingest] config missing for formType=${payload.formType}`);
      return json({ ok: false, error: unavailable }, { status: 500 });
    }

    const result = await submitToIngest({ url, token, fetch: event.fetch, payload });
    if (!result.ok) {
      console.error(`[forms-ingest] ${payload.formType} → ${result.status}: ${result.error}`);
      return json({ ok: false, error: failed }, { status: 502 });
    }
    return json({ ok: true });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/forms/endpoint.test.ts`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add src/forms/endpoint.ts tests/forms/endpoint.test.ts
git commit -m "feat(forms): add createIngestEndpoint — JSON sibling of createIngestAction for client-driven forms"
```

### Task 2: Export from the barrel + full verify + changeset

**Files:**
- Modify: `src/forms/index.ts`
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Add the export**

In `src/forms/index.ts`, after the `createIngestAction` export block, add:

```ts
export {
  createIngestEndpoint,
  type CreateIngestEndpointOptions,
} from "./endpoint.js";
```

- [ ] **Step 2: Full pre-merge verification gate**

Run each; all must pass:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist
```
Expected: all green. (`test:dist` confirms `createIngestEndpoint` is reachable from the built barrel — a renamed/missing public export would fail here, not in `build`.)

- [ ] **Step 3: Add a changeset**

Create `.changeset/forms-ingest-endpoint.md`:

```md
---
"@reddoorla/maintenance": minor
---

Add `createIngestEndpoint` — a JSON `POST`-handler factory for client-driven
forms (modals/lightboxes/fetch), the sibling of `createIngestAction`. Screens
the honeypot, validates `formType` against `SUBMISSION_FORM_TYPES`, forwards to
the dashboard ingest, and returns `{ ok }`-shaped JSON.
```

- [ ] **Step 4: Commit + push + open PR**

```bash
git add src/forms/index.ts .changeset/forms-ingest-endpoint.md docs/superpowers/specs/2026-06-15-fleet-forms-phase2b-gallerysonder-design.md docs/superpowers/plans/2026-06-15-fleet-forms-phase2b-gallerysonder.md
git commit -m "feat(forms): export createIngestEndpoint from the /forms barrel"
git push -u origin feat/forms-ingest-endpoint
gh pr create --title "feat(forms): createIngestEndpoint for client-driven forms (Phase 2b)" --body "<summary>"
```

**Release gate:** merge PR-A once CI `ci / ci` is green on the HEAD SHA + reviews clean. Then the changesets "Version Packages" PR opens → **human merges it** → npm publishes **0.37.0** + dashboard redeploys. PR-B and PR-C are blocked until 0.37.0 is on npm.

---

## PR-B — gallerysonder migration

Repo: `/Users/tuckerlemos/Documents/GitHub/gallerysonder`. Branch off `main`: `feat/forms-ingest`. Requires `@reddoorla/maintenance@^0.37.0` published.

### Task 3: Rewrite the client util

**Files:**
- Modify: `src/lib/utils/forms.ts`

- [ ] **Step 1: Replace `submitNetlifyForm` with `submitForm`**

Replace the whole file with (note: gallerysonder uses **tab** indentation):

```ts
export interface FormSubmissionResult {
	success: boolean;
	status: number;
}

// Legacy `form-name` marker → ingest formType. Only `news` differs.
const FORM_TYPE_BY_NAME: Record<string, string> = {
	contact: 'contact',
	inquiry: 'inquiry',
	news: 'newsletter',
	rsvp: 'rsvp'
};

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/**
 * Forward a hidden form's data to the central dashboard ingest endpoint
 * (`/api/forms`). Derives the ingest formType from the legacy `form-name`
 * marker, folds the UTM hidden inputs (captured at landing) into a single `utm`
 * query string, and attaches the current page URL as `sourceUrl`. Site-specific
 * fields (piece, artist, role, event, guests, company, appointment_*) ride along
 * as top-level keys; the ingest endpoint bundles them into `extra`. Never throws
 * — a network error is surfaced as `{ success: false }` so callers' email
 * fallbacks fire.
 */
export async function submitForm(formElement: HTMLFormElement): Promise<FormSubmissionResult> {
	const formData = new FormData(formElement);
	const entries: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		if (typeof value === 'string') entries[key] = value;
	}

	const formName = entries['form-name'] ?? '';
	const formType = FORM_TYPE_BY_NAME[formName] ?? formName;

	// Fold UTM hidden inputs (defaulted to 'none' at mount) into one query string,
	// dropping empties/'none'; lands in the ingest `utm` column.
	const utmParams = new URLSearchParams();
	for (const key of UTM_KEYS) {
		const value = entries[key];
		if (value && value !== 'none') utmParams.set(key, value);
		delete entries[key];
	}
	delete entries['form-name'];

	const payload: Record<string, string> = {
		...entries,
		formType,
		sourceUrl: window.location.href
	};
	const utm = utmParams.toString();
	if (utm) payload.utm = utm;

	try {
		const response = await fetch('/api/forms', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		return { success: response.ok, status: response.status };
	} catch {
		// Network error / offline — surface as a failure so the email fallback fires.
		return { success: false, status: 0 };
	}
}

export function populateHiddenForm(formId: string, fieldValues: Record<string, string>): boolean {
	const form = document.getElementById(formId) as HTMLFormElement;
	if (!form) return false;

	Object.entries(fieldValues).forEach(([name, value]) => {
		const field = form.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
		if (field) field.value = value;
	});

	return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/utils/forms.ts
git commit -m "feat(forms): submitForm posts JSON to the dashboard ingest (was Netlify Forms)"
```

### Task 4: Add the ingest endpoint

**Files:**
- Create: `src/routes/api/forms/+server.ts`

- [ ] **Step 1: Create the endpoint**

```ts
import { env } from "$env/dynamic/private";
import { createIngestEndpoint, type SubmissionPayload } from "@reddoorla/maintenance/forms";
import type { RequestHandler } from "./$types";

// POST-only ingest endpoint; never prerendered.
export const prerender = false;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// Typed + control keys are handled explicitly; everything else a hidden form
// carries (piece, artist, role, event, guests, company, appointment_*) is
// site-specific and bundled into `extra` for the dashboard's Extra fields JSON.
const CONTROL_KEYS = new Set(["bot-field", "ts", "form-name"]);
const TYPED_KEYS = new Set([
  "formType", "name", "firstName", "lastName", "email", "phone", "message", "sourceUrl", "utm",
]);

export const POST: RequestHandler = createIngestEndpoint({
  getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
  buildPayload: (body): SubmissionPayload => {
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!CONTROL_KEYS.has(k) && !TYPED_KEYS.has(k)) extra[k] = v;
    }
    return {
      formType: str(body.formType),
      name: str(body.name),
      email: str(body.email),
      phone: str(body.phone),
      message: str(body.message),
      sourceUrl: str(body.sourceUrl),
      utm: str(body.utm),
      ...(Object.keys(extra).length ? { extra } : {}),
    };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/forms/+server.ts
git commit -m "feat(forms): add /api/forms multi-type ingest endpoint (createIngestEndpoint)"
```

### Task 5: Strip Netlify Forms wiring + rename the 4 triggers + bump dep

**Files:**
- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/slices/TitleBlock/index.svelte`
- Modify: `src/lib/components/Lightbox.svelte`
- Modify: `src/lib/components/NewsletterSignup.svelte`
- Modify: `src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte`
- Modify: `package.json`

- [ ] **Step 1: Drop `data-netlify*` from all four `<form>`s in `+layout.svelte`**

For each of the four hidden forms (`contact`, `inquiry`, `news`, `rsvp`), remove the
`data-netlify="true"` and `data-netlify-honeypot="bot-field"` attributes from the
`<form>` tag. **Keep** the `form-name` hidden input (the client reads it as the
formType marker), the `bot-field` honeypot input, the UTM hidden inputs, and the
`name`/`method` attributes. Nothing else in the layout changes.

- [ ] **Step 2: Rename the import + call in each of the 4 trigger files**

In `TitleBlock/index.svelte`, `Lightbox.svelte`, `NewsletterSignup.svelte`, and
`rsvp/[uid]/+page.svelte`:
- change `import { populateHiddenForm, submitNetlifyForm } from '$lib/utils/forms'`
  → `import { populateHiddenForm, submitForm } from '$lib/utils/forms'`
- change the call `submitNetlifyForm(form)` → `submitForm(form)`

No other change — `populateHiddenForm`, the modal/lightbox/scroll triggers, and the
existing success/error UX (the `info@gallerysonder.com` fallback) all stay.

- [ ] **Step 3: Move the package dep to `dependencies@^0.37.0`**

In `package.json`, remove `@reddoorla/maintenance` from `devDependencies` and add it
to `dependencies` at `"^0.37.0"` (it is now a server-runtime import in `/api/forms`,
not just the build-time `createSvelteConfig`). Then:

```bash
pnpm install
```

- [ ] **Step 4: Verify, commit**

```bash
pnpm lint
pnpm check
pnpm build
```
Expected: all green. Then:
```bash
git add -- src/routes/+layout.svelte "src/lib/slices/TitleBlock/index.svelte" src/lib/components/Lightbox.svelte src/lib/components/NewsletterSignup.svelte "src/routes/[[preview=preview]]/rsvp/[uid]/+page.svelte" package.json pnpm-lock.yaml
git commit -m "feat(forms): drop Netlify Forms wiring, route all 4 forms through /api/forms"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/forms-ingest
gh pr create --title "feat(forms): migrate to central dashboard ingest (Phase 2b)" --body "<summary>"
```

Merge once CI green + reviews clean. Then the operator wires Netlify env (below) and deploys.

---

## PR-C — data-dynamiq retrofit

Repo: `/Users/tuckerlemos/Documents/GitHub/data-dynamiq`. Branch off `main`: `refactor/forms-ingest-endpoint`. Requires `@reddoorla/maintenance@^0.37.0` published.

### Task 6: Rewrite the endpoint onto the helper

**Files:**
- Modify: `src/routes/api/contact/+server.ts`
- Modify: `package.json`

- [ ] **Step 1: Replace the handler body**

Replace `src/routes/api/contact/+server.ts` with:

```ts
import { env } from "$env/dynamic/private";
import { createIngestEndpoint, type SubmissionPayload } from "@reddoorla/maintenance/forms";
import type { RequestHandler } from "./$types";

// POST-only ingest endpoint; never prerendered.
export const prerender = false;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const POST: RequestHandler = createIngestEndpoint({
  formType: "contact",
  getConfig: () => ({ url: env.FORMS_INGEST_URL, token: env.FORMS_INGEST_TOKEN }),
  unavailableMessage: "The contact form is temporarily unavailable.",
  buildPayload: (body): SubmissionPayload => ({
    name: str(body.name),
    email: str(body.email),
    message: str(body.message),
    sourceUrl: str(body.sourceUrl),
  }),
});
```

This preserves the wire contract: status codes (400 bad JSON, 500 missing env, 502
ingest fail, 200 ok/bot) and the `{ ok }` body shape are identical. The 500 copy is
preserved via `unavailableMessage`; the 400/502 copy now uses the helper default
(not user-visible — the modal shows its own message), an acceptable minor change.

- [ ] **Step 2: Bump the dep**

In `package.json`, set `@reddoorla/maintenance` to `"^0.37.0"` (keep it in
`dependencies` where it already is). Then `pnpm install`.

- [ ] **Step 3: Verify, commit, push, PR**

```bash
pnpm lint
pnpm check
pnpm build
git add src/routes/api/contact/+server.ts package.json pnpm-lock.yaml
git commit -m "refactor(forms): use createIngestEndpoint for /api/contact (shared helper)"
git push -u origin refactor/forms-ingest-endpoint
gh pr create --title "refactor(forms): adopt shared createIngestEndpoint helper" --body "<summary>"
```

Merge once CI green + reviews clean. Then redeploy + re-verify.

---

## Post-merge: env wiring, live-verify, Airtable audit (operator + controller)

- [ ] **gallerysonder Netlify env** (operator): set `FORMS_INGEST_URL =
  https://reddoor-maintenance.netlify.app/api/forms/sonder` (**slug `sonder`** — must
  match the SITE; the alamo lesson) + `FORMS_INGEST_TOKEN = <shared token>`. Redeploy.

- [ ] **Live-verify gallerysonder** (controller): flip Sonder Status → `launch period`
  (record `recSUY16OKTY7NUNb`) so test notifications route to the operator, not Josh.
  POST one of each formType (`contact`, `inquiry`, `newsletter`, `rsvp`) to
  `https://gallerysonder.com/api/forms` with a UTM-bearing payload. For each, confirm
  the `Submissions` row links `Site → recSUY16OKTY7NUNb`, has the right `formType`,
  populated `utm` + `Source URL`, and `Notify status: sent`. Delete the test rows.
  Restore Status → `maintenance`.

- [ ] **Airtable field audit** (controller): confirm the Sonder Websites record is
  dashboard-correct (Status, POC, url, Git repo, slug derivation) — consistent with
  the per-site audit done for alamo/data-dynamiq.

- [ ] **Re-verify data-dynamiq** (controller): same flip-guard (its POC is set), POST a
  contact submission, confirm the row + notify, delete, restore.

- [ ] **Memory**: update `fleet-forms-pipeline-phase1.md` + `MEMORY.md` — Phase 2b
  COMPLETE (all sites migrated), `createIngestEndpoint` shipped (0.37.0), data-dynamiq
  retrofitted, gallerysonder live-verified.
