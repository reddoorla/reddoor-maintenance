# Fleet Submissions Page + Attention-First Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filterable/searchable fleet-wide `/submissions` page backed by libSQL, and reorder the cockpit + per-site pages so attention content leads and the submissions/spam blocks sink to the bottom.

**Architecture:** Rides the existing seam — pure data-access functions (`src/db/submissions.ts`) + pure logic/render modules (`src/dashboard/`) composed by a thin Netlify handler. A new shared `submission-view.ts` holds the row renderer + status script both pages use, so they never drift.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` specifiers), Kysely over `@libsql/client`, vitest (tests in `tests/`), tsup bundle, Netlify functions (`.mts`).

Spec: `docs/superpowers/specs/2026-06-22-fleet-submissions-page-design.md`.

**Conventions to honor throughout:**

- `git add <explicit paths>` only — never `-A`/`.`. Never stage `.env`, `.env.example`, `dist/`, or the untracked `docs/morning-reports/*` / `docs/superpowers/plans/2026-06-15-*` files.
- All branches off the current `feat/submissions-page`. Commit per task.
- Run `pnpm lint` (prettier checks markdown + TS) before considering a task done; auto-fix locally.
- Strings rendered from data go through `escapeHtml` / `safeUrl`.

---

## Task 1: Extract shared submission-view module (behavior-preserving)

Move the per-row renderer + status client script + row styles out of `render.ts` into a new shared module, so the new page reuses them verbatim. **No behavior change** — existing per-site tests must still pass.

**Files:**

- Create: `src/dashboard/submission-view.ts`
- Modify: `src/dashboard/render.ts` (remove the moved code, import it back)
- Test: `tests/dashboard/submission-view.test.ts` (new), plus the existing `tests/dashboard/render-submissions.test.ts` must stay green.

- [ ] **Step 1: Write the failing test for the extracted renderer**

Create `tests/dashboard/submission-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  renderSubmissionRow,
  SUBMISSION_STATUS_SCRIPT,
} from "../../src/dashboard/submission-view.js";
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: "sub_1",
    submissionId: 7,
    siteId: "recSite",
    formType: "contact",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "555-1234",
    message: "Hello <there>",
    extraFields: null,
    sourceUrl: "https://example.com/contact",
    utm: null,
    submittedAt: "2026-06-20T10:00:00.000Z",
    status: "new",
    notifyStatus: "sent",
    resendMessageId: null,
    ...overrides,
  };
}

describe("renderSubmissionRow", () => {
  it("renders the form type, submitter, status pill, and triage buttons", () => {
    const html = renderSubmissionRow(row());
    expect(html).toContain("contact");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("pill subm-new");
    expect(html).toContain('data-status="read"');
    expect(html).toContain('data-status="archived"');
    expect(html).toContain('data-status="spam"');
    expect(html).toContain("/api/submissions/sub_1/status");
  });

  it("escapes hostile content in the message", () => {
    const html = renderSubmissionRow(row({ message: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("exposes the status client script as a string", () => {
    expect(SUBMISSION_STATUS_SCRIPT).toContain("button.subm-status");
    expect(SUBMISSION_STATUS_SCRIPT).toContain("b.dataset.status");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run tests/dashboard/submission-view.test.ts`
Expected: FAIL — `Cannot find module '../../src/dashboard/submission-view.js'`.

- [ ] **Step 3: Create the module by moving code verbatim from `render.ts`**

Create `src/dashboard/submission-view.ts`. Move these from `render.ts` **unchanged**: `extraFieldsList` (its current private helper, ~lines 168–188), `submissionRow` (lines 190–230, **rename the export to `renderSubmissionRow`**), the `.subm-*` + `.pill.subm-*` CSS rules (lines 356–373), and the `button.subm-status` listener block (lines 504–520).

```ts
import type { SubmissionRow } from "../reports/airtable/submissions.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

// ---- extraFieldsList (moved verbatim from render.ts) ----
function extraFieldsList(raw: string | null): string {
  // ...exact body moved from render.ts...
}

/** One submission as a <details> row with triage buttons. Moved verbatim from
 *  render.ts (was `submissionRow`) so the per-site page and the /submissions page
 *  render identical rows. */
export function renderSubmissionRow(s: SubmissionRow): string {
  // ...exact body of the former submissionRow...
}

/** The `button.subm-status` click→POST handler, as bare JS statements (no <script>
 *  wrapper) so each page can drop it into its own <script> block. Moved verbatim
 *  from render.ts. */
export const SUBMISSION_STATUS_SCRIPT = `
    document.querySelectorAll("button.subm-status").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(b.dataset.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: b.dataset.status }),
          });
          b.textContent = res.ok ? "✓" : "Failed";
          if (!res.ok) b.disabled = false;
        } catch {
          b.textContent = "Failed";
          b.disabled = false;
        }
      });
    });`;

