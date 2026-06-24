# Interactive Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the operator dashboard act on a site — a "Trigger Renovate" button (Part A) and an inline site-details editor on `/s/<slug>` (Part B).

**Architecture:** Both add an authed POST endpoint mirroring `netlify/functions/report-checklist.mts` (CSRF → Basic-auth → Airtable env → pure core with injected deps), a pure testable core mirroring `src/dashboard/checklist.ts` (allowlist/validation before any write), and inline-fetch-POST UI mirroring the existing approve/checklist buttons. A writes to GitHub (`gh.dispatchWorkflow`); B writes one allowlisted Airtable column.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` specifiers), Vitest, Netlify Functions (`.mts`), Airtable SDK. Pure-core + thin-IO-shell.

**Spec:** `docs/superpowers/specs/2026-06-24-interactive-cockpit-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/dashboard/trigger-renovate.ts` | Pure dispatch core (A) | Create |
| `netlify/functions/trigger-renovate.mts` | Authed endpoint (A) | Create |
| `src/dashboard/site-details.ts` | Editable allowlist + validators + pure setter (B) | Create |
| `netlify/functions/site-details.mts` | Authed endpoint (B) | Create |
| `src/reports/airtable/websites.ts` | `updateSiteField` writer (B) | Modify |
| `src/dashboard/fleet-render.ts` | Trigger button on cockpit cards + script (A) | Modify |
| `src/dashboard/render.ts` | Trigger button + editable site-details + page script (A+B) | Modify |
| `src/dashboard/index.ts` | Barrel exports | Modify |

Note: `.mts` handlers are runtime-bound (no unit test) — they're covered by `pnpm test:dist` (which asserts each handler resolves its `src/` imports) + `pnpm typecheck` (includes `.mts` via `tsconfig.netlify.json`). All logic lives in the unit-tested pure cores.

---

# PART A — Trigger Renovate

## Task A1: Pure dispatch core

**Files:**
- Create: `src/dashboard/trigger-renovate.ts`
- Test: `tests/dashboard/trigger-renovate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/trigger-renovate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { triggerRenovateForSite } from "../../src/dashboard/trigger-renovate.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function deps(over: Partial<Parameters<typeof triggerRenovateForSite>[0]> = {}) {
  return {
    getSite: async () => makeWebsiteRow({ id: "recA", name: "Acme", gitRepo: "reddoorla/acme" }),
    dispatch: async () => {},
    ...over,
  };
}

