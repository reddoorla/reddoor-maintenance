# Search-Presence via Search Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead Custom Search data layer with the Google Search Console Search Analytics API and surface a site's page-1 rank in the report email's "Google Indexed" row.

**Architecture:** Reuse the GA service-account domain-wide delegation (add scope `webmasters.readonly`). A rewritten `fetchSearchPresence` resolves the site's SC property (explicit Airtable value, else auto-resolve from `sites.list` — Domain or URL-prefix), queries the average position for the per-site query over the report period, and returns `{ foundOnPage1, position }`. The draft flow soft-fetches it (like GA users), stores it on the Reports row, and the template enriches the "Google Indexed" row to `Page 1 Google Result (#N)` when on page 1 (positive-only; the negative is operator-only in Airtable).

**Tech Stack:** TypeScript, `google-auth-library` (JWT), Search Console API (REST via `jwt.request`), Airtable JS SDK, MJML, vitest, pnpm, tsup, changesets.

**Branch:** `feat/search-presence-console` (already created).

---

## File Structure

- **Rewrite** `src/reports/search/client.ts` — SC client: `fetchSearchPresence`, `resolveProperty`, `bareHost`. Replaces the Custom Search impl.
- **Delete** `src/reports/search/config.ts` — obsolete (`GOOGLE_SEARCH_*`); search now uses `readGaConfig()`.
- **Rewrite** `tests/reports/search/client.test.ts`; **delete** `tests/reports/search/config.test.ts`.
- **Modify** `src/reports/airtable/websites.ts` — `WebsiteRow.searchConsoleProperty` + `mapRow`.
- **Modify** `src/reports/airtable/reports.ts` — `DraftInput` + `createDraft` write two fields; `ReportRow` + `mapRow` read them.
- **Modify** `src/reports/types.ts` — `ReportData.searchPosition`.
- **Modify** `src/reports/maintenance-email/template.ts` — `maintenanceChecksSection(searchPosition?)` + `buildMjml`.
- **Modify** `src/reports/draft.ts` — `fetchSearch()` soft-fetch + wire into render + `createDraft`.
- **Modify** `src/reports/send/orchestrate.ts` — pass stored `searchPosition` into render.
- **Modify** fixtures: `tests/reports/render.test.ts`, `tests/reports/draft.test.ts`, `tests/reports/send/orchestrate.test.ts`, `tests/reports/due.test.ts`, `tests/dashboard/{onboarding,fleet-render,render}.test.ts`, `tests/audits/write-audits-to-airtable.test.ts`.
- **Airtable** (MCP, one-time): Websites "Search Console property"; Reports "Search found page 1" + "Search position".
- **Add** `.changeset/search-presence-console.md`.

---

## Task 1: Rewrite the Search Console client

**Files:**

- Rewrite: `src/reports/search/client.ts`
- Rewrite: `tests/reports/search/client.test.ts`

- [ ] **Step 1: Replace the test file with the Search Console version**

Overwrite `tests/reports/search/client.test.ts` entirely:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const request = vi.fn();
vi.mock("google-auth-library", () => ({
  // Constructable mock — `new JWT(...)`. Arrow fns can't be `new`ed.
  JWT: vi.fn().mockImplementation(function (opts: unknown) {
    return { __opts: opts, request };
  }),
}));

import {
  fetchSearchPresence,
  resolveProperty,
  bareHost,
} from "../../../src/reports/search/client.js";
import { JWT } from "google-auth-library";

// Real temp key file (JWT is mocked, so contents need only be valid JSON).
const keyPath = join(tmpdir(), `sc-key-${process.pid}.json`);
writeFileSync(
  keyPath,
  JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: "PEM" }),
);

const start = new Date("2026-04-30T00:00:00Z");
const end = new Date("2026-05-30T00:00:00Z");

/** A gaxios-shaped response. */
function ok(data: unknown) {
  return { data };
}

beforeEach(() => {
  request.mockReset();
  vi.mocked(JWT).mockClear();
});