/** The `.subm-*` row styles, shared by both pages. Moved verbatim from render.ts STYLES. */
export const SUBMISSION_STYLES = `
.subm-list { list-style: none; padding: 0; margin: 0; }
.subm-item { padding: 0.6rem 0; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { .subm-item { border-color: #2a2a2a; } }
.subm-head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.subm-msg { margin: 0.35rem 0; white-space: pre-wrap; }
.subm-detail { padding: 0.35rem 0 0.2rem; }
.subm-kv { font-size: 0.9rem; margin: 0.15rem 0; }
.subm-kv .k { color: #888; margin-right: 0.4rem; }
summary.subm-head { cursor: pointer; }
.subm-actions { display: flex; gap: 0.4rem; }
button.subm-status { font: inherit; padding: 0.25rem 0.7rem; border: 1px solid #888; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
button.subm-status:disabled { opacity: 0.6; cursor: default; }
.pill.subm-new { background: #e8f0fe; color: #1a56db; }
.pill.subm-read { background: #f0f0f0; color: #555; }
.pill.subm-archived { background: #eee; color: #888; }
.pill.subm-spam { background: #fdecea; color: #b00; }`;
```

> NOTE: copy the EXACT current bodies from `render.ts`. Do not paraphrase. If `extraFieldsList` is referenced anywhere else in `render.ts`, re-import it.

- [ ] **Step 4: Rewire `render.ts` to import the moved pieces**

In `src/dashboard/render.ts`:

- Add `import { renderSubmissionRow, SUBMISSION_STATUS_SCRIPT, SUBMISSION_STYLES } from "./submission-view.js";`
- Delete the moved `extraFieldsList` + `submissionRow` definitions and the `.subm-*` CSS from the `STYLES` constant and the `button.subm-status` block from the script.
- Replace the in-file `submissionRow(...)` call in `submissionsSection` with `renderSubmissionRow(...)`.
- Append the shared styles to the page: change `<style>${STYLES}</style>` → `<style>${STYLES}${SUBMISSION_STYLES}</style>`.
- In the page's `<script>`, where the `button.subm-status` block used to be inline, insert `${SUBMISSION_STATUS_SCRIPT}`.

- [ ] **Step 5: Run the full dashboard suite to prove behavior is preserved**

Run: `pnpm vitest run tests/dashboard/submission-view.test.ts tests/dashboard/render-submissions.test.ts`
Expected: PASS (new module tests + untouched per-site behavior).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/submission-view.ts src/dashboard/render.ts tests/dashboard/submission-view.test.ts
git commit -m "refactor(dashboard): extract shared submission-view module"
```

---

## Task 2: libSQL filtered query functions

Add `SubmissionFilter` + paginated `listSubmissionsFiltered` + `countSubmissionsFiltered`, sharing one WHERE builder.

**Files:**

- Modify: `src/db/submissions.ts`
- Test: `tests/db/submissions-filtered.test.ts` (new)

- [ ] **Step 1: Write failing tests against in-memory libSQL**

Create `tests/db/submissions-filtered.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  listSubmissionsFiltered,
  countSubmissionsFiltered,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

let db: Db;

async function seed() {
  // 3 sites, varied form types / statuses / dates
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Ada",
    email: "ada@x.com",
    phone: "1",
    message: "hire me please",
    extraFields: null,
    sourceUrl: null,
    utm: null,
    submittedAt: "2026-06-01T00:00:00.000Z",
    status: "new",
    notifyStatus: "sent",
    resendMessageId: null,
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "newsletter",
    name: "Bo",
    email: "bo@y.com",
    phone: null,
    message: null,
    extraFields: null,
    sourceUrl: null,
    utm: null,
    submittedAt: "2026-06-10T00:00:00.000Z",
    status: "read",
    notifyStatus: "sent",
    resendMessageId: null,
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "Cy",
    email: "cy@z.com",
    phone: null,
    message: "spammy text",
    extraFields: null,
    sourceUrl: null,
    utm: null,
    submittedAt: "2026-06-20T00:00:00.000Z",
    status: "spam",
    notifyStatus: "sent",
    resendMessageId: null,
  });
}

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  await seed();
});

describe("listSubmissionsFiltered / countSubmissionsFiltered", () => {
  it("returns all newest-first with an empty filter", async () => {
    const rows = await listSubmissionsFiltered(db, {}, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.email)).toEqual(["cy@z.com", "bo@y.com", "ada@x.com"]);
    expect(await countSubmissionsFiltered(db, {})).toBe(3);
  });

  it("filters by site, form type, and status", async () => {
    expect(
      (await listSubmissionsFiltered(db, { siteId: "recA" }, { limit: 50, offset: 0 })).length,
    ).toBe(2);
    expect(
      (await listSubmissionsFiltered(db, { formType: "contact" }, { limit: 50, offset: 0 })).length,
    ).toBe(2);
    expect(
      (await listSubmissionsFiltered(db, { status: "spam" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
  });

  it("searches name/email/message case-insensitively", async () => {
    expect(
      (await listSubmissionsFiltered(db, { search: "HIRE" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
    expect(
      (await listSubmissionsFiltered(db, { search: "z.com" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
    expect(await countSubmissionsFiltered(db, { search: "nomatch" })).toBe(0);
  });

  it("filters by date range inclusive", async () => {
    const rows = await listSubmissionsFiltered(
      db,
      { from: "2026-06-05T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["bo@y.com"]);
  });

  it("paginates with limit/offset; count ignores pagination", async () => {
    const page1 = await listSubmissionsFiltered(db, {}, { limit: 2, offset: 0 });
    const page2 = await listSubmissionsFiltered(db, {}, { limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
    expect(await countSubmissionsFiltered(db, {})).toBe(3);
  });

  it("combines filters", async () => {
    const rows = await listSubmissionsFiltered(
      db,
      { siteId: "recA", status: "new" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["ada@x.com"]);
  });
});
```

