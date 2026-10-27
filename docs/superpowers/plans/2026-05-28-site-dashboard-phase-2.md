# Site Dashboard Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Password-gated fleet homepage at `/` listing every site in the Airtable Websites table, each row click-throughs to its per-site `/s/<slug>?t=<token>` page (built in Phase 1).

**Architecture:** New `netlify/functions/fleet-homepage.mts` registers itself at `/` via `export const config = { path: "/" }`. Guarded by HTTP Basic Auth against a single `DASHBOARD_PASSWORD` env var (username field ignored — browser will still prompt but accepts anything). On valid auth, fetches all rows from the Airtable Websites table and hands them to a pure `renderFleetHomeHtml(websites)` module that returns an HTML document styled to match Phase 1's per-site page. Each row links to `/s/<slug>?t=<dashboardToken>` for sites whose token is set; sites without a token show a "not configured" badge so the homepage doubles as a setup-progress view.

**Tech Stack:** TypeScript / ESM, Netlify Functions v2 (Node 22, esbuild bundler), Airtable JS client, Vitest. Reuses `openBase`, `listWebsites`, `WebsiteRow` already in the repo.

---

## Scope (what's NOT in Phase 2)

Phase 2b (separate plan): click-to-trigger audit button per site. Spawning is via GitHub Actions `workflow_dispatch` from a new function that POSTs to the gh API. The audit-trigger button needs a new `audit-site.yml` workflow that clones the site repo, runs the audit, and writes to Airtable. Tracked in the road-to-1.0 work.

Phase 2c (separate plan): extend `audit --write-airtable` to persist `lintErrors`, `depsDrifted`, `securityVulns`, `a11yViolations` (+ matching `LastRunAt` fields). Surface as additional tiles on per-site dashboard. Also feeds the fleet homepage's "audit completeness" column.

Out of scope entirely:

- Custom domain (`status.reddoor.la`) — Tucker's DNS work, function code is domain-agnostic.
- Auto-generating dashboard tokens for sites that don't have one yet — operator still pastes manually in Airtable.
- Per-user auth, audit logs, RBAC, anything beyond a single shared password.

---

## File map

| File                                   | Responsibility                                                                                                                                                                     | Created/Modified |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/dashboard/basic-auth.ts`          | `verifyBasicAuth(authHeader, expected): boolean` — parse `Authorization: Basic <base64>`, decode, compare password constant-time.                                                  | Created          |
| `src/dashboard/fleet-render.ts`        | `renderFleetHomeHtml(websites): string` — pure render of the homepage table. Reuses the look/feel of Phase 1's per-site page.                                                      | Created          |
| `src/dashboard/index.ts`               | Add exports for `renderFleetHomeHtml` and `verifyBasicAuth`.                                                                                                                       | Modified         |
| `src/index.ts`                         | Re-export `renderFleetHomeHtml` and `verifyBasicAuth` through the package entry.                                                                                                   | Modified         |
| `netlify/functions/fleet-homepage.mts` | Handler at `/`. Basic-auth check; on success fetches all websites and renders. On failure returns 401 + `WWW-Authenticate: Basic` so the browser prompts.                          | Created          |
| `tests/dashboard/basic-auth.test.ts`   | Auth header parse + compare: valid, wrong password, missing header, malformed (no `Basic`, bad base64, no colon), empty password rejected, username ignored.                       | Created          |
| `tests/dashboard/fleet-render.test.ts` | Renders one row per site; embeds `/s/<slug>?t=<token>` href for sites with a token; shows "not configured" badge for sites without one; escapes name and URL; handles empty fleet. | Created          |
| `scripts/smoke-dist.mjs`               | Add `renderFleetHomeHtml` and `verifyBasicAuth` to `requiredExports`.                                                                                                              | Modified         |

---

## Task 1: Basic-auth verification module

**Files:**

- Create: `src/dashboard/basic-auth.ts`
- Create: `tests/dashboard/basic-auth.test.ts`

HTTP Basic Auth is `Authorization: Basic <base64(user:password)>`. Username is ignored per the locked decision; only the password is compared. Constant-time compare prevents timing attacks on the password.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/basic-auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { verifyBasicAuth } from "../../src/dashboard/basic-auth.js";

// Build an Authorization header value from username + password.
function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf-8").toString("base64")}`;
}

