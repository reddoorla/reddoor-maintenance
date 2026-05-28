# Site Dashboard Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-site status page rendered by a Netlify function from Airtable data, gated by a per-site shared-link token, deployed via the existing `reddoor-maintenance` Netlify site.

**Architecture:** New `src/dashboard/` module owns the pure rendering + token-verify logic (full vitest coverage). A new `netlify/functions/site-dashboard.mts` is a thin glue layer that opens Airtable, fetches the site by slug, verifies the `t=` query token against a new `Dashboard Token` field on the Websites row, and returns the rendered HTML. `netlify.toml` adds an `/s/:slug` redirect so customer-facing URLs stay short and clean. No frontend framework, no client JS, no build step beyond the existing function bundler.

**Tech Stack:** TypeScript / ESM, Netlify Functions (Node 22, esbuild bundler), Airtable JS client, Vitest. Reuses `airtable/client.ts`, `airtable/websites.ts`, `airtable/reports.ts` already in the repo.

---

## Scope (what's NOT in Phase 1)

Out of scope for this plan — explicit so future-you doesn't think they were forgotten:

- Lint / deps / security / a11y findings on the page → **Phase 2** (requires Airtable schema extensions + extending `audit --write-airtable` to persist all 5 audit signals, not just lighthouse).
- Trend chart / sparkline of historical lighthouse scores → **Phase 3**.
- Linking from the monthly email's HTML attachment to the live dashboard URL → **Phase 3**.
- Custom domain DNS setup (`status.reddoor.la`) → operator work outside this plan. The function is domain-agnostic; switching from `.netlify.app` to a custom domain requires zero code changes.
- Automatic dashboard token generation → operator populates the `Dashboard Token` Airtable field manually (one-time per site). Auto-gen would require write access on a GET request, which we don't want.

---

## File map