> If `openDb`'s config shape differs (check `readDbConfig`/`DbConfig`), match it — the existing screenouts/submissions tests show the exact in-memory open call; mirror them.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/db/submissions-filtered.test.ts`
Expected: FAIL — `listSubmissionsFiltered is not a function`.

- [ ] **Step 3: Implement in `src/db/submissions.ts`**

Add near the existing `listSubmissionsForSite`. Use Kysely's expression builder for the shared WHERE so `list` and `count` can't drift. (`rowFromDb`, `Db`, the `"submissions"` table, and column names already exist in this file — reuse them.)

```ts
import type { ExpressionBuilder } from "kysely";
import type { Database } from "./schema.js";
import type { FormType } from "../forms/types.js";
import type { SubmissionStatus } from "../reports/submission-row.js";

export type SubmissionFilter = {
  siteId?: string;
  formType?: FormType;
  status?: SubmissionStatus;
  search?: string; // LIKE %q% across name/email/message/phone, case-insensitive
  from?: string; // submitted_at >= from
  to?: string; // submitted_at <= to
};

/** Build the shared WHERE expression. Returns a literal-true when no filter is set
 *  so both list + count can apply it unconditionally. */
function submissionWhere(f: SubmissionFilter) {
  return (eb: ExpressionBuilder<Database, "submissions">) => {
    const conds = [];
    if (f.siteId) conds.push(eb("site_id", "=", f.siteId));
    if (f.formType) conds.push(eb("form_type", "=", f.formType));
    if (f.status) conds.push(eb("status", "=", f.status));
    if (f.from) conds.push(eb("submitted_at", ">=", f.from));
    if (f.to) conds.push(eb("submitted_at", "<=", f.to));
    if (f.search && f.search.trim() !== "") {
      const like = `%${f.search.trim().toLowerCase()}%`;
      conds.push(
        eb.or([
          eb(eb.fn("lower", ["name"]), "like", like),
          eb(eb.fn("lower", ["email"]), "like", like),
          eb(eb.fn("lower", ["message"]), "like", like),
          eb(eb.fn("lower", ["phone"]), "like", like),
        ]),
      );
    }
    return conds.length > 0 ? eb.and(conds) : eb.lit(true);
  };
}

export async function listSubmissionsFiltered(
  db: Db,
  filter: SubmissionFilter,
  opts: { limit: number; offset: number },
): Promise<SubmissionRow[]> {
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where(submissionWhere(filter))
    .orderBy("submitted_at", "desc")
    .limit(opts.limit)
    .offset(opts.offset)
    .execute();
  return rows.map(rowFromDb);
}

export async function countSubmissionsFiltered(db: Db, filter: SubmissionFilter): Promise<number> {
  const res = await db
    .selectFrom("submissions")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where(submissionWhere(filter))
    .executeTakeFirstOrThrow();
  return Number(res.n);
}
```

> Adapt the expression-builder calls to the installed Kysely version if the typecheck complains (e.g. `eb.lit` vs `eb.val`, `countAll` typing). The tests are the contract.

- [ ] **Step 4: Run tests to green**

Run: `pnpm vitest run tests/db/submissions-filtered.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add src/db/submissions.ts tests/db/submissions-filtered.test.ts
git commit -m "feat(db): filtered + paginated submissions queries"
```

---

## Task 3: Query parser + page model builder

Pure logic the handler will use: parse raw query params into a validated filter + page, and build the render model (enriching rows with site name/slug, computing pagination).

**Files:**