describe("triggerRenovateForSite", () => {
  it("dispatches for a repo-backed site and returns the repo", async () => {
    const calls: string[] = [];
    const r = await triggerRenovateForSite(deps({ dispatch: async (repo) => { calls.push(repo); } }), "acme");
    expect(r).toEqual({ status: "dispatched", slug: "acme", repo: "reddoorla/acme" });
    expect(calls).toEqual(["reddoorla/acme"]);
  });

  it("returns not-found when the slug resolves to no site", async () => {
    const r = await triggerRenovateForSite(deps({ getSite: async () => null }), "ghost");
    expect(r).toEqual({ status: "not-found", slug: "ghost" });
  });

  it("returns no-repo when the site has no Git repo (blank/null)", async () => {
    const r = await triggerRenovateForSite(
      deps({ getSite: async () => makeWebsiteRow({ id: "r", name: "X", gitRepo: "  " }) }),
      "x",
    );
    expect(r).toEqual({ status: "no-repo", slug: "x" });
  });

  it("returns failed (never throws) when dispatch throws", async () => {
    const r = await triggerRenovateForSite(
      deps({ dispatch: async () => { throw new Error("403 no actions:write"); } }),
      "acme",
    );
    expect(r).toEqual({ status: "failed", slug: "acme", repo: "reddoorla/acme", error: "403 no actions:write" });
  });

  it("trims the repo before dispatching", async () => {
    const calls: string[] = [];
    await triggerRenovateForSite(
      deps({
        getSite: async () => makeWebsiteRow({ id: "r", name: "X", gitRepo: " reddoorla/x " }),
        dispatch: async (repo) => { calls.push(repo); },
      }),
      "x",
    );
    expect(calls).toEqual(["reddoorla/x"]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`triggerRenovateForSite` not found)

Run: `pnpm vitest run tests/dashboard/trigger-renovate.test.ts`

- [ ] **Step 3: Implement**

Create `src/dashboard/trigger-renovate.ts`:

```ts
import type { WebsiteRow } from "../reports/airtable/websites.js";

/** Injected IO — the `.mts` binds these to a live Airtable base + makeGitHub; tests bind fakes. */
export type TriggerRenovateDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  /** Dispatch the repo's renovate.yml (the adapter resolves the default branch). */
  dispatch: (repo: string) => Promise<void>;
};

export type TriggerRenovateResult =
  | { status: "dispatched"; slug: string; repo: string }
  | { status: "no-repo"; slug: string }
  | { status: "not-found"; slug: string }
  | { status: "failed"; slug: string; repo: string; error: string };

/**
 * On-demand Renovate trigger for one site, from the dashboard. Resolves the site
 * by slug, dispatches its `renovate.yml` UNCONDITIONALLY (operator intent —
 * Renovate dedups/rebases itself; no healthy-PR skip like the nightly sweep).
 * Never throws: a dispatch failure is returned as `failed` so the endpoint maps
 * it to a clean status instead of a 500.
 */
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

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm vitest run tests/dashboard/trigger-renovate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/trigger-renovate.ts tests/dashboard/trigger-renovate.test.ts
git commit -m "feat(dashboard): triggerRenovateForSite pure core"
```

## Task A2: Endpoint + barrel export

**Files:**
- Create: `netlify/functions/trigger-renovate.mts`
- Modify: `src/dashboard/index.ts`

- [ ] **Step 1: Add the barrel export**

In `src/dashboard/index.ts`, after the `setChecklistItem` exports:

```ts
export { triggerRenovateForSite } from "./trigger-renovate.js";
export type { TriggerRenovateDeps, TriggerRenovateResult } from "./trigger-renovate.js";
```

- [ ] **Step 2: Create the endpoint** (mirrors `report-checklist.mts` auth gauntlet)

Create `netlify/functions/trigger-renovate.mts`:

```ts
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, triggerRenovateForSite } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { makeGitHub } from "../../src/github/gh.js";
import { RENOVATE_WORKFLOW_FILE } from "../../src/github/renovate-dispatch.js";

export const config: Config = {
  path: ["/api/sites/:slug/trigger-renovate", "/.netlify/functions/trigger-renovate"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json({
      status: "ok",
      service: "reddoor-trigger-renovate",
      env: {
        AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
        AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
        DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        RENOVATE_TOKEN:
          typeof process.env.RENOVATE_TOKEN === "string" || typeof process.env.GH_TOKEN === "string",
      },
    }, { status: 200 });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return json({ ok: false, error: "unconfigured" }, 503);
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": 'Basic realm="Reddoor fleet"' });
  }

  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) return json({ ok: false, error: "airtable-env-missing" }, 500);

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  try {
    const base = openBase({ apiKey, baseId });
    const gh = makeGitHub({ token });
    const result = await triggerRenovateForSite(
      {
        getSite: (s) => getWebsiteBySlug(base, s),
        dispatch: async (repo) => {
          const ref = await gh.defaultBranch(repo);
          await gh.dispatchWorkflow(repo, RENOVATE_WORKFLOW_FILE, ref);
        },
      },
      slug,
    );
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    if (result.status === "no-repo") return json({ ok: false, error: "no-repo" }, 400);
    if (result.status === "failed") return json({ ok: false, error: "dispatch-failed", detail: result.error }, 502);
    return json({ ok: true, repo: result.repo }, 200);
  } catch (err) {
    return handlerError("trigger-renovate", err);
  }
};
```

- [ ] **Step 3: Typecheck** — `pnpm typecheck` (covers the `.mts` via tsconfig.netlify.json). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/index.ts netlify/functions/trigger-renovate.mts
git commit -m "feat(dashboard): authed /api/sites/:slug/trigger-renovate endpoint"
```

## Task A3: Trigger button UI (cockpit card + per-site page)

**Files:**
- Modify: `src/dashboard/fleet-render.ts` (cockpitCard ~297, FILTER_SCRIPT ~310)
- Modify: `src/dashboard/render.ts` (siteDetailsSection area + page script ~410)
- Test: `tests/dashboard/fleet-render.test.ts`, `tests/dashboard/render.test.ts`

- [ ] **Step 1: Write the failing render tests**

Append to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("renderCockpitHtml — Trigger Renovate button", () => {
  it("shows a Trigger Renovate button only for repo-backed sites", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ name: "Has Repo", gitRepo: "reddoorla/hasrepo" }),
        siteRow({ name: "No Repo", gitRepo: null }),
      ]),
    );
    expect(html).toContain('data-trigger-url="/api/sites/has-repo/trigger-renovate"');
    expect(html).not.toContain("/api/sites/no-repo/trigger-renovate");
    expect(html).toContain("Trigger Renovate");
  });
});
```

Append to `tests/dashboard/render.test.ts` (mirror its existing harness for calling `renderSiteDashboardHtml`; build the site with `makeWebsiteRow({ gitRepo: "reddoorla/acme" })`):

```ts
it("renders a Trigger Renovate button for a repo-backed site", () => {
  const html = renderForSite(makeWebsiteRow({ name: "Acme", gitRepo: "reddoorla/acme" }));
  expect(html).toContain('data-trigger-url="/api/sites/acme/trigger-renovate"');
  expect(html).toContain("Trigger Renovate");
});
```
> Use whatever helper `render.test.ts` already has to invoke `renderSiteDashboardHtml` (it passes a `WebsiteRow` + reports/submissions/now). Name it to match; do not invent `renderForSite` if a different harness exists.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts tests/dashboard/render.test.ts`

- [ ] **Step 3: Cockpit card button** — in `src/dashboard/fleet-render.ts`, add a helper and include it in `cockpitCard`'s `extra`:

```ts
/** On-demand Renovate trigger button — only for repo-backed sites (nothing to dispatch otherwise). */
function triggerRenovateBtn(c: SiteCard): string {
  if (!c.site.gitRepo?.trim()) return "";
  const url = `/api/sites/${escapeHtml(siteSlug(c.site.name))}/trigger-renovate`;
  return `<button class="trigger-renovate" data-trigger-url="${url}">Trigger Renovate</button>`;
}
```

Add `siteSlug` to the import from `websites.js` at the top of fleet-render.ts if not already imported. Then in `cockpitCard`, change the `extra` line to append it:

```ts
  const extra = `${pill}${chips(c)}${submBadge(c)}${triggerRenovateBtn(c)}`;
```

- [ ] **Step 4: Cockpit script handler** — in `FILTER_SCRIPT`, after the `button.approve` handler block, add:

```js
  document.querySelectorAll('button.trigger-renovate').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Dispatching…';
      try { var res = await fetch(b.dataset.triggerUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Dispatched ✓' : 'Failed';
        if (!res.ok) b.disabled = false;
      } catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
```

- [ ] **Step 5: Per-site page button + handler** — in `src/dashboard/render.ts`: add the button inside `siteDetailsSection` (or just above it) for repo-backed sites:

```ts
  const triggerBtn = site.gitRepo?.trim()
    ? `<button class="trigger-renovate" data-trigger-url="/api/sites/${escapeHtml(siteSlug(site.name))}/trigger-renovate">Trigger Renovate</button>`
    : "";
```
Render `${triggerBtn}` within the site-details `<div class="section site-details">` heading area. Then in the page `<script>`, after the `button.approve` handler, add the same `button.trigger-renovate` handler as Step 4 (plain-JS, already inside a `<script>`).

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts tests/dashboard/render.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts src/dashboard/render.ts tests/dashboard/fleet-render.test.ts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): Trigger Renovate button on cockpit cards + per-site page"
```

---

# PART B — Edit site details

## Task B1: Allowlist + validators + pure setter

**Files:**
- Create: `src/dashboard/site-details.ts`
- Test: `tests/dashboard/site-details.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/site-details.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setSiteDetail, EDITABLE_SITE_FIELDS } from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function deps(over: Partial<Parameters<typeof setSiteDetail>[0]> = {}) {
  const writes: Array<{ id: string; column: string; value: string }> = [];
  return {
    d: {
      getSite: async () => makeWebsiteRow({ id: "recA", name: "Acme" }),
      updateField: async (id: string, column: string, value: string) => { writes.push({ id, column, value }); },
      ...over,
    },
    writes,
  };
}

describe("setSiteDetail", () => {
  it("rejects an unknown field BEFORE any read (bad-field)", async () => {
    let read = false;
    const r = await setSiteDetail(
      { getSite: async () => { read = true; return makeWebsiteRow({ id: "r", name: "X" }); }, updateField: async () => {} },
      "acme", "DNS password", "hax",
    );
    expect(r.status).toBe("bad-field");
    expect(read).toBe(false);
  });

  it("writes an enum field to its exact Airtable column", async () => {
    const { d, writes } = deps();
    const r = await setSiteDetail(d, "acme", "status", "hosting");
    expect(r.status).toBe("updated");
    expect(writes).toEqual([{ id: "recA", column: "Status", value: "hosting" }]);
  });

  it("rejects an enum value not in the options (invalid, no write)", async () => {
    const { d, writes } = deps();
    const r = await setSiteDetail(d, "acme", "maintenanceFreq", "Weekly");
    expect(r.status).toBe("invalid");
    expect(writes).toEqual([]);
  });

  it("writes maintenanceFreq to the misspelled Airtable column", async () => {
    const { d, writes } = deps();
    await setSiteDetail(d, "acme", "maintenanceFreq", "Monthly");
    expect(writes[0]!.column).toBe("maintenence freq");
  });

  it("validates an email field and rejects a malformed address", async () => {
    const { d, writes } = deps();
    expect((await setSiteDetail(d, "acme", "pointOfContact", "not-an-email")).status).toBe("invalid");
    expect(writes).toEqual([]);
    expect((await setSiteDetail(d, "acme", "pointOfContact", "a@b.com")).status).toBe("updated");
  });

  it("normalizes an emails list (split, trim, rejoin) and rejects a bad member", async () => {
    const { d, writes } = deps();
    await setSiteDetail(d, "acme", "reportRecipientsTo", "a@b.com,\n c@d.com ");
    expect(writes[0]).toEqual({ id: "recA", column: "Report recipients (To)", value: "a@b.com, c@d.com" });
    expect((await setSiteDetail(d, "acme", "reportRecipientsTo", "a@b.com, nope")).status).toBe("invalid");
  });

  it("validates a git repo shape (owner/repo)", async () => {
    const { d } = deps();
    expect((await setSiteDetail(d, "acme", "gitRepo", "not a repo")).status).toBe("invalid");
    expect((await setSiteDetail(d, "acme", "gitRepo", "reddoorla/acme")).status).toBe("updated");
  });

  it("allows clearing a text/email field to empty", async () => {
    const { d, writes } = deps();
    expect((await setSiteDetail(d, "acme", "searchQuery", "  ")).status).toBe("updated");
    expect(writes[0]!.value).toBe("");
  });

  it("returns not-found when the slug resolves to no site", async () => {
    const r = await setSiteDetail({ getSite: async () => null, updateField: async () => {} }, "ghost", "status", "hosting");
    expect(r.status).toBe("not-found");
  });

  it("EDITABLE_SITE_FIELDS column strings match the Airtable mapRow columns", () => {
    expect(EDITABLE_SITE_FIELDS.status.column).toBe("Status");
    expect(EDITABLE_SITE_FIELDS.pointOfContact.column).toBe("point of contact");
    expect(EDITABLE_SITE_FIELDS.copyIntro.column).toBe("Copy — Intro");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/dashboard/site-details.test.ts`

- [ ] **Step 3: Implement**

Create `src/dashboard/site-details.ts`:

```ts
import type { WebsiteRow } from "../reports/airtable/websites.js";

export const SITE_STATUS_OPTIONS = [
  "in development", "launch period", "maintenance", "hosting", "probably not our problem", "deprecated",
] as const;
export const FREQ_OPTIONS = ["None", "Monthly", "Quarterly", "Yearly"] as const;

type FieldKind = "text" | "email" | "emails" | "enum" | "gitrepo";
export type EditableField = { column: string; kind: FieldKind; options?: readonly string[]; maxLen?: number };

/** The ONLY columns the dashboard editor may write. `column` is the EXACT Airtable
 *  field name (note the lowercase/misspelled ones), kept in lockstep with mapRow. */
export const EDITABLE_SITE_FIELDS: Record<string, EditableField> = {
  pointOfContact:     { column: "point of contact",       kind: "email" },
  reportRecipientsTo: { column: "Report recipients (To)", kind: "emails" },
  reportRecipientsCc: { column: "Report recipients (CC)", kind: "emails" },
  copyIntro:          { column: "Copy — Intro",           kind: "text", maxLen: 2000 },
  copyContact:        { column: "Copy — Contact",         kind: "text", maxLen: 2000 },
  copyFooter:         { column: "Copy — Footer",          kind: "text", maxLen: 2000 },
  searchQuery:        { column: "Search query",           kind: "text", maxLen: 500 },
  ga4PropertyId:      { column: "GA4 property ID",        kind: "text", maxLen: 500 },
  gitRepo:            { column: "Git repo",               kind: "gitrepo" },
  status:             { column: "Status",                 kind: "enum", options: SITE_STATUS_OPTIONS },
  maintenanceFreq:    { column: "maintenence freq",       kind: "enum", options: FREQ_OPTIONS },
  testingFreq:        { column: "testing freq",           kind: "enum", options: FREQ_OPTIONS },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Validate/normalize a raw value for a field kind. Returns the string to write,
 *  or null when invalid. Empty is allowed (clears) for everything except enums. */
export function normalizeFieldValue(f: EditableField, raw: string): string | null {
  const v = raw.trim();
  switch (f.kind) {
    case "enum":
      return f.options!.includes(v) ? v : null;
    case "email":
      return v === "" ? "" : EMAIL_RE.test(v) ? v : null;
    case "emails": {
      if (v === "") return "";
      const parts = v.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
      return parts.every((p) => EMAIL_RE.test(p)) ? parts.join(", ") : null;
    }
    case "gitrepo":
      return v === "" ? "" : REPO_RE.test(v) ? v : null;
    case "text":
      return v.length <= (f.maxLen ?? 500) ? v : null;
  }
}

export type SiteDetailDeps = {
  getSite: (slug: string) => Promise<WebsiteRow | null>;
  updateField: (recordId: string, column: string, value: string) => Promise<void>;
};
export type SiteDetailResult =
  | { status: "updated"; slug: string; field: string }
  | { status: "bad-field"; slug: string; field: string }
  | { status: "invalid"; slug: string; field: string }
  | { status: "not-found"; slug: string };

/**
 * Write one allowlisted site-detail field. SAFETY: an unknown field is rejected
 * BEFORE any read (a hand-crafted authed POST can never write an arbitrary Airtable
 * column), and the value is validated/normalized before the write.
 */
export async function setSiteDetail(
  deps: SiteDetailDeps,
  slug: string,
  field: string,
  rawValue: string,
): Promise<SiteDetailResult> {
  const f = EDITABLE_SITE_FIELDS[field];
  if (!f) return { status: "bad-field", slug, field };
  const value = normalizeFieldValue(f, rawValue);
  if (value === null) return { status: "invalid", slug, field };
  const site = await deps.getSite(slug);
  if (!site) return { status: "not-found", slug };
  await deps.updateField(site.id, f.column, value);
  return { status: "updated", slug, field };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run tests/dashboard/site-details.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/site-details.ts tests/dashboard/site-details.test.ts
git commit -m "feat(dashboard): site-details editable allowlist + validators + setSiteDetail core"
```

## Task B2: Airtable writer

**Files:**
- Modify: `src/reports/airtable/websites.ts` (after `updateAutoFixAttempts`)
- Test: `tests/reports/airtable/update-site-field.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/reports/airtable/update-site-field.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateSiteField } from "../../../src/reports/airtable/websites.js";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";

function makeFakeBase() {
  const calls: Array<{ table: string; id: string; fields: Record<string, unknown> }> = [];
  const tableFn = (table: string) => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const r of recs) calls.push({ table, id: r.id, fields: r.fields });
      return recs;
    },
  });
  return { base: tableFn as unknown as AirtableBase, calls };
}

describe("updateSiteField", () => {
  it("writes the given column/value to the Websites row", async () => {
    const { base, calls } = makeFakeBase();
    await updateSiteField(base, "recX", "point of contact", "a@b.com");
    expect(calls).toEqual([{ table: "Websites", id: "recX", fields: { "point of contact": "a@b.com" } }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm vitest run tests/reports/airtable/update-site-field.test.ts`

- [ ] **Step 3: Implement** — in `src/reports/airtable/websites.ts`, after `updateAutoFixAttempts`:

```ts
/** Generic single-field writer for the dashboard site-details editor. The caller
 *  (setSiteDetail) restricts `column` to the EDITABLE_SITE_FIELDS allowlist, so this
 *  never writes an arbitrary column from request input. */
export async function updateSiteField(
  base: AirtableBase,
  recordId: string,
  column: string,
  value: string,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: { [column]: value } }]);
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm vitest run tests/reports/airtable/update-site-field.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/websites.ts tests/reports/airtable/update-site-field.test.ts
git commit -m "feat(airtable): updateSiteField generic single-column writer"
```

## Task B3: Endpoint + barrel export

**Files:**
- Create: `netlify/functions/site-details.mts`
- Modify: `src/dashboard/index.ts`

- [ ] **Step 1: Barrel export** — in `src/dashboard/index.ts`:

```ts
export { setSiteDetail, EDITABLE_SITE_FIELDS, SITE_STATUS_OPTIONS, FREQ_OPTIONS } from "./site-details.js";
export type { SiteDetailDeps, SiteDetailResult } from "./site-details.js";
```

- [ ] **Step 2: Create the endpoint** — `netlify/functions/site-details.mts` (mirror trigger-renovate.mts auth gauntlet):

```ts
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug, updateSiteField } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, setSiteDetail } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

export const config: Config = {
  path: ["/api/sites/:slug/details", "/.netlify/functions/site-details"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json({
      status: "ok", service: "reddoor-site-details",
      env: {
        AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
        AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
        DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
      },
    }, { status: 200 });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return json({ ok: false, error: "unconfigured" }, 503);
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": 'Basic realm="Reddoor fleet"' });
  }
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) return json({ ok: false, error: "airtable-env-missing" }, 500);

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid-json" }, 400); }
  const b = (body as { field?: unknown; value?: unknown } | null) ?? {};
  const field = typeof b.field === "string" ? b.field : "";
  const value = typeof b.value === "string" ? b.value : "";

  try {
    const base = openBase({ apiKey, baseId });
    const result = await setSiteDetail(
      { getSite: (s) => getWebsiteBySlug(base, s), updateField: (id, col, val) => updateSiteField(base, id, col, val) },
      slug, field, value,
    );
    if (result.status === "bad-field") return json({ ok: false, error: "bad-field" }, 400);
    if (result.status === "invalid") return json({ ok: false, error: "invalid", field }, 400);
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("site-details", err);
  }
};
```

- [ ] **Step 3: Typecheck** — `pnpm typecheck`. Expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/index.ts netlify/functions/site-details.mts
git commit -m "feat(dashboard): authed /api/sites/:slug/details endpoint"
```

## Task B4: Editable site-details UI

**Files:**
- Modify: `src/dashboard/render.ts` (replace `siteDetailsSection` ~245 + page script ~410)
- Test: `tests/dashboard/render.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/dashboard/render.test.ts`:

```ts
describe("renderSiteDashboardHtml — editable site details", () => {
  it("renders Status + cadence as selects and POC as an input, with the editor wiring", () => {
    const html = renderForSite(makeWebsiteRow({ name: "Acme", status: "maintenance", pointOfContact: "a@b.com" }));
    // a select for Status, current value selected
    expect(html).toMatch(/<select[^>]*data-detail-field="status"[^>]*data-details-url="\/api\/sites\/acme\/details"/);
    expect(html).toContain('<option value="maintenance" selected');
    // a text input for the email field carrying its current value
    expect(html).toMatch(/data-detail-field="pointOfContact"/);
    expect(html).toContain('value="a@b.com"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm vitest run tests/dashboard/render.test.ts`

- [ ] **Step 3: Implement the editable section** — in `src/dashboard/render.ts`, import the allowlist + options:

```ts
import { EDITABLE_SITE_FIELDS, SITE_STATUS_OPTIONS, FREQ_OPTIONS } from "./site-details.js";
```

Replace `siteDetailsSection` with a version that renders an editable control per field. For each field key, derive its current value from the matching `WebsiteRow` property, and render:
- `enum` (status / maintenanceFreq / testingFreq) → `<select data-detail-field="KEY" data-details-url="/api/sites/SLUG/details">` with one `<option value="OPT"[ selected]>` per option (status uses `SITE_STATUS_OPTIONS`, freqs use `FREQ_OPTIONS`).
- `text` long (copyIntro/Contact/Footer) → `<textarea data-detail-field="KEY" data-details-url="...">VALUE</textarea>`.
- everything else (email/emails/gitrepo/short text) → `<input type="text" data-detail-field="KEY" data-details-url="..." value="ESCAPED_VALUE">`.

Use `siteSlug(site.name)` for SLUG and `escapeHtml` on every interpolated value. Keep the `<label>` text for each field (Point of contact, Report recipients (To)/(CC), Copy — Intro/Contact/Footer, Search query, GA4 property ID, Git repo, Status, Maintenance cadence, Testing cadence). Map each KEY to its `WebsiteRow` property: pointOfContact→`pointOfContact`, reportRecipientsTo→`reportRecipientsTo`, reportRecipientsCc→`reportRecipientsCc`, copyIntro→`copyIntro`, copyContact→`copyContact`, copyFooter→`copyFooter`, searchQuery→`searchQuery`, ga4PropertyId→`ga4PropertyId`, gitRepo→`gitRepo`, status→`status`, maintenanceFreq→`maintenanceFreq`, testingFreq→`testingFreq`. Render each as a `<div class="detail">` with a `<dt>` label and `<dd>` control. Append a per-field status span `<span class="detail-saved" data-for="KEY"></span>`.

- [ ] **Step 4: Add the page script** — in the per-site `<script>`, after the checklist handler, add a save-on-change/blur handler:

```js
    function saveDetail(el){
      var span = document.querySelector('.detail-saved[data-for="' + el.dataset.detailField + '"]');
      fetch(el.dataset.detailsUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: el.dataset.detailField, value: el.value }),
      }).then(function(r){ if (span) span.textContent = r.ok ? ' ✓' : ' ✗'; })
        .catch(function(){ if (span) span.textContent = ' ✗'; });
    }
    document.querySelectorAll('select[data-detail-field]').forEach(function(s){ s.addEventListener('change', function(){ saveDetail(s); }); });
    document.querySelectorAll('input[data-detail-field], textarea[data-detail-field]').forEach(function(i){
      i.addEventListener('blur', function(){ if (i.value !== i.defaultValue) saveDetail(i); });
    });
```

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm vitest run tests/dashboard/render.test.ts`

- [ ] **Step 6: Run the whole dashboard suite for regressions.** Run: `pnpm vitest run tests/dashboard`. Expected PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/render.ts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): inline-editable site details on the per-site page"
```

## Task B5: Changeset + full gate

**Files:**
- Create: `.changeset/interactive-cockpit.md`

- [ ] **Step 1: Changeset**

Create `.changeset/interactive-cockpit.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Interactive cockpit: a "Trigger Renovate" button on repo-backed cockpit cards
and per-site pages (authed POST /api/sites/:slug/trigger-renovate → dispatches
that repo's renovate.yml; needs RENOVATE_TOKEN in the dashboard env, degrades to
"not configured" without it), plus an inline site-details editor on /s/<slug>
for a safe-text + operational field allowlist (authed POST
/api/sites/:slug/details, validated + column-allowlisted before write).
```

- [ ] **Step 2: Full pre-merge gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist
```
All PASS. (`test:dist` confirms the two new `.mts` handlers resolve their `src/` imports.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/interactive-cockpit.md
git commit -m "chore: changeset for the interactive cockpit"
```

---

## Self-Review

**Spec coverage:** shared auth pattern (A2/B3 mirror report-checklist.mts) · A pure core + result union (A1) · A endpoint + token-gate/not-configured (A2) · A UI both places + repo-backed-only (A3) · B allowlist with EXACT columns + validators per kind (B1) · B writer (B2) · B endpoint (B3) · B editable UI with selects/inputs/textareas (B4) · ships-dark RENOVATE_TOKEN + changeset (A2/B5). All spec sections mapped.

**Type consistency:** `triggerRenovateForSite`/`TriggerRenovateResult`, `setSiteDetail`/`EDITABLE_SITE_FIELDS`/`normalizeFieldValue`/`SiteDetailResult`, `updateSiteField`, `SITE_STATUS_OPTIONS`/`FREQ_OPTIONS`, `RENOVATE_WORKFLOW_FILE`, data-attrs `data-trigger-url`/`data-detail-field`/`data-details-url` — used identically across tasks.

**No placeholders:** every code/test step shows real code; two steps (A3 render harness, B4 control rendering) instruct matching an existing render-test helper / per-kind control rather than guessing — real instructions, not TBDs. Column strings verified against `mapRow` (incl. `"maintenence freq"`, `"point of contact"`, `"Copy — Intro"`).