describe("bareHost", () => {
  it("strips sc-domain, scheme, www, path, and lowercases", () => {
    expect(bareHost("sc-domain:ERPFunds.com")).toBe("erpfunds.com");
    expect(bareHost("https://www.erpfunds.com/about")).toBe("erpfunds.com");
    expect(bareHost("http://erpfunds.com")).toBe("erpfunds.com");
  });
});

describe("resolveProperty", () => {
  const entries = [
    { siteUrl: "https://www.erpfunds.com/" },
    { siteUrl: "sc-domain:erpfunds.com" },
    { siteUrl: "https://other.com/" },
  ];
  it("prefers the sc-domain form when both match", () => {
    expect(resolveProperty(entries, "erpfunds.com")).toBe("sc-domain:erpfunds.com");
  });
  it("falls back to a URL-prefix property when no Domain property exists", () => {
    expect(resolveProperty([{ siteUrl: "https://www.only-prefix.com/" }], "only-prefix.com")).toBe(
      "https://www.only-prefix.com/",
    );
  });
  it("returns null when nothing matches", () => {
    expect(resolveProperty(entries, "nope.com")).toBeNull();
  });
});

describe("fetchSearchPresence", () => {
  it("queries the given property and returns rounded avg position + page-1 flag", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 1.52, impressions: 31 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subject: "tucker@reddoorla.com",
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "ERP funds",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 2 });
    // One call only — no sites.list when property is explicit.
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0]![0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain(encodeURIComponent("sc-domain:erpfunds.com"));
    expect(call.data.startDate).toBe("2026-04-30");
    expect(call.data.endDate).toBe("2026-05-30");
    // Query filter is lowercased.
    expect(call.data.dimensionFilterGroups[0].filters[0].expression).toBe("erp funds");
  });

  it("auto-resolves the property via sites.list when none is given", async () => {
    request
      .mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:erpfunds.com" }] })) // sites.list
      .mockResolvedValueOnce(ok({ rows: [{ position: 8 }] })); // query
    const out = await fetchSearchPresence(
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "erp funds" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 8 });
    expect(request.mock.calls[0]![0].url).toContain("/sites");
    expect(request.mock.calls[0]![0].method).toBe("GET");
    expect(request.mock.calls[1]![0].url).toContain(encodeURIComponent("sc-domain:erpfunds.com"));
  });

  it("returns not-found without querying when no property resolves", async () => {
    request.mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:other.com" }] }));
    const out = await fetchSearchPresence(
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "q" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
    expect(request).toHaveBeenCalledTimes(1); // sites.list only, no query
  });

  it("returns not-found when the query has no rows (zero impressions)", async () => {
    request.mockResolvedValueOnce(ok({ rows: [] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subject: "s@x.com",
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "q",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
  });

  it("treats an average position worse than 10 as not on page 1", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 14.2 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subject: "s@x.com",
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "q",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: 14 });
  });

  it("builds the JWT with the webmasters.readonly scope + impersonation subject", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 1 }] }));
    await fetchSearchPresence(
      {
        keyPath,
        subject: "imp@reddoorla.com",
        property: "sc-domain:x.com",
        host: "x.com",
        query: "q",
      },
      start,
      end,
    );
    const opts = vi.mocked(JWT).mock.calls[0]![0] as {
      subject: string;
      scopes: string[];
      email: string;
    };
    expect(opts.subject).toBe("imp@reddoorla.com");
    expect(opts.scopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    expect(opts.email).toBe("sa@proj.iam.gserviceaccount.com");
  });

  it("propagates API errors so the caller can soft-fail", async () => {
    request.mockRejectedValueOnce(new Error("403 PERMISSION_DENIED"));
    await expect(
      fetchSearchPresence(
        { keyPath, subject: "s@x.com", property: "sc-domain:x.com", host: "x.com", query: "q" },
        start,
        end,
      ),
    ).rejects.toThrow("403");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/reports/search/client.test.ts`
Expected: FAIL — `resolveProperty`/`bareHost` not exported, signature mismatch (old client took `apiKey`/`engineId`).

- [ ] **Step 3: Rewrite the client**

Overwrite `src/reports/search/client.ts` entirely:

```typescript
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

const WEBMASTERS_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
const SC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
/** Average-position threshold for "on page 1" (10 organic results per page). */
const PAGE_1_MAX_POSITION = 10;

export type SearchPresenceQuery = {
  /** Path to the service-account JSON key (same one GA uses). */
  keyPath: string;
  /** Workspace user to impersonate via domain-wide delegation. */
  subject: string;
  /** Explicit Search Console property (`sc-domain:...` or `https://.../`). Overrides auto-resolution. */
  property?: string | undefined;
  /** Site host, used to auto-resolve the property from `sites.list` when `property` is absent. */
  host: string;
  /** Operator-supplied query string (e.g. the business name). */
  query: string;
};

export type SearchPresence = {
  /** True when the average position for the query is on page 1 (<= 10). */
  foundOnPage1: boolean;
  /** Rounded average position, or null when not found / no data. */
  position: number | null;
};

type SiteEntry = { siteUrl: string };

/** Reduce any property string or URL to a bare host: no `sc-domain:`, scheme, `www.`, path, lowercased. */
export function bareHost(s: string): string {
  return s
    .trim()
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Pick the Search Console property matching `host` from the list the identity can see.
 * Accepts Domain (`sc-domain:`) and URL-prefix properties; prefers the Domain form on a tie
 * (broadest coverage). Returns null when nothing matches.
 */
export function resolveProperty(entries: SiteEntry[], host: string): string | null {
  const target = bareHost(host);
  const matches = entries.filter((e) => bareHost(e.siteUrl) === target);
  if (matches.length === 0) return null;
  const domain = matches.find((e) => e.siteUrl.toLowerCase().startsWith("sc-domain:"));
  return (domain ?? matches[0]!).siteUrl;
}

/** UTC YYYY-MM-DD — matches the rest of the reports pipeline. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Query Google Search Console for the average position of `query` on the site over the report
 * period, via a domain-wide-delegation service account impersonating `subject`. Resolves the
 * property from `property` (verbatim) or auto-discovers it via `sites.list`. Throws on any
 * auth/API error — the caller (draftReportForSite) soft-fails.
 */
export async function fetchSearchPresence(
  q: SearchPresenceQuery,
  periodStart: Date,
  periodEnd: Date,
): Promise<SearchPresence> {
  const key = JSON.parse(readFileSync(q.keyPath, "utf8")) as {
    client_email: string;
    private_key: string;
  };
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [WEBMASTERS_READONLY],
    subject: q.subject,
  });

  let property = q.property?.trim() || null;
  if (!property) {
    const list = await jwt.request<{ siteEntry?: SiteEntry[] }>({
      url: `${SC_BASE}/sites`,
      method: "GET",
    });
    property = resolveProperty(list.data.siteEntry ?? [], q.host);
    if (!property) return { foundOnPage1: false, position: null };
  }

  const res = await jwt.request<{ rows?: Array<{ position?: number }> }>({
    url: `${SC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    method: "POST",
    data: {
      startDate: ymd(periodStart),
      endDate: ymd(periodEnd),
      dimensions: ["query"],
      dimensionFilterGroups: [
        {
          filters: [{ dimension: "query", operator: "equals", expression: q.query.toLowerCase() }],
        },
      ],
      rowLimit: 1,
    },
  });

  const pos = res.data.rows?.[0]?.position;
  if (typeof pos !== "number") return { foundOnPage1: false, position: null };
  return { foundOnPage1: pos <= PAGE_1_MAX_POSITION, position: Math.round(pos) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/reports/search/client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/reports/search/client.ts tests/reports/search/client.test.ts
git commit -m "feat(search): Search Console client (avg position) replacing Custom Search"
```

---

## Task 2: Delete the obsolete search config

**Files:**

- Delete: `src/reports/search/config.ts`
- Delete: `tests/reports/search/config.test.ts`

- [ ] **Step 1: Confirm nothing else imports the config**

Run: `git grep -n "search/config\|readSearchConfig" -- src tests`
Expected: only the two files about to be deleted (the rewritten client no longer imports `SearchApiConfig`). If anything else appears, stop and fix it before deleting.

- [ ] **Step 2: Delete both files**

```bash
git rm src/reports/search/config.ts tests/reports/search/config.test.ts
```

- [ ] **Step 3: Typecheck to confirm no dangling imports**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no "cannot find module" for `search/config`).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(search): drop obsolete GOOGLE_SEARCH_* config (search uses GA delegation)"
```

---

## Task 3: Add `searchConsoleProperty` to `WebsiteRow`

**Files:**

- Modify: `src/reports/airtable/websites.ts`

- [ ] **Step 1: Add the field to the `WebsiteRow` type**

In `src/reports/airtable/websites.ts`, directly after the `searchQuery` field (around line 31), add:

```typescript
/** Explicit Search Console property for this site (`sc-domain:...` or `https://.../`).
 *  Null = auto-resolve from the SA's visible properties by host. */
searchConsoleProperty: string | null;
```

- [ ] **Step 2: Map it in `mapRow`**

In `mapRow`, directly after the `searchQuery:` line (around line 83), add:

```typescript
    searchConsoleProperty: (f["Search Console property"] as string | undefined) ?? null,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — every `WebsiteRow` fixture in tests now misses `searchConsoleProperty`. (Fixtures are fixed in Task 9; this confirms the field is required.)

- [ ] **Step 4: Commit**

```bash
git add src/reports/airtable/websites.ts
git commit -m "feat(airtable): WebsiteRow.searchConsoleProperty (Search Console property override)"
```

---

## Task 4: Create the Airtable columns (one-time, MCP)

**Tooling:** Airtable MCP (`mcp__airtable__create_field`, `mcp__airtable__list_tables`). Websites table ID is `tblerElkKDif2VqrO`. The base ID and Reports table ID are discovered in Step 1.

> Idempotent: if a field already exists, `create_field` errors — that's fine, skip it.

- [ ] **Step 1: Get the base ID + Reports table ID**

Use `mcp__airtable__list_bases` to get the base ID, then `mcp__airtable__list_tables` (detail level `tableIdentifiersOnly`) for that base. Record the Reports table ID (look for the table named "Reports").

- [ ] **Step 2: Create "Search Console property" on Websites**

`mcp__airtable__create_field` with: baseId=<base>, tableId=`tblerElkKDif2VqrO`, name=`Search Console property`, type=`singleLineText`.

- [ ] **Step 3: Create "Search found page 1" on Reports**

`mcp__airtable__create_field` with: baseId=<base>, tableId=<Reports>, name=`Search found page 1`, type=`checkbox`, options=`{ "icon": "check", "color": "greenBright" }`.

- [ ] **Step 4: Create "Search position" on Reports**

`mcp__airtable__create_field` with: baseId=<base>, tableId=<Reports>, name=`Search position`, type=`number`, options=`{ "precision": 0 }`.

- [ ] **Step 5: No commit (Airtable schema, not code).** Note completion in the task checklist.

---

## Task 5: Surface the rank in the email template

**Files:**

- Modify: `src/reports/types.ts`
- Modify: `src/reports/maintenance-email/template.ts`
- Test: `tests/reports/render.test.ts`

- [ ] **Step 1: Add `searchPosition` to `ReportData`**

In `src/reports/types.ts`, directly after the `gaUsersPrevious?` field, add:

```typescript
  /** Site's rounded average Google position for its query, when on page 1 (from Search Console).
   *  `undefined` = not on page 1, not checked, or unconfigured — rendered as today's plain check. */
  searchPosition?: number | undefined;
```

- [ ] **Step 2: Write the failing render tests**

In `tests/reports/render.test.ts`, add inside the top-level `describe` (use the existing `baseData(...)` helper and `renderReportHtml`):

```typescript
it("enriches the Google Indexed row with the rank when on page 1", async () => {
  const { html } = await renderReportHtml(baseData({ searchPosition: 2 }));
  expect(html).toContain("Page 1 Google Result (#2)");
  expect(html).not.toMatch(/>Google Indexed</);
});

it("renders the plain Google Indexed row when no search position", async () => {
  const { html } = await renderReportHtml(baseData({ searchPosition: undefined }));
  expect(html).toContain("Google Indexed");
  expect(html).not.toContain("Page 1 Google Result");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/reports/render.test.ts`
Expected: FAIL — "Page 1 Google Result" not present (template ignores `searchPosition`).

- [ ] **Step 4: Thread `searchPosition` through the template**

In `src/reports/maintenance-email/template.ts`, change `maintenanceChecksSection` to accept the position and rewrite the "Google Indexed" label conditionally. Replace the function definition (lines ~68-92):

```typescript
function maintenanceChecksSection(searchPosition?: number): string {
  const googleLabel =
    searchPosition !== undefined ? `Page 1 Google Result (#${searchPosition})` : "Google Indexed";
  const rows = [
    "Reviewed Logs",
    "CMS Checked",
    "DNS Checked",
    googleLabel,
    "Reviewed Certificate",
    "Security Updates",
  ];
  return rows
    .map(
      (label, i) => `
    <mj-section background-color="white" padding="0px"${i === rows.length - 1 ? ' padding-bottom="36px"' : ""}>
      <mj-group>
        <mj-column padding-left="0px" width="90%"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""}>
          <mj-text height="25px" padding-left="0px" color="#757575" padding-top="20px" padding-bottom="7.5px" font-size="16px">${label}</mj-text>
        </mj-column>
        <mj-column width="10%"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""} padding-top="15px">
          <mj-image align="right" padding-right="0px" width="20px" height="20px" padding-top="2.5px" padding-bottom="15px" src="${CHECK_PNG}" />
        </mj-column>
      </mj-group>
    </mj-section>`,
    )
    .join("");
}
```

(The labels are static/internal — no `escapeXml` needed; the operator query never reaches the template, only the integer rank does.)

- [ ] **Step 5: Pass `data.searchPosition` at the call site**

In `buildMjml`, change the `${maintenanceChecksSection()}` call (around line 213) to:

```typescript
    ${maintenanceChecksSection(data.searchPosition)}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm exec vitest run tests/reports/render.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/reports/types.ts src/reports/maintenance-email/template.ts tests/reports/render.test.ts
git commit -m "feat(reports): enrich 'Google Indexed' row with page-1 rank"
```

---

## Task 6: Store the result on the Reports row

**Files:**

- Modify: `src/reports/airtable/reports.ts`
- Test: `tests/reports/reports-row.test.ts` (create)

- [ ] **Step 1: Write the failing round-trip test**

Create `tests/reports/reports-row.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createDraft } from "../../src/reports/airtable/reports.js";

/** Minimal Airtable base stub: captures the fields passed to create(), echoes them back. */
function stubBase(captured: { fields?: Record<string, unknown> }) {
  const table = {
    create: vi.fn(async (recs: Array<{ fields: Record<string, unknown> }>) => {
      captured.fields = recs[0]!.fields;
      return [{ id: "recNEW", fields: recs[0]!.fields }];
    }),
  };
  return Object.assign(() => table, { _table: table }) as never;
}

const baseInput = {
  reportId: "X — Maintenance — 2026-06-02",
  siteId: "recSITE",
  reportType: "Maintenance" as const,
  periodStart: new Date("2026-05-03T00:00:00Z"),
  periodEnd: new Date("2026-06-02T00:00:00Z"),
  completedOn: new Date("2026-06-02T00:00:00Z"),
  lighthouse: { performance: 90, accessibility: 95, bestPractices: 80, seo: 92 },
  lastTestedDate: null,
};

describe("createDraft search fields", () => {
  it("writes the checkbox true and the position when found on page 1", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    const row = await createDraft(stubBase(cap), {
      ...baseInput,
      searchFoundPage1: true,
      searchPosition: 2,
    });
    expect(cap.fields!["Search found page 1"]).toBe(true);
    expect(cap.fields!["Search position"]).toBe(2);
    expect(row.searchFoundPage1).toBe(true);
    expect(row.searchPosition).toBe(2);
  });

  it("writes the checkbox false and omits position when checked but not on page 1", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    await createDraft(stubBase(cap), { ...baseInput, searchFoundPage1: false });
    expect(cap.fields!["Search found page 1"]).toBe(false);
    expect("Search position" in cap.fields!).toBe(false);
  });

  it("omits both fields when the check did not run", async () => {
    const cap: { fields?: Record<string, unknown> } = {};
    await createDraft(stubBase(cap), baseInput);
    expect("Search found page 1" in cap.fields!).toBe(false);
    expect("Search position" in cap.fields!).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/reports/reports-row.test.ts`
Expected: FAIL — `DraftInput` has no `searchFoundPage1`/`searchPosition`; fields not written.

- [ ] **Step 3: Extend `DraftInput`**

In `src/reports/airtable/reports.ts`, in the `DraftInput` type (after `gaUsersPrevious?: number;`), add:

```typescript
  /** Search-presence result. `searchFoundPage1` is written whenever the check ran (true or
   *  false — false is the operator-only negative signal). `searchPosition` only when found. */
  searchFoundPage1?: boolean;
  searchPosition?: number;
```

- [ ] **Step 4: Write the fields in `createDraft`**

In `createDraft`, directly after the two GA `if (...)` lines (around line 125), add:

```typescript
if (input.searchFoundPage1 !== undefined) fields["Search found page 1"] = input.searchFoundPage1;
if (input.searchPosition !== undefined) fields["Search position"] = input.searchPosition;
```

- [ ] **Step 5: Add the fields to `ReportRow` + `mapRow`**

In the `ReportRow` type (after `gaUsersPrevious: number | null;`), add:

```typescript
searchFoundPage1: boolean | null;
searchPosition: number | null;
```

In `mapRow`, after the `gaUsersPrevious:` line, add:

```typescript
    searchFoundPage1:
      typeof f["Search found page 1"] === "boolean" ? (f["Search found page 1"] as boolean) : null,
    searchPosition: (f["Search position"] as number | undefined) ?? null,
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm exec vitest run tests/reports/reports-row.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck (expect fixture breakage)**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — `ReportRow` fixtures now miss the two fields. Fixed in Task 9.

- [ ] **Step 8: Commit**

```bash
git add src/reports/airtable/reports.ts tests/reports/reports-row.test.ts
git commit -m "feat(airtable): store search-presence (found + position) on the Reports row"
```

---

## Task 7: Soft-fetch in the draft flow

**Files:**

- Modify: `src/reports/draft.ts`
- Test: `tests/reports/draft.test.ts`

- [ ] **Step 1: Inspect the existing draft test setup**

Run: `pnpm exec vitest run tests/reports/draft.test.ts` and open `tests/reports/draft.test.ts` to see how `readGaConfig`/`fetchPeriodUsers` are mocked (the search mocks mirror them exactly).

- [ ] **Step 2: Write the failing test**

In `tests/reports/draft.test.ts`, add mocks for the search client mirroring the GA mocks already present, then a test. At the top with the other `vi.mock` calls add:

```typescript
vi.mock("../../src/reports/search/client.js", () => ({
  fetchSearchPresence: vi.fn(),
}));
```

Import it near the other imports:

```typescript
import { fetchSearchPresence } from "../../src/reports/search/client.js";
```

Then a test (adapt the site/base builders already used in the file — `readGaConfig` must return a config so the search branch runs; set the site's `searchQuery`):

```typescript
it("renders the page-1 rank and stores it on the Reports row", async () => {
  vi.mocked(fetchSearchPresence).mockResolvedValue({ foundOnPage1: true, position: 3 });
  // ... build a site row with searchQuery: "erp funds" and a stub base that captures createDraft fields ...
  const { html } = await draftReportForSite(base, site, "Maintenance");
  expect(html).toContain("Page 1 Google Result (#3)");
  expect(capturedDraftFields["Search found page 1"]).toBe(true);
  expect(capturedDraftFields["Search position"]).toBe(3);
});
```

> If the file's existing helpers don't expose a captured-fields stub, reuse the `stubBase` pattern from Task 6's test (capture `create()` fields). Match the file's existing GA test for the exact base/site builders.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm exec vitest run tests/reports/draft.test.ts`
Expected: FAIL — rank not rendered, fields not stored.

- [ ] **Step 4: Add the `fetchSearch` soft-fetch helper**

In `src/reports/draft.ts`, add the import near the GA imports:

```typescript
import { fetchSearchPresence } from "./search/client.js";
import type { SearchPresence } from "./search/client.js";
```

Add this helper next to `fetchGaUsers` (mirrors it):

```typescript
/**
 * Fetch the site's Google search presence for the period, soft-failing to null. Returns null
 * when GA/SA isn't configured (`readGaConfig()` null — search shares the SA credentials), the
 * site has no `searchQuery`, or the Search Console API errors (logging a one-line warning).
 * Never throws, so a search problem can never block a draft.
 */
async function fetchSearch(
  siteRow: WebsiteRow,
  periodStart: Date,
  periodEnd: Date,
): Promise<SearchPresence | null> {
  const cfg = readGaConfig();
  if (!cfg || !siteRow.searchQuery) return null;
  try {
    return await fetchSearchPresence(
      {
        keyPath: cfg.keyPath,
        subject: cfg.subject,
        property: siteRow.searchConsoleProperty ?? undefined,
        host: siteRow.url,
        query: siteRow.searchQuery,
      },
      periodStart,
      periodEnd,
    );
  } catch (e) {
    console.warn(`⚠ Search presence skipped for ${siteRow.name}: ${(e as Error).message}`);
    return null;
  }
}
```

- [ ] **Step 5: Call it and thread the result into render + createDraft**

In `draftReportForSite`, after the `gaUsers` line (around line 73), add:

```typescript
const search = base !== null ? await fetchSearch(siteRow, periodStart, periodEnd) : null;
```

In the `renderReportHtml({ ... })` call, add (after `gaUsersPrevious`):

```typescript
    searchPosition: search?.foundOnPage1 ? (search.position ?? undefined) : undefined,
```

In the `createDraft(base, { ... })` call, after the GA spread, add:

```typescript
    ...(search ? { searchFoundPage1: search.foundOnPage1 } : {}),
    ...(search?.foundOnPage1 && search.position !== null ? { searchPosition: search.position } : {}),
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm exec vitest run tests/reports/draft.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/reports/draft.ts tests/reports/draft.test.ts
git commit -m "feat(reports): soft-fetch search presence at draft time + store on the row"
```

---

## Task 8: Re-render the stored rank at send time

**Files:**

- Modify: `src/reports/send/orchestrate.ts`
- Test: `tests/reports/send/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/reports/send/orchestrate.test.ts`, add a case where the sendable `ReportRow` has `searchFoundPage1: true, searchPosition: 4` and assert the captured/sent HTML contains `Page 1 Google Result (#4)`. Reuse the file's existing report-row builder and Resend stub; set the two fields on the report fixture.

```typescript
it("re-renders the stored page-1 rank into the sent email", async () => {
  // ...build a sendable report with searchFoundPage1: true, searchPosition: 4 and a site with a header image...
  await sendApprovedReports({ resend });
  expect(sentHtml).toContain("Page 1 Google Result (#4)");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/reports/send/orchestrate.test.ts`
Expected: FAIL — rank not in the rendered HTML (orchestrate doesn't pass it).

- [ ] **Step 3: Pass the stored position into render**

In `src/reports/send/orchestrate.ts`, in the `renderReportHtml({ ... })` call inside `sendOne` (after `gaUsersPrevious`), add:

```typescript
    searchPosition: report.searchFoundPage1 && report.searchPosition !== null ? report.searchPosition : undefined,
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/reports/send/orchestrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/send/orchestrate.ts tests/reports/send/orchestrate.test.ts
git commit -m "feat(reports): re-render stored page-1 rank at send time"
```

---

## Task 9: Fix all fixtures

**Files (add the new required fields to every `WebsiteRow` / `ReportRow` literal):**

- `tests/reports/render.test.ts`, `tests/reports/draft.test.ts`, `tests/reports/due.test.ts`, `tests/reports/send/orchestrate.test.ts`
- `tests/dashboard/onboarding.test.ts`, `tests/dashboard/fleet-render.test.ts`, `tests/dashboard/render.test.ts`
- `tests/audits/write-audits-to-airtable.test.ts`

- [ ] **Step 1: Find every fixture missing the fields**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "searchConsoleProperty|searchFoundPage1|searchPosition"`
Expected: a list of file:line locations where a `WebsiteRow` is missing `searchConsoleProperty`, or a `ReportRow` is missing `searchFoundPage1` / `searchPosition`.

- [ ] **Step 2: Patch each `WebsiteRow` fixture**

For each flagged `WebsiteRow` literal, add directly after its `searchQuery:` line:

```typescript
    searchConsoleProperty: null,
```

- [ ] **Step 3: Patch each `ReportRow` fixture**

For each flagged `ReportRow` literal, add directly after its `gaUsersPrevious:` line:

```typescript
    searchFoundPage1: null,
    searchPosition: null,
```

- [ ] **Step 4: Typecheck clean**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no missing-property errors).

- [ ] **Step 5: Full suite**

Run: `pnpm test`
Expected: PASS (all tests green).

- [ ] **Step 6: Commit**

```bash
git add tests
git commit -m "test: add search-presence fields to WebsiteRow/ReportRow fixtures"
```

---

## Task 10: Changeset, gates, live verify, PR

**Files:**

- Create: `.changeset/search-presence-console.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/search-presence-console.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Surface Google search presence in the report email, sourced from the Search Console Search Analytics API (reusing the GA service-account domain-wide delegation — added scope `webmasters.readonly`). The Custom Search JSON API path from the prior release is replaced (it is closed to new customers).

- `src/reports/search/client.ts` — `fetchSearchPresence` queries the average position for a site's per-site query over the report period; `foundOnPage1 = avgPosition <= 10`, displayed rank is the rounded average. Resolves the Search Console property from the optional "Search Console property" Websites column, else auto-resolves (Domain or URL-prefix) from `sites.list`.
- The report email's "Google Indexed" row becomes `Page 1 Google Result (#N)` when on page 1; otherwise unchanged. Positive-only — the negative is stored on the Reports row ("Search found page 1" / "Search position") for operator eyes, never shown to the client.
- Soft-fail throughout: unconfigured / no query / API error leaves the draft unaffected.
- Removes the obsolete `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` env vars.
```

- [ ] **Step 2: Run the full local gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS. (Per project rule: `pnpm lint` before pushing — CI prettier-checks every file including markdown.)

- [ ] **Step 3: Live verify against erpfunds.com**

Draft a real ERP report (the site has `searchQuery = "ERP funds"` set) and confirm the rendered HTML shows `Page 1 Google Result (#2)` (≈ position 1.52 at spike time; the exact rank may drift). Use the project's draft command/preview path. If it renders the plain "Google Indexed" row, check: scope propagation (can take up to ~24h), Search Console API enabled, and erpfunds.com property access.

- [ ] **Step 4: Commit the changeset**

```bash
git add .changeset/search-presence-console.md
git commit -m "chore: changeset for Search Console search-presence"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/search-presence-console
gh pr create --title "feat(reports): search presence via Search Console + email surfacing" --body "<summary + merge note>"
```

PR body should note: this replaces the Custom Search path from the prior release; reuses GA delegation (no new key); operator setup (scope + API enable + property access) is already done; live-verified `"ERP funds"` → `Page 1 Google Result (#2)`.

---

## Self-Review Notes

- **Spec coverage:** SC client (T1), config deletion (T2), property column + auto-resolve both types (T1 `resolveProperty` + T3), Airtable columns (T4), email surfacing (T5), Reports storage incl. false/blank distinction (T6), draft soft-fetch (T7), send re-render (T8), fixtures (T9), changeset + live verify (T10). All spec sections mapped.
- **Type consistency:** `SearchPresence { foundOnPage1, position }` used identically in T1/T7/T8. `searchConsoleProperty` (WebsiteRow), `searchFoundPage1`/`searchPosition` (ReportRow + DraftInput), `searchPosition` (ReportData) — names consistent across tasks.
- **Soft-fail:** `fetchSearch` wraps the throwing client; `fetchSearchPresence` itself throws (tested T1) and is only ever called inside the try/catch (T7).

```

```