- Create: `src/dashboard/submissions-page.ts`
- Test: `tests/dashboard/submissions-page.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  parseSubmissionsQuery,
  buildSubmissionsPageModel,
  PAGE_SIZE,
} from "../../src/dashboard/submissions-page.js";
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

describe("parseSubmissionsQuery", () => {
  it("parses and validates params, ignoring junk", () => {
    const p = new URLSearchParams(
      "type=contact&status=spam&q=ada&from=2026-06-01&to=2026-06-30&page=3",
    );
    const r = parseSubmissionsQuery(p);
    expect(r.filter.formType).toBe("contact");
    expect(r.filter.status).toBe("spam");
    expect(r.filter.search).toBe("ada");
    expect(r.filter.from).toBe("2026-06-01");
    expect(r.page).toBe(3);
    expect(r.siteSlug).toBe("");
  });

  it("drops invalid enum values rather than throwing", () => {
    const r = parseSubmissionsQuery(new URLSearchParams("type=bogus&status=nope&page=-4"));
    expect(r.filter.formType).toBeUndefined();
    expect(r.filter.status).toBeUndefined();
    expect(r.page).toBe(1); // clamps to >= 1
  });

  it("captures the site slug for the handler to resolve", () => {
    expect(parseSubmissionsQuery(new URLSearchParams("site=erp-industrials")).siteSlug).toBe(
      "erp-industrials",
    );
  });
});

describe("buildSubmissionsPageModel", () => {
  const rows: SubmissionRow[] = [
    {
      id: "sub_1",
      submissionId: 1,
      siteId: "recA",
      formType: "contact",
      name: "Ada",
      email: "a@x.com",
      phone: null,
      message: null,
      extraFields: null,
      sourceUrl: null,
      utm: null,
      submittedAt: "2026-06-20T00:00:00.000Z",
      status: "new",
      notifyStatus: "sent",
      resendMessageId: null,
    },
  ];
  const sites = [
    { id: "recA", name: "Site A" },
    { id: "recB", name: "Site B" },
  ];

  it("enriches rows with site name + slug and computes pagination", () => {
    const model = buildSubmissionsPageModel({
      rows,
      total: 120,
      sites,
      filter: { siteId: "recA" },
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "" },
      page: 2,
    });
    expect(model.rows[0].siteName).toBe("Site A");
    expect(model.rows[0].slug).toBe("site-a");
    expect(model.page).toBe(2);
    expect(model.pageSize).toBe(PAGE_SIZE);
    expect(model.total).toBe(120);
    expect(model.sites.map((s) => s.slug)).toContain("site-a");
  });

  it("falls back to the raw site_id when no matching site is known", () => {
    const model = buildSubmissionsPageModel({
      rows: [{ ...rows[0], siteId: "recGHOST" }],
      total: 1,
      sites,
      filter: {},
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "" },
      page: 1,
    });
    expect(model.rows[0].siteName).toBe("recGHOST");
    expect(model.rows[0].slug).toBe("");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/dashboard/submissions-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/dashboard/submissions-page.ts`**

```ts
import type { SubmissionRow } from "../reports/airtable/submissions.js";
import { SUBMISSION_STATUSES, type SubmissionStatus } from "../reports/submission-row.js";
import { SUBMISSION_FORM_TYPES, type FormType } from "../forms/types.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { SubmissionFilter } from "../db/submissions.js";

export const PAGE_SIZE = 50;

export type RawFilter = {
  site: string;
  type: string;
  status: string;
  q: string;
  from: string;
  to: string;
};

export type ParsedQuery = {
  filter: SubmissionFilter;
  rawFilter: RawFilter;
  siteSlug: string;
  page: number;
};

export type SubmissionView = SubmissionRow & { siteName: string; slug: string };

export type SubmissionsPageModel = {
  rows: SubmissionView[];
  sites: Array<{ slug: string; name: string }>;
  filter: RawFilter; // active values, for repopulating the form
  page: number;
  pageSize: number;
  total: number;
};

function asFormType(v: string): FormType | undefined {
  return (SUBMISSION_FORM_TYPES as readonly string[]).includes(v) ? (v as FormType) : undefined;
}
function asStatus(v: string): SubmissionStatus | undefined {
  return (SUBMISSION_STATUSES as readonly string[]).includes(v)
    ? (v as SubmissionStatus)
    : undefined;
}

export function parseSubmissionsQuery(params: URLSearchParams): ParsedQuery {
  const site = params.get("site")?.trim() ?? "";
  const type = params.get("type")?.trim() ?? "";
  const status = params.get("status")?.trim() ?? "";
  const q = params.get("q")?.trim() ?? "";
  const from = params.get("from")?.trim() ?? "";
  const to = params.get("to")?.trim() ?? "";
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const filter: SubmissionFilter = {};
  const ft = asFormType(type);
  if (ft) filter.formType = ft;
  const st = asStatus(status);
  if (st) filter.status = st;
  if (q) filter.search = q;
  // Dates arrive as YYYY-MM-DD; widen `to` to end-of-day so the bound is inclusive.
  if (from) filter.from = from;
  if (to) filter.to = `${to}T23:59:59.999Z`;

  return { filter, rawFilter: { site, type, status, q, from, to }, siteSlug: site, page };
}

export function buildSubmissionsPageModel(input: {
  rows: SubmissionRow[];
  total: number;
  sites: Array<{ id: string; name: string }>;
  filter: SubmissionFilter;
  rawFilter: RawFilter;
  page: number;
}): SubmissionsPageModel {
  const byId = new Map(input.sites.map((s) => [s.id, s] as const));
  const rows: SubmissionView[] = input.rows.map((r) => {
    const site = byId.get(r.siteId);
    return { ...r, siteName: site?.name ?? r.siteId, slug: site ? siteSlug(site.name) : "" };
  });
  const sites = [...input.sites]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ slug: siteSlug(s.name), name: s.name }));
  return {
    rows,
    sites,
    filter: input.rawFilter,
    page: input.page,
    pageSize: PAGE_SIZE,
    total: input.total,
  };
}
```