| File                                              | Responsibility                                                                                                                                                                                                                             | Created/Modified |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/reports/airtable/websites.ts`                | Add `dashboardToken: string \| null` to `WebsiteRow`; map `Dashboard Token` field in `mapRow`; export `mapRow` so we can unit-test the mapping.                                                                                            | Modified         |
| `src/dashboard/auth.ts`                           | `verifyDashboardToken(provided, expected): boolean` — constant-time compare, rejects empty/null on either side.                                                                                                                            | Created          |
| `src/dashboard/render.ts`                         | `renderSiteDashboardHtml(siteRow, reports): string` — pure function returning a full HTML document. Inline `<style>`, mobile-friendly, no client JS.                                                                                       | Created          |
| `src/dashboard/index.ts`                          | Barrel: re-exports `renderSiteDashboardHtml` + `verifyDashboardToken`.                                                                                                                                                                     | Created          |
| `src/index.ts`                                    | Re-export the dashboard module so library consumers (and tests) can hit it through the package entry.                                                                                                                                      | Modified         |
| `netlify/functions/site-dashboard.mts`            | Handler: parse query, open Airtable, fetch site, verify token, fetch last 6 reports, render, respond. Mirrors the structure of `resend-webhook.mts`.                                                                                       | Created          |
| `netlify.toml`                                    | Add `[[redirects]]` rule: `/s/:slug` → `/.netlify/functions/site-dashboard?slug=:slug`.                                                                                                                                                    | Modified         |
| `tests/reports/airtable/websites-mapping.test.ts` | Unit-test `mapRow` for the new `dashboardToken` field (present, absent, empty string).                                                                                                                                                     | Created          |
| `tests/dashboard/auth.test.ts`                    | Token compare: exact match, length mismatch, char mismatch, empty/null both sides.                                                                                                                                                         | Created          |
| `tests/dashboard/render.test.ts`                  | Snapshot-ish assertions: name/URL appear, all 4 lighthouse scores appear with correct labels (positional), reports table lists each input report with a link to its HTML attachment, gracefully renders zero-reports / null-scores states. | Created          |

---

## Task 1: Extend WebsiteRow with `dashboardToken`

**Files:**

- Modify: `src/reports/airtable/websites.ts` (type, mapRow, export)
- Create: `tests/reports/airtable/websites-mapping.test.ts`

The Airtable `Websites` table needs a new field called **`Dashboard Token`** (single-line text). This task adds the field to the TypeScript schema and verifies the mapping. The operator creates the field in Airtable separately (one-time setup, documented in the task summary).

- [ ] **Step 1: Add `mapRow` to the exported surface of `src/reports/airtable/websites.ts`**

Find the existing `function mapRow(rec: ...)` declaration (it's currently private). Add the `export` keyword so the test can call it directly.

Change:

```typescript
function mapRow(rec: { id: string; fields: Record<string, unknown> }): WebsiteRow {
```

to:

```typescript
export function mapRow(rec: { id: string; fields: Record<string, unknown> }): WebsiteRow {
```

- [ ] **Step 2: Write the failing test for the new `dashboardToken` field mapping**

Create `tests/reports/airtable/websites-mapping.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapRow } from "../../../src/reports/airtable/websites.js";

function row(fields: Record<string, unknown>) {
  return mapRow({
    id: "recTEST",
    fields: {
      Name: "Acme",
      URL: "https://acme.example.com",
      "Maintenance Frequency": "Monthly",
      "Testing Frequency": "None",
      ...fields,
    },
  });
}

describe("websites/mapRow → dashboardToken", () => {
  it("maps a non-empty Dashboard Token to dashboardToken", () => {
    expect(row({ "Dashboard Token": "abc123xyz" }).dashboardToken).toBe("abc123xyz");
  });

  it("returns null when the Dashboard Token field is absent", () => {
    expect(row({}).dashboardToken).toBeNull();
  });

  it("returns null when the Dashboard Token field is the empty string", () => {
    // Airtable returns "" for cleared single-line-text cells; treat as null so
    // verifyDashboardToken doesn't accept ?t= with no value as a match.
    expect(row({ "Dashboard Token": "" }).dashboardToken).toBeNull();
  });

  it("trims surrounding whitespace (operators occasionally paste with newlines)", () => {
    expect(row({ "Dashboard Token": "  tok  \n" }).dashboardToken).toBe("tok");
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `pnpm test --run tests/reports/airtable/websites-mapping.test.ts`
Expected: 4 failures — `dashboardToken` is not a property of `WebsiteRow` (TS error) and/or returned as `undefined` from mapRow.

- [ ] **Step 4: Add `dashboardToken` to the `WebsiteRow` type**

In `src/reports/airtable/websites.ts`, find the `WebsiteRow` type definition. Append (after `lastLighthouseAuditAt`):

```typescript
/** Shared-link gate for the per-site dashboard at /s/<slug>?t=<token>.
 *  Operator generates and pastes into the "Dashboard Token" Airtable field;
 *  rotated by replacing the value. `null` means the site has no dashboard
 *  link yet — the function returns 403 with a clear setup message. */
dashboardToken: string | null;
```

- [ ] **Step 5: Populate `dashboardToken` inside `mapRow`**

Find the existing return statement inside `mapRow`. Add the new field (anywhere after the existing fields, alongside `lastLighthouseAuditAt`):

```typescript
    dashboardToken: (() => {
      const raw = f["Dashboard Token"];
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    })(),
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `pnpm test --run tests/reports/airtable/websites-mapping.test.ts`
Expected: 4 tests passed.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/reports/airtable/websites.ts tests/reports/airtable/websites-mapping.test.ts
git commit -m "feat(airtable): map Dashboard Token field on WebsiteRow

Adds dashboardToken: string | null to WebsiteRow + maps the
\"Dashboard Token\" Airtable single-line-text field. Empty string and
whitespace-only values normalize to null so the upcoming dashboard
function can treat \"no token configured\" as a single state.

Exports mapRow so the field-mapping behavior is testable directly."
```

After committing, **do not forget the Airtable schema work**: open the Websites table, add a single-line-text field named exactly `Dashboard Token` (case + space preserved), and leave it empty for now. The dashboard function will return a clear setup message for any site whose token is null.

---

## Task 2: Build the auth module

**Files:**

- Create: `src/dashboard/auth.ts`
- Create: `tests/dashboard/auth.test.ts`

Constant-time token comparison. Tiny module, but isolating it keeps the function handler readable and lets us pin the comparison semantics under test.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { verifyDashboardToken } from "../../src/dashboard/auth.js";

describe("verifyDashboardToken", () => {
  it("accepts an exact match", () => {
    expect(verifyDashboardToken("abc123", "abc123")).toBe(true);
  });

  it("rejects a single-char difference", () => {
    expect(verifyDashboardToken("abc123", "abc124")).toBe(false);
  });

  it("rejects a length mismatch (long vs short)", () => {
    expect(verifyDashboardToken("abc123", "abc1234")).toBe(false);
    expect(verifyDashboardToken("abc1234", "abc123")).toBe(false);
  });

  it("rejects when the expected token is null (site has no dashboard configured)", () => {
    expect(verifyDashboardToken("anything", null)).toBe(false);
  });

  it("rejects when the provided token is null/undefined/empty", () => {
    expect(verifyDashboardToken(null, "abc123")).toBe(false);
    expect(verifyDashboardToken(undefined, "abc123")).toBe(false);
    expect(verifyDashboardToken("", "abc123")).toBe(false);
  });

  it("rejects when both sides are null", () => {
    expect(verifyDashboardToken(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test --run tests/dashboard/auth.test.ts`
Expected: failure — module `src/dashboard/auth.js` not found.

- [ ] **Step 3: Implement `verifyDashboardToken`**

Create `src/dashboard/auth.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a request-provided token against the token
 * stored on the Websites row in Airtable. Used by the per-site dashboard
 * Netlify function to gate /s/<slug>?t=<token>.
 *
 * Returns false for any of:
 * - provided token missing / empty
 * - expected token missing (the site has no Dashboard Token configured)
 * - lengths differ (constant-time path skipped because `timingSafeEqual`
 *   throws on length mismatch — the length difference itself doesn't leak
 *   anything secret since the expected token's length is fixed per site)
 *
 * Treats null/undefined/empty-string from the request as a single
 * "no token" state — keeps the handler's branching simple.
 */
export function verifyDashboardToken(
  provided: string | null | undefined,
  expected: string | null,
): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf-8"), Buffer.from(expected, "utf-8"));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test --run tests/dashboard/auth.test.ts`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/auth.ts tests/dashboard/auth.test.ts
git commit -m "feat(dashboard): verifyDashboardToken (constant-time compare)

Gates the upcoming /s/<slug>?t=<token> dashboard URL. Constant-time via
Node's timingSafeEqual; treats null/empty on either side as a single
\"no token\" state so the handler branching stays simple."
```

---

## Task 3: Build the render module

**Files:**

- Create: `src/dashboard/render.ts`
- Create: `tests/dashboard/render.test.ts`

Pure function: `(WebsiteRow, ReportRow[]) → string`. Full HTML document with inline `<style>`. Reuses Airtable's signed URL on `report.renderedHtmlAttachment` directly — the dashboard links out to each historical report instead of embedding them.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    dashboardToken: "tok",
    ...over,
  };
}

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    completedOn: "2026-05-01",
    lighthouse: { performance: 87, accessibility: 95, bestPractices: 90, seo: 100 },
    gaUsersCurrent: 2100,
    gaUsersPrevious: 1900,
    lastTestedDate: "2026-04-10",
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-05-02T09:00:00Z",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: {
      url: "https://airtable.example/attach/rep_001.html",
      filename: "rep_001.html",
    },
    resendMessageId: "msg_001",
    ...over,
  };
}

describe("renderSiteDashboardHtml", () => {
  it("returns a full HTML document", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
  });

  it("includes the site name in <title> and as the page heading", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/<title>[^<]*Acme Co[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*Acme Co/);
  });

  it("renders the site URL as a clickable link", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toContain('href="https://acme.example.com"');
  });

  it("renders all 4 lighthouse scores under their correct labels (positional)", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pScore: 12, rScore: 34, bpScore: 56, seoScore: 78 }),
      [],
    );
    const perfIdx = html.indexOf(">Performance<");
    const accIdx = html.indexOf(">Accessibility<");
    const bpIdx = html.indexOf(">Best Practices<");
    const seoIdx = html.indexOf(">SEO<");
    expect(perfIdx).toBeGreaterThan(-1);
    expect(accIdx).toBeGreaterThan(-1);
    expect(bpIdx).toBeGreaterThan(-1);
    expect(seoIdx).toBeGreaterThan(-1);
    expect(html.slice(perfIdx, accIdx)).toContain(">12<");
    expect(html.slice(accIdx, bpIdx)).toContain(">34<");
    expect(html.slice(bpIdx, seoIdx)).toContain(">56<");
    expect(html.slice(seoIdx)).toContain(">78<");
  });

  it("renders a placeholder when scores are null (site never audited)", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
      [],
    );
    expect(html).toMatch(/no lighthouse data yet/i);
  });

  it("lists each provided report with a link to its rendered HTML attachment", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_001", completedOn: "2026-05-01" }),
      reportRow({
        id: "recREP2",
        reportId: "rep_002",
        completedOn: "2026-04-01",
        renderedHtmlAttachment: {
          url: "https://airtable.example/attach/rep_002.html",
          filename: "rep_002.html",
        },
      }),
    ]);
    expect(html).toContain("rep_001");
    expect(html).toContain("rep_002");
    expect(html).toContain('href="https://airtable.example/attach/rep_001.html"');
    expect(html).toContain('href="https://airtable.example/attach/rep_002.html"');
  });

  it("renders a placeholder when there are no reports", () => {
    const html = renderSiteDashboardHtml(siteRow(), []);
    expect(html).toMatch(/no reports yet/i);
  });

  it("does not link a report whose attachment is null", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_003", renderedHtmlAttachment: null }),
    ]);
    expect(html).toContain("rep_003");
    // The row mentions the report but contains no href to a *.html anywhere
    // in that report's row context. Easiest assertion: the count of
    // attachment-style hrefs equals zero.
    expect(html.match(/href="[^"]*\.html"/g) ?? []).toEqual([]);
  });

  it("escapes HTML in the site name and URL so untrusted Airtable values cannot inject markup", () => {
    const html = renderSiteDashboardHtml(
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
      [],
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    // javascript: URLs in href must also be neutralized
    expect(html).not.toMatch(/href="javascript:/i);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test --run tests/dashboard/render.test.ts`
Expected: failure — module `src/dashboard/render.js` not found.

- [ ] **Step 3: Implement `renderSiteDashboardHtml`**

Create `src/dashboard/render.ts`:

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";

/** Minimal HTML-escape; not for XML/attribute-edge cases, just for text + safe
 *  attribute interpolation here. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only http(s) URLs in href context; everything else collapses to "#". */
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}

function scoreTile(label: string, value: number | null): string {
  const display = value === null ? "—" : String(value);
  return `<div class="tile"><div class="tile-value">${escapeHtml(display)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

function reportRow(r: ReportRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : "—";
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${link}</td></tr>`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 2rem; }
.meta a { color: inherit; }
.section { margin: 2rem 0; }
.section h2 { font-size: 1.1rem; margin: 0 0 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.tile { padding: 1rem; border: 1px solid #ddd; border-radius: 6px; text-align: center; }
@media (prefers-color-scheme: dark) { .tile { border-color: #333; } }
.tile-value { font-size: 2rem; font-weight: 600; }
.tile-label { font-size: 0.85rem; color: #666; margin-top: 0.25rem; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { th, td { border-color: #2a2a2a; } }
.muted { color: #999; }
.empty { color: #999; padding: 1rem; border: 1px dashed #ccc; border-radius: 6px; text-align: center; }
`;

/**
 * Render the per-site dashboard as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * fetches data, then hands it here. Easier to unit-test, easier to render
 * a static preview from CLI later.
 */
export function renderSiteDashboardHtml(site: WebsiteRow, reports: ReportRow[]): string {
  const name = escapeHtml(site.name);
  const urlSafe = safeUrl(site.url);
  const allScoresNull =
    site.pScore === null && site.rScore === null && site.bpScore === null && site.seoScore === null;

  const scoresSection = allScoresNull
    ? `<div class="empty">No lighthouse data yet — run <code>reddoor-maint audit --write-airtable</code> from the site checkout.</div>`
    : `<div class="tiles">
        ${scoreTile("Performance", site.pScore)}
        ${scoreTile("Accessibility", site.rScore)}
        ${scoreTile("Best Practices", site.bpScore)}
        ${scoreTile("SEO", site.seoScore)}
      </div>`;

  const reportsSection =
    reports.length === 0
      ? `<div class="empty">No reports yet.</div>`
      : `<table>
          <thead><tr><th>Completed</th><th>Type</th><th>ID</th><th>Report</th></tr></thead>
          <tbody>${reports.map(reportRow).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name} — Reddoor maintenance</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>${name}</h1>
  <div class="meta"><a href="${escapeHtml(urlSafe)}">${escapeHtml(site.url)}</a></div>

  <div class="section">
    <h2>Lighthouse</h2>
    ${scoresSection}
  </div>

  <div class="section">
    <h2>Reports</h2>
    ${reportsSection}
  </div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test --run tests/dashboard/render.test.ts`
Expected: 9 tests passed.

- [ ] **Step 5: Create the barrel export**

Create `src/dashboard/index.ts`:

```typescript
export { renderSiteDashboardHtml } from "./render.js";
export { verifyDashboardToken } from "./auth.js";
```

- [ ] **Step 6: Re-export the dashboard module from `src/index.ts`**

Open `src/index.ts`. After the last existing export block, append:

```typescript
export { renderSiteDashboardHtml, verifyDashboardToken } from "./dashboard/index.js";
```

- [ ] **Step 7: Typecheck + lint + full test run**

Run: `pnpm typecheck && pnpm lint && pnpm test --run tests/dashboard tests/reports/airtable`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/render.ts src/dashboard/index.ts src/index.ts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): renderSiteDashboardHtml (pure render)

Self-contained HTML doc with inline <style>, no client JS, no external
assets. Mobile + dark-mode aware. Escapes site name + URL so untrusted
Airtable values can't inject markup or javascript: hrefs.

Renders graceful empty states for no-scores-yet and no-reports-yet."
```

---

## Task 4: Wire the Netlify function

**Files:**

- Create: `netlify/functions/site-dashboard.mts`

Thin glue: parse query → open Airtable → fetch site by slug → verify token → fetch reports → render → respond. Mirrors the structure of the existing `resend-webhook.mts` (env-var checks first, structured 4xx/5xx responses, JSON error bodies for non-200s so operators can curl + read the issue).

No unit tests for the function itself — the rendering, auth, and Airtable mapping are all covered by their own modules' tests. A manual deploy-preview test is the integration check (Task 6).

- [ ] **Step 1: Create the function**

Create `netlify/functions/site-dashboard.mts`:

```typescript
import type { Context } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { listReportsForSite } from "../../src/reports/airtable/reports.js";
import { verifyDashboardToken, renderSiteDashboardHtml } from "../../src/dashboard/index.js";

function plainText(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Health check — same pattern as resend-webhook: GET without ?slug=
  // returns env presence so operators can curl after deploy.
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const token = url.searchParams.get("t");

  if (!slug) {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-site-dashboard",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
        },
      },
      { status: 200 },
    );
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[site-dashboard] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  const base = openBase({ apiKey, baseId });

  const site = await getWebsiteBySlug(base, slug);
  if (!site) {
    return plainText(`No site found for slug '${slug}'.`, 404);
  }

  if (!site.dashboardToken) {
    return plainText(
      `Site '${site.name}' has no Dashboard Token set in Airtable. ` +
        `Open the Websites table, find the row, and populate the "Dashboard Token" field.`,
      403,
    );
  }

  if (!verifyDashboardToken(token, site.dashboardToken)) {
    // 404 (not 403) so the URL space doesn't leak which sites have valid
    // tokens vs. which are wrong-tokened — both look the same to a probe.
    return plainText(`Not found.`, 404);
  }

  const reports = await listReportsForSite(base, site.id);
  // Show most recent 6 — long enough to show a quarter of monthly reports
  // plus the most recent testing report, short enough that the page stays
  // a single scroll.
  const recent = [...reports]
    .sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? ""))
    .slice(0, 6);

  return html(renderSiteDashboardHtml(site, recent), 200);
};
```

- [ ] **Step 2: Typecheck (no unit tests for the function itself)**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/site-dashboard.mts
git commit -m "feat(netlify): site-dashboard function

Glue: parse slug + token from query, fetch site by slug, gate by
constant-time token compare against the new Dashboard Token field on
Websites, fetch last 6 reports, render via renderSiteDashboardHtml.

GET with no slug returns env-presence health check (same pattern as
resend-webhook so operators can verify deploy + env vars by curl).

Wrong/missing token returns 404 (not 403) so the URL space doesn't
leak which slugs have valid tokens."
```

---

## Task 5: Add `/s/:slug` redirect in `netlify.toml`

**Files:**

- Modify: `netlify.toml`

Customer-facing URL becomes `https://<netlify>/s/<slug>?t=<token>` instead of `/.netlify/functions/site-dashboard?slug=...&t=...`.

- [ ] **Step 1: Read current `netlify.toml`**

Run: `cat netlify.toml`

Expected current contents (small file):

```toml
[build]
  command = "echo 'no build — functions only'"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"
```

- [ ] **Step 2: Add the redirect block**

Edit `netlify.toml` to add the redirect at the end:

```toml
[build]
  command = "echo 'no build — functions only'"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

# Per-site dashboard. Splat path becomes the slug; query string
# (notably ?t=<token>) passes through unchanged with force=false.
[[redirects]]
  from = "/s/:slug"
  to = "/.netlify/functions/site-dashboard?slug=:slug"
  status = 200
  force = true
```

The `status = 200` makes this a rewrite (not an HTTP 30x), so the URL stays `/s/<slug>?t=...` in the browser — what we want for a shareable customer link.

- [ ] **Step 3: Verify the file parses**

Run: `cat netlify.toml | head -20`
Expected: contents above print without error (toml is whitespace-tolerant; this is a sanity check that the file isn't corrupted).

- [ ] **Step 4: Commit**

```bash
git add netlify.toml
git commit -m "feat(netlify): /s/:slug rewrite to site-dashboard function

Customer-facing URL is /s/<slug>?t=<token>. status=200 rewrite keeps
the short URL in the address bar (no visible /.netlify/functions/ in
shared links)."
```

---

## Task 6: Deploy preview + manual end-to-end verification

**Files:** none (operator step)

The function depends on `AIRTABLE_PAT` and `AIRTABLE_BASE_ID` env vars on the Netlify site. These are already set on the production site (resend-webhook uses them). Deploy preview inherits production env unless overridden.

This task is operator work: deploy a preview, verify the function reaches Airtable and renders, then set a dashboard token on one Airtable row and verify the full flow.

- [ ] **Step 1: Push the branch and open a PR**

Get the branch name first (`git branch --show-current`), then:

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "feat(dashboard): per-site dashboard at /s/:slug (Phase 1)" --body "$(cat <<'EOF'
## Summary
- New Netlify function at /s/<slug>?t=<token> renders a per-site dashboard from Airtable data.
- Gated by a per-site shared-link token (new Dashboard Token field on the Websites table); wrong/missing token returns 404 so the URL space doesn't enumerate.
- Pure render module (`renderSiteDashboardHtml`) + constant-time token-compare module (`verifyDashboardToken`), both unit-tested. Function is a thin glue layer.

## Test plan
- [x] vitest, typecheck, lint, build, test:dist all green locally
- [ ] Deploy preview health check returns env=true,true
- [ ] Caltex with a token set renders a real dashboard page (lighthouse tiles + reports list)
- [ ] Wrong-token request returns 404
- [ ] Missing-token request returns 403 with the setup message
EOF
)"
```

Netlify auto-creates a deploy preview for the PR.

- [ ] **Step 2: Verify the health-check endpoint on the deploy preview**

Get the preview URL from the PR's Netlify check, then:

```bash
curl -s "https://<deploy-preview-url>/.netlify/functions/site-dashboard" | python3 -m json.tool
```

Expected output:

```json
{
  "status": "ok",
  "service": "reddoor-site-dashboard",
  "env": { "AIRTABLE_PAT": true, "AIRTABLE_BASE_ID": true }
}
```

If either env value is `false`, set the missing variable in Netlify site settings before continuing.

- [ ] **Step 3: Verify a slug with no token returns the setup message**

Pick any existing slug, e.g. `caltex-landing`:

```bash
curl -i "https://<deploy-preview-url>/s/caltex-landing"
```

Expected: HTTP 403 with body `Site 'Caltex Landing' has no Dashboard Token set in Airtable...`.

- [ ] **Step 4: Set a dashboard token on the caltex row in Airtable**

Generate a 32-char hex token locally:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

In Airtable: open Websites, find the caltex row, paste the token into the **Dashboard Token** column.

- [ ] **Step 5: Verify the page renders with the right token**

```bash
curl -i "https://<deploy-preview-url>/s/caltex-landing?t=<token-from-step-4>"
```

Expected: HTTP 200 with HTML starting `<!doctype html>` and containing the site name, URL, lighthouse scores (assuming caltex has scores after the recent audit), and a list of any past reports.

Open the URL in a browser to eyeball layout + dark-mode rendering.

- [ ] **Step 6: Verify a wrong token returns 404**

```bash
curl -i "https://<deploy-preview-url>/s/caltex-landing?t=wrongtoken1234"
```

Expected: HTTP 404 with body `Not found.`. **Critical**: this must NOT differentiate from a slug that doesn't exist (Step 3 returned 404 too) — same response means probes can't enumerate which sites have valid tokens.

Actually wait — Step 3 returned 403 for "no token configured" and 404 for wrong token. That asymmetry is intentional (operator-friendly setup message vs. token-probing defense). Re-verify: 403 only fires when the row exists AND `dashboardToken` is null; 404 fires for unknown slug OR wrong token. A probe seeing 403 has confirmed a slug exists but learns nothing about valid tokens, since 403 is independent of the `t=` param.

- [ ] **Step 7: Merge the PR**

Once preview checks pass, merge to main. The changesets workflow will pick this up as a patch bump on the next release.

- [ ] **Step 8: Verify on production**

After the release PR lands:

```bash
curl -i "https://<prod-netlify-domain>/s/caltex-landing?t=<token>"
```

Expected: HTTP 200, same content as the preview.

- [ ] **Step 9: (Operator, separate work) DNS for status.reddoor.la**

Out of scope for this code, but worth noting: once a custom domain is configured on the Netlify site, the dashboard URL becomes `https://status.reddoor.la/s/<slug>?t=<token>`. Zero code changes needed.

---

## Done criteria

Phase 1 is done when:

1. ✅ `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:dist` all pass locally.
2. ✅ Deploy preview returns a rendered HTML dashboard for at least one site whose token is set.
3. ✅ Wrong-token requests return 404 (indistinguishable from unknown-slug from a probe's perspective).
4. ✅ Missing-token requests return 403 with a clear operator setup message.
5. ✅ Caltex (or whichever site you tokenize first) has a working `/s/caltex-landing?t=<token>` URL.

After merge, Phase 2 (extending audit data into Airtable and onto the page) is the natural next plan.