describe("verifyBasicAuth", () => {
  it("accepts a valid password regardless of username", () => {
    expect(verifyBasicAuth(basic("anyone", "s3cret"), "s3cret")).toBe(true);
    expect(verifyBasicAuth(basic("", "s3cret"), "s3cret")).toBe(true);
    expect(verifyBasicAuth(basic("admin", "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyBasicAuth(basic("admin", "wrong"), "s3cret")).toBe(false);
  });

  it("rejects when the Authorization header is missing", () => {
    expect(verifyBasicAuth(null, "s3cret")).toBe(false);
    expect(verifyBasicAuth(undefined, "s3cret")).toBe(false);
    expect(verifyBasicAuth("", "s3cret")).toBe(false);
  });

  it("rejects non-Basic auth schemes", () => {
    expect(verifyBasicAuth("Bearer abc123", "s3cret")).toBe(false);
    expect(verifyBasicAuth('Digest username="x"', "s3cret")).toBe(false);
  });

  it("rejects malformed base64", () => {
    expect(verifyBasicAuth("Basic !!!notbase64!!!", "s3cret")).toBe(false);
  });

  it("rejects decoded payloads with no colon (not user:password shape)", () => {
    const noColon = `Basic ${Buffer.from("nocolon", "utf-8").toString("base64")}`;
    expect(verifyBasicAuth(noColon, "s3cret")).toBe(false);
  });

  it("rejects when the expected password is null/empty (site has no DASHBOARD_PASSWORD set)", () => {
    expect(verifyBasicAuth(basic("admin", "anything"), "")).toBe(false);
    expect(verifyBasicAuth(basic("admin", "anything"), null)).toBe(false);
  });

  it("treats the 'Basic' scheme case-insensitively (per RFC 7235)", () => {
    const lower = `basic ${Buffer.from("u:s3cret", "utf-8").toString("base64")}`;
    expect(verifyBasicAuth(lower, "s3cret")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test --run tests/dashboard/basic-auth.test.ts`
Expected: module `src/dashboard/basic-auth.js` not found.

- [ ] **Step 3: Implement**

Create `src/dashboard/basic-auth.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";

/**
 * Verify an `Authorization: Basic <base64>` header against the configured
 * dashboard password. Username is intentionally ignored — operators may
 * type anything when the browser prompts; only the password gates entry.
 *
 * Returns false for any of:
 * - missing/empty Authorization header
 * - non-Basic auth scheme
 * - malformed base64 or payload (no colon to split user:password)
 * - wrong password
 * - expected password missing (DASHBOARD_PASSWORD not configured)
 *
 * Wrong-password compare is constant-time; lengths are checked first
 * (timingSafeEqual throws on mismatch, and the length itself doesn't
 * leak — operator's password length is fixed per deploy).
 */
export function verifyBasicAuth(
  authHeader: string | null | undefined,
  expectedPassword: string | null,
): boolean {
  if (!authHeader || !expectedPassword) return false;
  // RFC 7235: scheme is case-insensitive.
  const match = /^basic\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf-8");
  } catch {
    return false;
  }
  // Base64-decoding never throws in Node, but a payload of garbage may
  // produce a string with no colon. user:password form is required.
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;
  const provided = decoded.slice(colonIdx + 1);
  if (provided.length !== expectedPassword.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf-8"), Buffer.from(expectedPassword, "utf-8"));
}
```

- [ ] **Step 4: Run the test, verify it passes** — 8 tests pass.

- [ ] **Step 5: Format + typecheck + lint**

```
pnpm format src/dashboard/basic-auth.ts tests/dashboard/basic-auth.test.ts
pnpm typecheck
pnpm lint
```

All green.

- [ ] **Step 6: Commit**

```
feat(dashboard): verifyBasicAuth for Phase 2 homepage gate

Parses Authorization: Basic <base64(user:password)>, compares password
constant-time against DASHBOARD_PASSWORD env var. Username is ignored
(operator types anything; password gates entry). Rejects null/empty on
either side; rejects malformed headers, non-Basic schemes, garbage
base64, and payloads with no user:password colon.

Phase 2 fleet homepage uses this; per-site /s/<slug>?t=<token> Phase 1
URLs remain token-gated and unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 2: Fleet render module

**Files:**

- Create: `src/dashboard/fleet-render.ts`
- Create: `tests/dashboard/fleet-render.test.ts`

Pure function: `(WebsiteRow[]) → string`. Returns a full HTML document for the fleet homepage. Reuses the inline-style aesthetic from `renderSiteDashboardHtml` so the two pages feel like one product. Each row links to `/s/<slug>?t=<dashboardToken>` for sites with a token; sites without a token render a "no token" badge instead of a link.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard/fleet-render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderFleetHomeHtml } from "../../src/dashboard/fleet-render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

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

describe("renderFleetHomeHtml", () => {
  it("returns a full HTML document", () => {
    const html = renderFleetHomeHtml([siteRow()]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
  });

  it("includes a sensible page title", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/<title>[^<]*Reddoor[^<]*<\/title>/);
  });

  it("renders one row per site with the site name visible", () => {
    const html = renderFleetHomeHtml([
      siteRow({ id: "rec1", name: "Acme Co" }),
      siteRow({ id: "rec2", name: "Beta Inc" }),
      siteRow({ id: "rec3", name: "Gamma LLC" }),
    ]);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links each site row to /s/<slug>?t=<token> using the dashboardToken", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "CalTex", dashboardToken: "abc123" })]);
    // slug derives from name via siteSlug() → "caltex"
    expect(html).toContain('href="/s/caltex?t=abc123"');
  });

  it("renders sites without a dashboardToken as inactive (no link, visible badge)", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "Unconfigured Co", dashboardToken: null })]);
    expect(html).toContain(">Unconfigured Co<");
    // No href to a /s/... path for this site
    expect(html).not.toMatch(/href="\/s\/unconfigured-co/);
    // A clear "no token" marker so the operator knows to set it
    expect(html).toMatch(/no token/i);
  });

  it("renders lighthouse score numbers per row when scores are present", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 }),
    ]);
    expect(html).toContain(">73<");
    expect(html).toContain(">100<");
    expect(html).toContain(">78<");
  });

  it("renders a placeholder for sites with null scores (never audited)", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
    ]);
    // Em-dash (or similar) for unset scores, NOT the literal "null"
    expect(html).not.toContain(">null<");
    expect(html).toMatch(/—|–|-/);
  });

  it("renders a friendly empty state when the fleet has zero sites", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/no sites/i);
  });

  it("escapes HTML in site names and URLs so untrusted Airtable values cannot inject markup", () => {
    const html = renderFleetHomeHtml([
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
    ]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("escapes the dashboard token in the href so a token with special chars cannot break the URL", () => {
    // Defensive: tokens are operator-generated hex in practice, but the
    // type is `string` and an operator could paste anything. Escaping
    // the token in href context prevents that from becoming an injection
    // vector if someone ever pastes "abc&foo=bar" or similar.
    const html = renderFleetHomeHtml([siteRow({ name: "Acme", dashboardToken: 'a"b&c' })]);
    expect(html).not.toMatch(/href="[^"]*"[^"]*b&c/);
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails** — module not found.

- [ ] **Step 3: Implement**

Create `src/dashboard/fleet-render.ts`:

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}

function scoreCell(value: number | null): string {
  const display = value === null ? "—" : String(value);
  return `<td class="score">${escapeHtml(display)}</td>`;
}

function siteHrefCell(site: WebsiteRow): string {
  const name = escapeHtml(site.name);
  if (!site.dashboardToken) {
    return `<td class="site"><span class="name">${name}</span> <span class="badge">no token</span></td>`;
  }
  const href = `/s/${escapeHtml(siteSlug(site.name))}?t=${escapeHtml(site.dashboardToken)}`;
  return `<td class="site"><a href="${href}">${name}</a></td>`;
}

function siteRow(site: WebsiteRow): string {
  return `<tr>
    ${siteHrefCell(site)}
    <td><a href="${escapeHtml(safeUrl(site.url))}" class="url" target="_blank" rel="noopener">${escapeHtml(site.url)}</a></td>
    ${scoreCell(site.pScore)}
    ${scoreCell(site.rScore)}
    ${scoreCell(site.bpScore)}
    ${scoreCell(site.seoScore)}
  </tr>`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 2rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th { text-align: left; padding: 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 2px solid #ddd; }
@media (prefers-color-scheme: dark) { th { border-color: #333; } }
td { padding: 0.65rem 0.5rem; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { td { border-color: #2a2a2a; } }
td.site a { font-weight: 500; }
td.url { color: #666; font-size: 0.85rem; }
td.score { text-align: right; font-variant-numeric: tabular-nums; min-width: 3.5rem; }
.badge { display: inline-block; margin-left: 0.5rem; padding: 0.1rem 0.5rem; font-size: 0.75rem; border-radius: 3px; background: #f0f0f0; color: #999; }
@media (prefers-color-scheme: dark) { .badge { background: #2a2a2a; color: #777; } }
.empty { color: #999; padding: 2rem; text-align: center; border: 1px dashed #ccc; border-radius: 6px; }
`;

/**
 * Render the fleet homepage as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * fetches and gates, then hands here. Same style vocabulary as
 * renderSiteDashboardHtml so the two pages feel like one product.
 *
 * Sites without a dashboardToken render as plain text plus a "no token"
 * badge — visible-but-inactive, so the homepage doubles as a per-site
 * setup-progress view.
 */
export function renderFleetHomeHtml(sites: WebsiteRow[]): string {
  const body =
    sites.length === 0
      ? `<div class="empty">No sites in the Websites table yet.</div>`
      : `<table>
          <thead><tr>
            <th>Site</th>
            <th>URL</th>
            <th>Perf</th>
            <th>A11y</th>
            <th>BP</th>
            <th>SEO</th>
          </tr></thead>
          <tbody>${sites.map(siteRow).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddoor maintenance — fleet</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet</h1>
  <div class="meta">${sites.length} site${sites.length === 1 ? "" : "s"} in the Websites table.</div>
  ${body}
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test, verify it passes** — 9 tests.

- [ ] **Step 5: Add to barrel + package entry**

Modify `src/dashboard/index.ts` — add two exports. Open the file and append:

```typescript
export { renderFleetHomeHtml } from "./fleet-render.js";
export { verifyBasicAuth } from "./basic-auth.js";
```

Modify `src/index.ts` — extend the existing dashboard re-export line. Find:

```typescript
export { renderSiteDashboardHtml, verifyDashboardToken } from "./dashboard/index.js";
```

Replace with:

```typescript
export {
  renderSiteDashboardHtml,
  verifyDashboardToken,
  renderFleetHomeHtml,
  verifyBasicAuth,
} from "./dashboard/index.js";
```

- [ ] **Step 6: Format + typecheck + lint + run dashboard tests**

```
pnpm format src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
pnpm typecheck
pnpm lint
pnpm test --run tests/dashboard
```

All green.

- [ ] **Step 7: Commit**

```
feat(dashboard): renderFleetHomeHtml (pure render of homepage)

Table-style list of every site in the fleet. Each row links to its
per-site /s/<slug>?t=<token> page when a Dashboard Token is set;
unconfigured sites render with a "no token" badge so the homepage
doubles as a setup-progress view.

Same inline-style vocabulary as renderSiteDashboardHtml so the two
pages feel like one product. Escapes name, URL, and the token itself
in href context — operator-paste tokens with weird chars can't break
the link target.

Exports renderFleetHomeHtml + verifyBasicAuth through the package
entry so library consumers can render a preview from CLI later.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 3: Update smoke gate

**Files:**

- Modify: `scripts/smoke-dist.mjs`

Add the two new public exports to the smoke gate's `requiredExports` array so an accidental barrel-export regression fails CI (same family as the 0.10.0 silent-drift class the smoke gate exists to catch).

- [ ] **Step 1: Read the current `requiredExports` block**

Run: `grep -n "renderSiteDashboardHtml\|verifyDashboardToken\|requiredExports" scripts/smoke-dist.mjs`

You should see `renderSiteDashboardHtml` and `verifyDashboardToken` already in the list. Find the line that has `"verifyDashboardToken",` and confirm it's the last dashboard entry.

- [ ] **Step 2: Add the two new exports immediately after `verifyDashboardToken`**

Edit `scripts/smoke-dist.mjs`. Replace:

```javascript
  // dashboard — Netlify function imports these for the per-site /s/:slug page
  "renderSiteDashboardHtml",
  "verifyDashboardToken",
```

with:

```javascript
  // dashboard — Netlify functions import these for the per-site /s/:slug page (Phase 1)
  // and the fleet homepage at / (Phase 2)
  "renderSiteDashboardHtml",
  "verifyDashboardToken",
  "renderFleetHomeHtml",
  "verifyBasicAuth",
```

- [ ] **Step 3: Build + run the smoke gate**

```
pnpm build
pnpm test:dist
```

Expected: smoke gate prints `✓ dist/index.js exposes all required public exports` (now 21 names). `smoke-dist: <version> OK`.

- [ ] **Step 4: Commit**

```
chore(smoke): guard renderFleetHomeHtml + verifyBasicAuth exports

Adds the two Phase 2 public exports to scripts/smoke-dist.mjs
requiredExports so accidental barrel-export regressions fail the
pre-publish gate (same family as the 0.10.0 silent-drift class
the smoke gate exists to catch).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 4: Wire the Netlify function

**Files:**

- Create: `netlify/functions/fleet-homepage.mts`

Thin glue: Basic-auth gate → fetch all websites → render → respond. No unit tests for the function itself (auth + render + Airtable mapping are all tested separately). Manual deploy-preview verification in Task 5.

Registers at `/` via Netlify v2 function path config — same pattern as Phase 1's `site-dashboard.mts` after the 0.11.1 fix (avoids the rewrite-passes-original-URL bug).

- [ ] **Step 1: Create the function**

Create `netlify/functions/fleet-homepage.mts`:

```typescript
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { verifyBasicAuth, renderFleetHomeHtml } from "../../src/dashboard/index.js";

// Owns the root path. The per-site dashboard function continues to own
// /s/:slug; the resend-webhook function continues to own its own path.
// Phase 2 decision was Netlify site-level password — implemented here as
// HTTP Basic Auth against DASHBOARD_PASSWORD env var rather than via
// Netlify dashboard settings, so the gate ships with the code.
export const config: Config = {
  path: ["/"],
};

function plainText(body: string, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!apiKey || !baseId) {
    console.error("[fleet-homepage] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  if (!password) {
    // Distinguishable from a wrong-password 401 because it carries a
    // setup hint instead of a WWW-Authenticate challenge. Operator sees
    // this exactly once after deploy; clear next step.
    console.error("[fleet-homepage] DASHBOARD_PASSWORD missing");
    return plainText(
      "Fleet homepage is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }

  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const base = openBase({ apiKey, baseId });
  const websites = await listWebsites(base);
  // Stable display order: alphabetical by name. Matches what someone
  // would naturally scan for a known site. Operator can re-sort by
  // clicking column headers in a later phase.
  const sorted = [...websites].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return html(renderFleetHomeHtml(sorted), 200);
};
```

- [ ] **Step 2: Format + typecheck + lint**

```
pnpm format netlify/functions/fleet-homepage.mts
pnpm typecheck
pnpm lint
```

All green.

- [ ] **Step 3: Full test gate (sanity)**

```
pnpm test --run
```

Expected: 449 tests passing (440 from before + 8 basic-auth + 9 fleet-render − the 8/9 split depends on what was actually green; if the count differs by a couple, that's fine — what matters is no failures).

- [ ] **Step 4: Commit**

```
feat(netlify): fleet-homepage function at /

Glue: HTTP Basic Auth gate against DASHBOARD_PASSWORD env var, fetch
all websites, sort alphabetically by name, render via
renderFleetHomeHtml.

Path registered via Netlify v2 function config: { path: ["/"] }. Same
pattern as Phase 1's site-dashboard after the 0.11.1 fix (avoids the
rewrite-passes-original-URL bug class).

Returns:
- 500 if Airtable env missing
- 503 if DASHBOARD_PASSWORD unset (distinguishable from wrong-password
  so operator knows the setup step is incomplete)
- 401 + WWW-Authenticate: Basic for missing/wrong auth (browser
  prompts naturally)
- 200 HTML for authenticated requests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 5: Deploy preview + manual end-to-end verification

**Files:** none (operator step)

The function reads `AIRTABLE_PAT`, `AIRTABLE_BASE_ID` (already set on the production Netlify site, deploy preview inherits), and a new `DASHBOARD_PASSWORD` (must be set before this works). This task is operator work: set the env var, deploy, verify each response path.

- [ ] **Step 1: Set `DASHBOARD_PASSWORD` in Netlify**

In the Netlify dashboard for the `reddoor-maintenance` site, Site configuration → Environment variables → Add new variable:

- Key: `DASHBOARD_PASSWORD`
- Value: generate a passphrase (e.g. `node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"`) — or use a memorable passphrase since the operator types this manually.

Important: applies to all deploy contexts (production + deploy previews), so subsequent PR previews also work.

- [ ] **Step 2: Push the branch + open PR**

Get the branch name first (`git branch --show-current`), then:

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "feat(dashboard): fleet homepage at / (Phase 2)" --body "$(cat <<'EOF'
## Summary
- New Netlify function at / renders a password-gated fleet homepage listing every site in the Airtable Websites table.
- Each row links to its per-site /s/<slug>?t=<token> page (Phase 1).
- HTTP Basic Auth against new DASHBOARD_PASSWORD env var; username is ignored.
- Sites without a Dashboard Token render with a "no token" badge so the homepage doubles as a setup-progress view.

## What's NOT in this PR
- Click-to-trigger audit button → Phase 2b (GitHub Actions workflow_dispatch)
- Extending audit --write-airtable for lint/deps/security/a11y → Phase 2c

## Test plan
- [x] vitest, typecheck, lint, build, test:dist all green locally
- [ ] DASHBOARD_PASSWORD set in Netlify site env
- [ ] Deploy preview /: 401 + browser auth prompt without credentials
- [ ] With wrong password: 401 (browser re-prompts)
- [ ] With right password: 200 HTML listing all sites
- [ ] Clicking a site row with a token navigates to its per-site dashboard
- [ ] Sites without a token render with the "no token" badge
EOF
)"
```

- [ ] **Step 3: Verify the 401 challenge on the deploy preview**

After the deploy preview URL is ready, in a terminal:

```bash
curl -i "https://<deploy-preview-url>/" 2>&1 | head -8
```

Expected:

- `HTTP/2 401`
- `www-authenticate: Basic realm="Reddoor fleet"`
- Body: `Authentication required.`

- [ ] **Step 4: Verify a wrong password is rejected**

```bash
curl -i -u "anything:wrongpass" "https://<deploy-preview-url>/" 2>&1 | head -8
```

Expected: HTTP 401 with the same `www-authenticate` header.

- [ ] **Step 5: Verify the right password renders the homepage**

```bash
curl -i -u "any:<your-DASHBOARD_PASSWORD>" "https://<deploy-preview-url>/" 2>&1 | head -8
```

Expected: HTTP 200, `content-type: text/html`. Pipe the body to a file and grep for some known site name to confirm Airtable read worked:

```bash
curl -s -u "any:<your-DASHBOARD_PASSWORD>" "https://<deploy-preview-url>/" | grep -oE '>CalTex<|>caltex<' | head -2
```

Expected: matches the CalTex row.

- [ ] **Step 6: Open the URL in a browser**

`https://<deploy-preview-url>/` — browser should prompt for credentials. Enter any username, the password from step 1. After auth: visual check that the table renders, sites are sorted alphabetically, CalTex row's link points to `/s/caltex?t=<token>` (hover the link to confirm), unconfigured sites show the "no token" badge.

Click the CalTex link → should land on the Phase 1 per-site dashboard with real scores. Loop closed end-to-end.

- [ ] **Step 7: Merge the PR**

Once preview checks pass, merge to main. Changesets workflow picks this up as a minor bump on the next release.

- [ ] **Step 8: Verify on production**

After the release PR lands and 0.12.0 (or whatever) publishes:

```bash
curl -i -u "any:<password>" "https://reddoor-maintenance.netlify.app/" | head -8
```

Expected: HTTP 200, same HTML as preview.

---

## Task 6: Add a changeset

**Files:**

- Create: `.changeset/site-dashboard-phase-2.md`

- [ ] **Step 1: Create the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

Phase 2 of the site dashboard: a password-gated fleet homepage at `/` listing every site in the Airtable Websites table. Each row links to its per-site `/s/<slug>?t=<token>` page (Phase 1). HTTP Basic Auth against a new `DASHBOARD_PASSWORD` env var (Netlify site env); username is ignored. Sites without a `Dashboard Token` set render with a "no token" badge so the homepage doubles as a setup-progress view.

Operator setup: set `DASHBOARD_PASSWORD` in the Netlify site env (any value), then visit `https://<netlify-domain>/`. Browser prompts for credentials; type anything for username, the configured value for password.

Phase 2b (click-to-trigger audit per site, via GitHub Actions workflow_dispatch) and Phase 2c (extending `audit --write-airtable` to persist lint/deps/security/a11y findings) are deferred to separate plans.
```

- [ ] **Step 2: Commit**

```
chore(changeset): site-dashboard phase 2 (minor)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Done criteria

Phase 2 is done when:

1. ✅ `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:dist` all pass locally.
2. ✅ Deploy preview `/` returns 401 + browser auth prompt without credentials.
3. ✅ Right-password request returns 200 HTML listing all sites, sorted alphabetically.
4. ✅ Clicking a site row with a token navigates to its per-site dashboard (Phase 1) and renders.
5. ✅ Sites without a token render with the "no token" badge and don't link.
6. ✅ `DASHBOARD_PASSWORD` documented in the changeset operator-setup step.

After merge + publish, the natural next plan is Phase 2b (click-to-trigger audit button — GitHub Actions workflow_dispatch).