> Resolve the real import for the `FormType` union members at author time (search for `SUBMISSION_FORM_TYPES` / where `FormType` is defined — likely `src/forms/types.ts` or `src/reports/submission-row.ts`). Use the actual exported constant; do not invent one.

- [ ] **Step 4: Run tests to green**

Run: `pnpm vitest run tests/dashboard/submissions-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
git add src/dashboard/submissions-page.ts tests/dashboard/submissions-page.test.ts
git commit -m "feat(dashboard): submissions page query parser + model builder"
```

---

## Task 4: Page renderer

`renderSubmissionsPageHtml(model)` → full HTML doc: filter form, result summary, rows (with site links), pagination, empty state. Reuses the shared row renderer + status script + styles.

**Files:**

- Create: `src/dashboard/submissions-page-render.ts`
- Test: `tests/dashboard/submissions-page-render.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderSubmissionsPageHtml } from "../../src/dashboard/submissions-page-render.js";
import type { SubmissionsPageModel } from "../../src/dashboard/submissions-page.js";

function model(over: Partial<SubmissionsPageModel> = {}): SubmissionsPageModel {
  return {
    rows: [
      {
        id: "sub_1",
        submissionId: 1,
        siteId: "recA",
        formType: "contact",
        name: "Ada",
        email: "a@x.com",
        phone: null,
        message: null,
        extraFields: null,
        sourceUrl: null,
        utm: null,
        submittedAt: "2026-06-20T00:00:00.000Z",
        status: "new",
        notifyStatus: "sent",
        resendMessageId: null,
        siteName: "Site A",
        slug: "site-a",
      },
    ],
    sites: [
      { slug: "site-a", name: "Site A" },
      { slug: "site-b", name: "Site B" },
    ],
    filter: { site: "", type: "contact", status: "", q: "", from: "", to: "" },
    page: 2,
    pageSize: 50,
    total: 120,
    ...over,
  };
}

describe("renderSubmissionsPageHtml", () => {
  it("renders the filter form with active values selected", () => {
    const html = renderSubmissionsPageHtml(model());
    expect(html).toContain("<form");
    expect(html).toContain('value="contact"'); // active type reflected (selected option)
    expect(html).toContain('name="q"');
    expect(html).toContain("Site A");
    expect(html).toContain("/s/site-a"); // each row links to its site
  });

  it("shows pagination that preserves filters and clamps edges", () => {
    const html = renderSubmissionsPageHtml(model({ page: 2, total: 120, pageSize: 50 }));
    expect(html).toMatch(/page=1/); // prev → page 1
    expect(html).toMatch(/page=3/); // next → page 3
    expect(html).toContain("type=contact"); // filter preserved in links
  });

  it("renders an empty state when total is 0", () => {
    const html = renderSubmissionsPageHtml(model({ rows: [], total: 0 }));
    expect(html.toLowerCase()).toContain("no submissions");
  });

  it("includes the status script + escapes hostile site names", () => {
    const html = renderSubmissionsPageHtml(
      model({
        rows: [{ ...model().rows[0], siteName: "<script>x</script>", slug: "x" }],
      }),
    );
    expect(html).toContain("button.subm-status");
    expect(html).not.toContain("<script>x</script>");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/dashboard/submissions-page-render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/dashboard/submissions-page-render.ts`**

Build a full document. Reuse `FAVICON_LINK`, `escapeHtml`, `renderSubmissionRow`, `SUBMISSION_STATUS_SCRIPT`, `SUBMISSION_STYLES`. Define a small page-chrome `STYLES` (body, h1, `.meta`, `.muted`, `.pill`, `.empty`, `.filters`, `.pager`, table). Key pieces:

```ts
import { FAVICON_LINK } from "./favicon.js";
import { escapeHtml } from "../util/html.js";
import {
  renderSubmissionRow,
  SUBMISSION_STATUS_SCRIPT,
  SUBMISSION_STYLES,
} from "./submission-view.js";
import { SUBMISSION_STATUSES } from "../reports/submission-row.js";
import { SUBMISSION_FORM_TYPES } from "../forms/types.js"; // same source as Task 3
import type { SubmissionsPageModel } from "./submissions-page.js";

const STYLES = `/* page chrome: body, h1, .meta, .muted, .pill, .empty, .filters, .pager, etc. */`;

function opt(value: string, label: string, active: string): string {
  const sel = value === active ? " selected" : "";
  return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label)}</option>`;
}

