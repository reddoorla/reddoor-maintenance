# Interactive cockpit — design (Trigger Renovate + Edit site details)

**Date:** 2026-06-24
**Status:** approved (brainstorm), ready for implementation plan(s)

## Goal

Make the operator dashboard _act_ on a site, not just report it. Two independent, separable capabilities sharing the same auth/endpoint plumbing:

- **A. Trigger Renovate** — a button (on each repo-backed site's cockpit card _and_ its `/s/<slug>` page) that dispatches that repo's `renovate.yml` on demand. The async "kick off the real fix" model already chosen for the fix/resolve direction.
- **B. Edit site details** — make the existing "Site details" section on `/s/<slug>` inline-editable for a safe-text + operational field set, writing straight to the Airtable Websites row.

These are **two implementation plans** (A touches GitHub/request-path dispatch; B touches Airtable writes). They share the authed-write pattern below.

## Shared architecture (the existing authed-write pattern)

Both new endpoints mirror `netlify/functions/report-checklist.mts` exactly:

- `export const config: Config = { path: ["/api/sites/:slug/<verb>", "/.netlify/functions/<name>"], rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] } }`
- `GET` → presence-only health check (never echoes env values).
- `POST` → **CSRF** (`isCsrfAllowed(req)` → 403) → **`DASHBOARD_PASSWORD`** present (503) → **`verifyBasicAuth`** (401 + `www-authenticate`) → **`AIRTABLE_PAT`/`AIRTABLE_BASE_ID`** present (500) → parse JSON body (400 on bad) → call the **pure core** with injected deps → map the result union to a JSON status → `handlerError(name, err)` on throw.
- **Pure core + injected deps** (mirrors `src/dashboard/checklist.ts`): all logic in a testable function; the `.mts` binds deps to a live `openBase(...)`; tests bind fakes. Site lookup via `getWebsiteBySlug(base, slug)` (`src/reports/airtable/websites.ts:283`).

Both write at request time and are **fast** (one GitHub API call / one Airtable update) — no long-running concern. Dashboard-side changes go live on **main redeploy**, not npm publish.

---

## Component A — Trigger Renovate

### Pure core — `src/dashboard/trigger-renovate.ts` (new)

```ts
export type TriggerRenovateDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  dispatch: (repo: string) => Promise<void>; // gh.dispatchWorkflow(repo, "renovate.yml", defaultBranch)
};
export type TriggerRenovateResult =
  | { status: "dispatched"; slug: string; repo: string }
  | { status: "no-repo"; slug: string }
  | { status: "not-found"; slug: string }
  | { status: "failed"; slug: string; repo: string; error: string };

export async function triggerRenovateForSite(
  deps: TriggerRenovateDeps,
  slug: string,
): Promise<TriggerRenovateResult> {
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  const repo = site.gitRepo?.trim();
  if (!repo) return { status: "no-repo", slug };
  try {
    await deps.dispatch(repo);
    return { status: "dispatched", slug, repo };
  } catch (e) {
    return { status: "failed", slug, repo, error: e instanceof Error ? e.message : String(e) };
  }
}
```

Fires **unconditionally** (operator intent — Renovate dedups/rebases itself; no healthy-PR skip like the nightly sweep). Reuses `RENOVATE_WORKFLOW_FILE` (`"renovate.yml"`) from `src/github/renovate-dispatch.ts`.

### Endpoint — `netlify/functions/trigger-renovate.mts` (new)

`path: ["/api/sites/:slug/trigger-renovate", "/.netlify/functions/trigger-renovate"]`. After the shared auth gauntlet:

- Read the GitHub token: `process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim()`. **No token → 503 `{ error: "not-configured" }`** (ships dark until the env var is added — same degrade as `renovate-dispatch`). This is the **first request-path GitHub write from the dashboard**, so the dashboard's Netlify env must gain `RENOVATE_TOKEN` (op prereq).
- `const gh = makeGitHub({ token })`; bind `dispatch: (repo) => gh.dispatchWorkflow(repo, RENOVATE_WORKFLOW_FILE, await gh.defaultBranch(repo))` and `getSite: (s) => getWebsiteBySlug(base, s)`.
- Map: `dispatched → 200 {ok:true}`, `no-repo → 400`, `not-found → 404`, `failed → 502`.

### UI

- **Cockpit card** (`cockpitCard` in `src/dashboard/fleet-render.ts`): for a **repo-backed** site (`site.gitRepo` non-blank), render a `<button class="trigger-renovate" data-trigger-url="/api/sites/<slug>/trigger-renovate">Trigger Renovate</button>`. Add a click handler to `FILTER_SCRIPT` mirroring the existing `button.approve` handler (disable → `fetch(url,{method:'POST'})` → `Dispatched ✓` / `Failed`).
- **Per-site page** (`src/dashboard/render.ts`): the same button + a handler in the page's `<script>`.
- Non-repo sites: no button (nothing to dispatch).

---

## Component B — Edit site details

### Editable allowlist + pure core — `src/dashboard/site-details.ts` (new)

A typed allowlist mapping each editable key to its **exact** Airtable column (note the misspelled/lowercased columns) + a kind for validation. Mirrors `checklist.ts`'s reject-before-write safety.

```ts
export const SITE_STATUS_OPTIONS = [
  "in development",
  "launch period",
  "maintenance",
  "hosting",
  "probably not our problem",
  "deprecated",
] as const; // = the code Status type
export const FREQ_OPTIONS = ["None", "Monthly", "Quarterly", "Yearly"] as const;

type FieldKind = "text" | "email" | "emails" | "enum" | "gitrepo";
export const EDITABLE_SITE_FIELDS: Record<
  string,
  { column: string; kind: FieldKind; options?: readonly string[] }
> = {
  pointOfContact: { column: "point of contact", kind: "email" },
  reportRecipientsTo: { column: "Report recipients (To)", kind: "emails" },
  reportRecipientsCc: { column: "Report recipients (CC)", kind: "emails" },
  copyIntro: { column: "Copy — Intro", kind: "text" }, // em-dash
  copyContact: { column: "Copy — Contact", kind: "text" },
  copyFooter: { column: "Copy — Footer", kind: "text" },
  searchQuery: { column: "Search query", kind: "text" },
  ga4PropertyId: { column: "GA4 property ID", kind: "text" },
  gitRepo: { column: "Git repo", kind: "gitrepo" },
  status: { column: "Status", kind: "enum", options: SITE_STATUS_OPTIONS },
  maintenanceFreq: { column: "maintenence freq", kind: "enum", options: FREQ_OPTIONS }, // misspelled in Airtable
  testingFreq: { column: "testing freq", kind: "enum", options: FREQ_OPTIONS },
};

export type SiteDetailDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  updateField: (recordId: string, column: string, value: string) => Promise<void>;
};
export type SiteDetailResult =
  | { status: "updated"; slug: string; field: string }
  | { status: "bad-field"; slug: string; field: string }
  | { status: "invalid"; slug: string; field: string; reason: string }
  | { status: "not-found"; slug: string };

export async function setSiteDetail(deps, slug, field, rawValue): Promise<SiteDetailResult>;
```

`setSiteDetail` logic: (1) `entry = EDITABLE_SITE_FIELDS[field]`; missing → `bad-field` (**before any read** — a hand-crafted authed POST can never write an arbitrary column). (2) **validate/normalize** `rawValue` per `entry.kind` → on failure `invalid` (no write). (3) `getSite(slug)`; null → `not-found`. (4) `updateField(site.id, entry.column, normalized)`. (5) `updated`.

**Validators** (`normalizeFieldValue(kind, raw, options)`):

- `enum` — must be exactly one of `options` (no empty); else invalid.
- `email` — trim; empty allowed (clears); else must match a simple email regex.
- `emails` — split on commas/newlines, trim each, drop blanks; each must be email-shaped; re-joined with `, `; empty allowed.
- `gitrepo` — trim; empty allowed; else must match `/^[\w.-]+\/[\w.-]+$/`.
- `text` — trim; cap length (copy 2000, others 500); empty allowed.

### Airtable writer — `src/reports/airtable/websites.ts` (new)

```ts
/** Generic single-field writer for the dashboard site-details editor. The CALLER
 *  (setSiteDetail) restricts `column` to the EDITABLE_SITE_FIELDS allowlist, so
 *  this never writes an arbitrary column from request input. */
export async function updateSiteField(
  base: AirtableBase,
  recordId: string,
  column: string,
  value: string,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: { [column]: value } }]);
}
```

### Endpoint — `netlify/functions/site-details.mts` (new)

`path: ["/api/sites/:slug/details", "/.netlify/functions/site-details"]`. Shared auth gauntlet; body `{ field: string, value: string }`; bind `getSite: (s)=>getWebsiteBySlug(base,s)`, `updateField: (id,col,val)=>updateSiteField(base,id,col,val)`. Map: `updated → 200`, `bad-field → 400`, `invalid → 400 {reason}`, `not-found → 404`.

### UI — `src/dashboard/render.ts`

Replace the read-only `siteDetailsSection` (`render.ts:245`) with an **editable** version: each allowlisted field renders a control with `data-detail-field="<key>"` + `data-details-url="/api/sites/<slug>/details"`:

- `enum` (Status, Maintenance/Testing cadence) → `<select>` of its options, current value selected.
- `email` / `text` short (POC, Search query, GA4, Git repo, recipients) → `<input>`.
- `text` long (Copy Intro/Contact/Footer) → `<textarea>`.

Add a script (sibling of the checklist handler) that, on `change` (selects) / `blur` (inputs/textareas) when the value changed, POSTs `{field, value}` and shows a per-field `✓` / `✗(reason)`. Reuses the same inline-authed-POST shape as the checklist checkboxes.

---

## Error handling / safety

- **Allowlist before read** (B) and **token-gate before dispatch** (A) — both reject bad input early; neither can be coerced into writing an arbitrary Airtable column or dispatching a non-`renovate.yml` workflow (`dispatchWorkflow` also `assertUrlSegment`-validates owner/name/workflow/ref).
- Same **CSRF + Basic-auth + rate-limit** posture as every other state-changing dashboard endpoint.
- **Ships dark (A):** no `RENOVATE_TOKEN` in the dashboard env → button returns `not-configured`; nothing breaks.
- Throws funnel through `handlerError` (502, no internal leak), matching the other handlers.

## Testing

- **A pure core:** `triggerRenovateForSite` — dispatched / no-repo / not-found / failed (dispatch throws) with fakes.
- **B pure core:** `setSiteDetail` — bad-field (rejected before read); each validator (valid + invalid per kind: enum-not-an-option, bad email, bad git repo, over-length); not-found; updated writes the **right column** with the normalized value.
- **Writers:** `updateSiteField` issues one `update` to the right column (fake base, mirrors `tests/reports/airtable/update-auto-fix-attempts.test.ts`).
- **Render:** cockpit card shows the Trigger button only for repo-backed sites; per-site page renders each editable field as the correct control with the current value.
- **Endpoint guards:** GET health check; POST without CSRF → 403; without auth → 401 (mirror `tests/cli`/existing handler guard tests where present).

## Rollout

- **A only:** add **`RENOVATE_TOKEN`** to the dashboard's Netlify site environment (so the function can dispatch). Until then the button degrades to "not configured". B needs nothing new.
- Both go live on the next **main redeploy**.

## Files touched

**A:** `src/dashboard/trigger-renovate.ts` (new) · `netlify/functions/trigger-renovate.mts` (new) · `src/dashboard/fleet-render.ts` (card button + script) · `src/dashboard/render.ts` (per-site button + script) · `src/dashboard/index.ts` (barrel export) · tests.

**B:** `src/dashboard/site-details.ts` (new) · `src/reports/airtable/websites.ts` (`updateSiteField`) · `netlify/functions/site-details.mts` (new) · `src/dashboard/render.ts` (editable section + script) · `src/dashboard/index.ts` (barrel export) · tests.

One changeset per plan (minor), or one combined minor.