function filterForm(model: SubmissionsPageModel): string {
  const f = model.filter;
  const siteOpts = [
    '<option value="">All sites</option>',
    ...model.sites.map((s) => opt(s.slug, s.name, f.site)),
  ].join("");
  const typeOpts = [
    '<option value="">All types</option>',
    ...SUBMISSION_FORM_TYPES.map((t) => opt(t, t, f.type)),
  ].join("");
  const statusOpts = [
    '<option value="">All statuses</option>',
    ...SUBMISSION_STATUSES.map((s) => opt(s, s, f.status)),
  ].join("");
  return `<form class="filters" method="get" action="/submissions">
    <select name="site">${siteOpts}</select>
    <select name="type">${typeOpts}</select>
    <select name="status">${statusOpts}</select>
    <input type="search" name="q" placeholder="Search name/email/message" value="${escapeHtml(f.q)}" />
    <input type="date" name="from" value="${escapeHtml(f.from)}" />
    <input type="date" name="to" value="${escapeHtml(f.to)}" />
    <button type="submit">Apply</button>
    <a class="muted" href="/submissions">Clear</a>
  </form>`;
}

/** Build a querystring for a given page that preserves all active filters. */
function pageHref(model: SubmissionsPageModel, page: number): string {
  const p = new URLSearchParams();
  const f = model.filter;
  if (f.site) p.set("site", f.site);
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  p.set("page", String(page));
  return `/submissions?${p.toString()}`;
}

function pager(model: SubmissionsPageModel): string {
  const pages = Math.max(1, Math.ceil(model.total / model.pageSize));
  if (pages <= 1) return "";
  const prev =
    model.page > 1
      ? `<a href="${escapeHtml(pageHref(model, model.page - 1))}">← Prev</a>`
      : `<span class="muted">← Prev</span>`;
  const next =
    model.page < pages
      ? `<a href="${escapeHtml(pageHref(model, model.page + 1))}">Next →</a>`
      : `<span class="muted">Next →</span>`;
  return `<div class="pager">${prev}<span class="muted">Page ${model.page} of ${pages}</span>${next}</div>`;
}

function rowWithSite(r: SubmissionsPageModel["rows"][number]): string {
  // Prefix the shared row with a site link, since this page is cross-site.
  const siteLink = r.slug
    ? `<a class="subm-site" href="/s/${escapeHtml(r.slug)}">${escapeHtml(r.siteName)}</a>`
    : `<span class="subm-site muted">${escapeHtml(r.siteName)}</span>`;
  return `<div class="subm-row-wrap">${siteLink}${renderSubmissionRow(r)}</div>`;
}

export function renderSubmissionsPageHtml(model: SubmissionsPageModel): string {
  const body =
    model.total === 0
      ? `<div class="empty">No submissions match these filters.</div>`
      : `<div class="meta">${model.total} submission${model.total === 1 ? "" : "s"}</div>
         <ul class="subm-list">${model.rows.map(rowWithSite).join("")}</ul>
         ${pager(model)}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>Submissions — Reddoor maintenance</title>
  <style>${STYLES}${SUBMISSION_STYLES}</style>
</head>
<body>
  <a class="home" href="/">← Fleet home</a>
  <h1>Submissions</h1>
  ${filterForm(model)}
  ${body}
  <script>${SUBMISSION_STATUS_SCRIPT}</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests to green**

Run: `pnpm vitest run tests/dashboard/submissions-page-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
git add src/dashboard/submissions-page-render.ts tests/dashboard/submissions-page-render.test.ts
git commit -m "feat(dashboard): submissions page renderer"
```

---

## Task 5: Netlify handler + exports

The thin `.mts` handler: auth, parse query, resolve slug, fetch websites + submissions, render. Plus re-export the new public surface from `src/dashboard/index.ts`.

**Files:**

- Create: `netlify/functions/submissions-page.mts`
- Modify: `src/dashboard/index.ts`

- [ ] **Step 1: Export new surface from `src/dashboard/index.ts`**

```ts
export { renderSubmissionsPageHtml } from "./submissions-page-render.js";
export { parseSubmissionsQuery, buildSubmissionsPageModel, PAGE_SIZE } from "./submissions-page.js";
export type {
  SubmissionsPageModel,
  SubmissionView,
  ParsedQuery,
  RawFilter,
} from "./submissions-page.js";
```

- [ ] **Step 2: Write the handler** `netlify/functions/submissions-page.mts`

Model it on `site-dashboard.mts` (auth, env checks, defensive structure). Submissions are the whole page here, so the DB is a hard dependency — a DB open failure falls to `handlerError` (retryable 502).

```ts
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { listWebsites, siteSlug } from "../../src/reports/airtable/websites.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSubmissionsFiltered, countSubmissionsFiltered } from "../../src/db/submissions.js";
import {
  verifyBasicAuth,
  renderSubmissionsPageHtml,
  parseSubmissionsQuery,
  buildSubmissionsPageModel,
  PAGE_SIZE,
} from "../../src/dashboard/index.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

export const config: Config = {
  path: ["/submissions", "/.netlify/functions/submissions-page"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};

function plainText(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });
}
function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[submissions-page] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submissions-page] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[submissions-page] DASHBOARD_PASSWORD missing");
    return plainText(
      "Submissions page is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  try {
    const base = openBase({ apiKey, baseId });
    const db = await openDb(readDbConfig());
    const {
      filter,
      rawFilter,
      siteSlug: slug,
      page,
    } = parseSubmissionsQuery(new URL(req.url).searchParams);

    const websites = await listWebsites(base);
    // Resolve the site slug → site_id (ignore an unmatched slug = no site filter).
    if (slug) {
      const match = websites.find((w) => siteSlug(w.name) === slug);
      if (match) filter.siteId = match.id;
    }

    const [rows, total] = await Promise.all([
      listSubmissionsFiltered(db, filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      countSubmissionsFiltered(db, filter),
    ]);

    const model = buildSubmissionsPageModel({
      rows,
      total,
      sites: websites.map((w) => ({ id: w.id, name: w.name })),
      filter,
      rawFilter,
      page,
    });
    return html(renderSubmissionsPageHtml(model), 200);
  } catch (err) {
    return handlerError("submissions-page", err);
  }
};
```

- [ ] **Step 3: Typecheck (covers `.mts` via tsconfig.netlify.json) + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. Fix any import-path / type mismatches.

- [ ] **Step 4: Build + smoke the bundle**

Run: `pnpm build && pnpm test:dist`
Expected: PASS (no new CLI subcommand, so `smoke-dist` is unaffected — this just confirms the build still bundles cleanly).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/submissions-page.mts src/dashboard/index.ts
git commit -m "feat(dashboard): /submissions handler + exports"
```

---

## Task 6: Cockpit reorder + "View all" link

Move the spam roll-up + submissions strip below the tier sections; link the strip to `/submissions`.

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts` and/or `tests/dashboard/fleet-render-submissions.test.ts`

- [ ] **Step 1: Write/extend a failing ordering test**

Add to the cockpit render tests:

```ts
it("orders attention content before the spam + submissions blocks", () => {
  // model with at least one card, a spam rollup, and one submission entry
  const html = renderCockpitHtml(modelWithEverything());
  const approveIdx = html.indexOf("approve-strip");
  const tiersIdx = html.indexOf('data-tier="attention"');
  const spamIdx = html.indexOf("spam-rollup"); // or the spamRollup section's marker class
  const submIdx = html.indexOf("subm-strip");
  expect(approveIdx).toBeGreaterThan(-1);
  expect(tiersIdx).toBeLessThan(spamIdx); // tiers come before spam
  expect(spamIdx).toBeLessThan(submIdx); // spam before submissions
  expect(submIdx).toBeGreaterThan(tiersIdx); // submissions after tiers
});

it("links the submissions strip to the full /submissions page", () => {
  const html = renderCockpitHtml(modelWithSubmissions());
  expect(html).toContain('href="/submissions"');
});
```

> Use the existing test's model-builder helpers; check the real marker classes (`spamRollup` likely emits a `.spam-rollup` section — confirm and assert on the actual class/text).

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts tests/dashboard/fleet-render-submissions.test.ts`
Expected: FAIL on ordering / missing link.

- [ ] **Step 3: Reorder the assembly in `renderCockpitHtml`**

Change the body block (currently lines ~378–384):

```ts
  ${summaryBar(model)}
  ${allClearBanner(model)}
  ${approveStrip(model)}
  ${sections}
  ${spamRollup(model)}
  ${submissionsStrip(model)}
  ${FILTER_SCRIPT}
```

(Removed `spamRollup` + `submissionsStrip` from their old spots above; placed both after `${sections}`.)

- [ ] **Step 4: Add the "View all →" link in `submissionsStrip`**

In the `submissionsStrip` heading and the overflow line, point to the full page:

```ts
return `<section class="approve-strip subm-strip" data-tier="submissions">
    <h2>📥 New submissions (${subs.length}) <a class="subm-viewall" href="/submissions">View all →</a></h2>
    ${rows}${more}
  </section>`;
```

And change the overflow `more` link target to `/submissions`:

```ts
      ? `<div class="approve-row subm-more muted"><a href="/submissions">+${overflow} more — view all submissions</a></div>`
```

- [ ] **Step 5: Run tests to green; typecheck + lint**

Run: `pnpm vitest run tests/dashboard/ && pnpm typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts tests/dashboard/fleet-render-submissions.test.ts
git commit -m "feat(dashboard): cockpit attention-first order + submissions link"
```

---

## Task 7: Per-site reorder (spam + submissions to bottom) + "View all" link

Move `spamScreenSection` + `submissionsSection` to the very bottom; link the submissions heading to `/submissions?site=<slug>`.

**Files:**

- Modify: `src/dashboard/render.ts`
- Test: `tests/dashboard/render-submissions.test.ts` (+ a render ordering test)

- [ ] **Step 1: Write/extend a failing ordering test**

```ts
it("places spam + submissions below site details", () => {
  const html = renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date());
  const detailsIdx = html.indexOf(
    "siteDetails" /* or the real site-details marker, e.g. class 'details' heading */,
  );
  const spamIdx = html.indexOf("spam-screen"); // confirm the real class from spamScreenSection
  const submIdx = html.indexOf('class="section submissions"');
  expect(detailsIdx).toBeLessThan(spamIdx);
  expect(spamIdx).toBeLessThan(submIdx); // spam screen, then submissions dead last
});

it("links the submissions heading to the filtered /submissions page", () => {
  const html = renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date());
  expect(html).toContain(`/submissions?site=${siteSlug(site.name)}`);
});
```

> Confirm the real DOM markers: `siteDetailsSection`, `spamScreenSection`, and the submissions `<div class="section submissions">` heading. Assert on actual emitted strings.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run tests/dashboard/render-submissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reorder the body in `renderSiteDashboardHtml`**

Move `${submissionsSection(submissions)}` (currently right after `pendingSection`) and `${spamScreenSection(spamTotals, submissions, now)}` (currently between security and Reports) to the very bottom — after `${siteDetailsSection(site)}`, before the `<script>`:

```ts
  ${auditedLine}
  ${setupSection(site)}
  ${pendingSection(reports)}

  <div class="section">
    <h2>Lighthouse</h2>
    ${scoresSection}
  </div>

  <div class="section">
    <h2>Site Health</h2>
    ${healthSection}
  </div>

  ${securitySection(site)}

  <div class="section">
    <h2>Reports</h2>
    ${reportsSection}
  </div>

  ${siteDetailsSection(site)}
  ${spamScreenSection(spamTotals, submissions, now)}
  ${submissionsSection(submissions, site)}
  <script>
```

(Removed `${submissionsSection(...)}` from after `pendingSection` and `${spamScreenSection(...)}` from after `securitySection`.)

- [ ] **Step 4: Add the "View all for this site →" link in `submissionsSection`**

`submissionsSection` needs the site slug for the link. Give it the `WebsiteRow` (or just the slug):

```ts
function submissionsSection(submissions: SubmissionRow[], site: WebsiteRow): string {
  if (submissions.length === 0) return "";
  // ...existing recent slice + note...
  const viewAll = `<a class="subm-viewall" href="/submissions?site=${escapeHtml(siteSlug(site.name))}">View all for this site →</a>`;
  return `<div class="section submissions">
    <h2>Form submissions (${submissions.length})${note} ${viewAll}</h2>
    <ul class="subm-list">${recent.map(renderSubmissionRow).join("")}</ul>
  </div>`;
}
```

Import `siteSlug` from `../reports/airtable/websites.js` if not already imported. Update the call site to pass `site`.

> If `submissions.length === 0` the section returns "" (no link) — that's fine; an empty site needs no "view all".

- [ ] **Step 5: Run tests to green; typecheck + lint**

Run: `pnpm vitest run tests/dashboard/ && pnpm typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/render.ts tests/dashboard/render-submissions.test.ts
git commit -m "feat(dashboard): per-site spam+submissions to bottom + view-all link"
```

---

## Task 8: Changeset + full-suite gate

**Files:**

- Create: `.changeset/fleet-submissions-page.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

Add a fleet-wide `/submissions` page (filter by site/type/status/date + text search, paginated, with per-row triage) and reorder the cockpit + per-site dashboards so attention content leads and the spam + submissions blocks sink to the bottom.
```

- [ ] **Step 2: Run the FULL gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green. (`pnpm test:dist` is required per repo convention — `build` passing alone won't catch a removed/renamed public export.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/fleet-submissions-page.md
git commit -m "chore: changeset for fleet submissions page"
```

---

## Final review

After all tasks: dispatch a final code-reviewer over the whole branch diff against this plan + the spec, then use superpowers:finishing-a-development-branch to open the PR. The PR is a `feat` → auto-merge once CI build=success + mergeable CLEAN + review-clean (SHA-gated squash), per the merge-authority policy. Not a release PR, so no human gate.

**Manual follow-up (out of band):** none — no new env vars (reuses `DASHBOARD_PASSWORD`, `TURSO_DATABASE_URL`, `AIRTABLE_*`). The `/submissions` route ships with the deploy.

## Self-review notes (author)

- Spec coverage: page (T2–T5), filters/search/pagination/triage (T2–T5), DRY extraction (T1), cockpit reorder (T6), per-site reorder incl. spam→bottom (T7), tests + changeset (T8). ✓
- Type consistency: `SubmissionFilter` defined in T2, consumed in T3/T5; `SubmissionsPageModel`/`RawFilter`/`SubmissionView` defined in T3, consumed in T4/T5; `renderSubmissionRow`/`SUBMISSION_STATUS_SCRIPT`/`SUBMISSION_STYLES` defined in T1, consumed in T4/T7. ✓
- Open verification points flagged inline for implementers (real source of the `FormType` union + `SUBMISSION_FORM_TYPES`; real marker classes for ordering asserts; exact `openDb(:memory:)` config shape; Kysely expression-builder API of the installed version). These are "confirm against the codebase," not placeholders.
