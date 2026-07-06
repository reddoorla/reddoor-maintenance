# Health Gate Plan 2 — Health audits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship spec Phases 2 and 3 in reddoor-maintenance: (2) a new checkout-free `function-health` audit that GETs `{deployedUrl}/health`, self-skips when there is no usable report, and persists a `Function health` verdict + a `CMS Reachable` verdict (from `details.prismic === "ok"`) + a `Function health checked at` freshness stamp — kept SEPARATE from Netlify `Deploy status`; and (3) two new browser-audit verdicts, `reachableOk` (every sampled route 2xx/3xx) and `titleMetaOk` (chromium title ≤ 70 + meta description + no duplicate titles), persisted as tri-state single-select columns gated by the existing `browserCheckedAt`, plus the deploy-freshness read-back fix (`deployCheckedAt`). This plan PRODUCES and PERSISTS these columns only; the auto-tick evidence functions that read them are Plan 4.

**Architecture:** Every new signal follows the established `domain.ts` vertical slice — a pure core + injected deps + graceful self-skip (no details ⇒ the Airtable writer preserves the prior cell). `function-health` mirrors `netlify-deploy`'s read/no-read split (`HealthFetch = {present:false} | {present:true; body}`): unreachable / non-2xx / non-JSON ⇒ `present:false` ⇒ `status:"skip"` with no `details` ⇒ `hasFunctionHealthResult` false ⇒ writer skips ⇒ the verdict stays "never ran" (Plan 4 maps that to amber/unknown, which blocks). A 200 JSON body ⇒ `ok:true`→pass, else→fail. The browser extension emits the two new verdicts from data already gathered on pages Playwright already opens (the chromium `goto` response status + one `page.title()` + one `meta[name=description]` read), reduced in the existing pure `summarizeBrowser`, and persisted through the existing `browser` write path. New verdict columns are Airtable **single-select `pass`/`fail`** (empty = never ran); `WebsiteRow` types are `"pass" | "fail" | null`.

**Tech Stack:** TypeScript (NodeNext — relative imports carry `.js`); Vitest (node env, `tests/**/*.test.ts`); global `fetch` + `AbortSignal.timeout`; Playwright (integration only, dep-injected in unit tests); Airtable (`import type` only in the audit graph — the `test:dist` gate forbids the audit import graph reaching central-only packages); dual `tsc` typecheck (`tsconfig.json` + `tsconfig.netlify.json`); eslint (`no-explicit-any`) + prettier; coverage floors statements 78 / branches 67 / functions 76 / lines 80 over `src/**/*.ts` (every new `src` file needs a test).

---

## File Structure

**Created**

- `src/audits/function-health.ts` — checkout-free `/health` fetch audit: pure `parseHealthBody` core + injected `FunctionHealthDeps` + graceful skip; `ok:true`→pass, `ok:false`→fail, no usable report→skip.
- `src/audits/function-health-airtable.ts` — `hasFunctionHealthResult` guard (`details.checkedAt`) + `functionHealthResultFromAudit` extractor (→ `FunctionHealthResult`), `import type` only.
- `tests/audits/function-health.test.ts` — unit tests for `parseHealthBody`, `functionHealthAudit`, `defaultFunctionHealthDeps`.
- `tests/audits/function-health-airtable.test.ts` — unit tests for the guard + extractor (pass/fail/cms mapping/throw).

**Modified**

- `src/types.ts` — `AuditName` gains `"function-health"`.
- `src/audits/util/inject.ts` — `AuditContext` gains `functionHealthDeps?`.
- `src/audits/index.ts` — import `functionHealthAudit`; add it to `REGISTRY`.
- `src/audits/browser.ts` — `RouteResult` gains `status`/`title`/`metaDescription`; `BrowserSummary` gains `reachableOk`/`titleMetaOk`; `summarizeBrowser` computes them; `defaultBrowserRunner` captures them from the chromium pass.
- `src/audits/browser-airtable.ts` — `BrowserDetails` + `browserFieldsFromAudit` carry `reachableOk`/`titleMetaOk`.
- `src/reports/airtable/websites.ts` — `WebsiteRow` gains `functionHealth`/`cmsReachable`/`functionHealthCheckedAt`/`deployCheckedAt`/`reachableOk`/`titleMetaOk`; `mapRow` reads all six; new `FunctionHealthResult` type + `functionHealthFields` writer + `updateAuditFields` slice; `BrowserAuditFields` + `browserFields` gain the two verdicts.
- `src/audits/write-audits-to-airtable.ts` — collect-and-write block for `function-health`; `WriteSummary` audit union gains `"function-health"`.
- `src/cli/commands/audit.ts` — `CHECKOUT_FREE_AUDITS` gains `"function-health"`.
- `.github/workflows/fleet-lighthouse.yml` — the nightly `--only` list gains `function-health`.
- `tests/_helpers/website-row.ts` — defaults for the six new `WebsiteRow` fields.
- `tests/reports/airtable/websites-mapping.test.ts` — read-back assertions for the six new fields.
- `tests/audits/browser.test.ts` — `summarizeBrowser` + `browserAudit` assertions for the two new verdicts.
- `tests/audits/write-audits-to-airtable.test.ts` — a `function-health` merge test + extended browser-merge assertions.

---

### Task 1: WebsiteRow fields + mapRow read-back (function-health verdicts + deploy-freshness fix)

Data layer only: add the four function-health/deploy `WebsiteRow` fields and their `mapRow` read-backs. No writers/producers yet (they land in Task 3), so these read as `null` in production until wired — harmless. This also lands the **deploy-freshness read-back fix**: `netlify-deploy` already WRITES `Deploy checked at` but `mapRow` never read it, so `deployEvidence` (Plan 4) had no check-time stamp.

**Files:** Modify `src/reports/airtable/websites.ts`, `tests/_helpers/website-row.ts` (Test), `tests/reports/airtable/websites-mapping.test.ts` (Test)

- [ ] **Step 1: Branch.**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git checkout main && git pull --ff-only && git checkout -b feat/health-gate-audits
```

- [ ] **Step 2: Write the failing mapRow read-back test.** Append to `tests/reports/airtable/websites-mapping.test.ts` (the `row()` helper is already defined at the top of that file):

```ts
describe("websites/mapRow → function-health + deploy-freshness fields", () => {
  it("maps the Function health single-select (pass/fail/null)", () => {
    expect(row({ "Function health": "pass" }).functionHealth).toBe("pass");
    expect(row({ "Function health": "fail" }).functionHealth).toBe("fail");
    expect(row({}).functionHealth).toBeNull();
  });

  it("maps the CMS Reachable single-select (pass/fail/null)", () => {
    expect(row({ "CMS Reachable": "pass" }).cmsReachable).toBe("pass");
    expect(row({ "CMS Reachable": "fail" }).cmsReachable).toBe("fail");
    expect(row({}).cmsReachable).toBeNull();
  });

  it("maps Function health checked at (freshness stamp for functionHealth AND cmsReachable)", () => {
    expect(
      row({ "Function health checked at": "2026-07-06T00:00:00.000Z" }).functionHealthCheckedAt,
    ).toBe("2026-07-06T00:00:00.000Z");
    expect(row({}).functionHealthCheckedAt).toBeNull();
  });

  it("reads back Deploy checked at (the freshness fix — netlify-deploy already writes it)", () => {
    expect(row({ "Deploy checked at": "2026-07-06T01:00:00.000Z" }).deployCheckedAt).toBe(
      "2026-07-06T01:00:00.000Z",
    );
    expect(row({}).deployCheckedAt).toBeNull();
  });
});
```

- [ ] **Step 3: Run it — confirm it fails.** `functionHealth` etc. are not yet on `WebsiteRow`, so this fails to typecheck/run.

```bash
pnpm exec vitest run tests/reports/airtable/websites-mapping.test.ts
```

Expected: FAIL — e.g. `Property 'functionHealth' does not exist on type 'WebsiteRow'` (and the four `expect(...).toBe(...)` assertions never reached).

- [ ] **Step 4: Add the fields to `WebsiteRow`.** In `src/reports/airtable/websites.ts`, insert after the `deployLogUrl: string | null;` line (currently line 125, end of the netlify deploy block):

```ts
/** When the `netlify-deploy` audit last RAN (freshness stamp for `deployStatus`). The audit
 *  already writes "Deploy checked at"; this read-back is the Plan-2 fix so `deployEvidence`
 *  (Plan 4) can gate on check time — NOT on `lastDeployAt`, which is deploy time, not check time. */
deployCheckedAt: string | null;
/** Function-health verdict (the `function-health` audit): the deployed `/health` function
 *  answered `ok:true` (pass) or `ok:false` (fail). Single-select `pass`/`fail`; null = never ran
 *  / unreachable (→ Plan 4 maps to unknown/amber). Kept SEPARATE from `deployStatus` so
 *  `isFailedDeployStatus` keeps meaning "the build failed". */
functionHealth: "pass" | "fail" | null;
/** CMS reachability (server-side), derived from the same `/health` body's `details.prismic ===
 *  "ok"`. Single-select `pass`/`fail`; null = never ran. No per-site Prismic token or identity
 *  column is ever built — this rides `/health`. */
cmsReachable: "pass" | "fail" | null;
/** When the `function-health` audit last ran — the freshness gate for BOTH `functionHealth` and
 *  `cmsReachable`. Null = never ran. */
functionHealthCheckedAt: string | null;
```

Then, still in `WebsiteRow`, add the two browser verdict fields after `browserCheckedAt: string | null;` (currently line 132):

```ts
/** Uptime-reachable verdict (browser audit): every sampled route returned 2xx/3xx. Single-select
 *  `pass`/`fail`; null = never ran. Point-in-time. Freshness-gated by `browserCheckedAt`. */
reachableOk: "pass" | "fail" | null;
/** Titles & meta verdict (browser audit, chromium): every sampled route has a non-empty `<title>`
 *  ≤ 70 chars + a non-empty meta description, and no duplicate titles across the sample.
 *  Single-select `pass`/`fail`; null = never ran. Freshness-gated by `browserCheckedAt`. */
titleMetaOk: "pass" | "fail" | null;
```

- [ ] **Step 5: Add the six `mapRow` read-backs.** In `mapRow`, after the `deployLogUrl: (f["Deploy log URL"] as string | undefined) ?? null,` line, insert:

```ts
    deployCheckedAt: (f["Deploy checked at"] as string | undefined) ?? null,
    functionHealth: (f["Function health"] as "pass" | "fail" | undefined) ?? null,
    cmsReachable: (f["CMS Reachable"] as "pass" | "fail" | undefined) ?? null,
    functionHealthCheckedAt: (f["Function health checked at"] as string | undefined) ?? null,
```

And after the `browserCheckedAt: (f["Browser checked at"] as string | undefined) ?? null,` line, insert:

```ts
    reachableOk: (f["Uptime Reachable"] as "pass" | "fail" | undefined) ?? null,
    titleMetaOk: (f["Titles & Meta OK"] as "pass" | "fail" | undefined) ?? null,
```

- [ ] **Step 6: Update the shared `WebsiteRow` test factory.** In `tests/_helpers/website-row.ts`, after `deployLogUrl: null,` add:

```ts
    deployCheckedAt: null,
    functionHealth: null,
    cmsReachable: null,
    functionHealthCheckedAt: null,
```

and after `browserCheckedAt: null,` add:

```ts
    reachableOk: null,
    titleMetaOk: null,
```

- [ ] **Step 7: Run the read-back test — confirm it passes.**

```bash
pnpm exec vitest run tests/reports/airtable/websites-mapping.test.ts
```

Expected: PASS (the new `describe` block green; all prior assertions still green).

- [ ] **Step 8: Typecheck (both configs — the factory change touches every row-building test).**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 9: Commit.**

```bash
git add src/reports/airtable/websites.ts tests/_helpers/website-row.ts tests/reports/airtable/websites-mapping.test.ts
git commit -m "feat(audits): WebsiteRow function-health verdicts + deploy-freshness read-back"
```

---

### Task 2: The `function-health` audit (pure core + injected deps + registration)

Create the checkout-free audit and register it (adding `"function-health"` to `AuditName` forces the exhaustive `REGISTRY` to include it, so type + audit + registry land together). No write-back yet.

**Files:** Create `src/audits/function-health.ts`, `tests/audits/function-health.test.ts` (Test); Modify `src/types.ts`, `src/audits/util/inject.ts`, `src/audits/index.ts`

- [ ] **Step 1: Write the failing audit test.** Create `tests/audits/function-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseHealthBody,
  functionHealthAudit,
  defaultFunctionHealthDeps,
  type FunctionHealthDeps,
  type HealthFetch,
} from "../../src/audits/function-health.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");

function deps(over: Partial<FunctionHealthDeps> = {}): FunctionHealthDeps {
  return {
    fetchHealth: async (): Promise<HealthFetch> => ({
      present: true,
      body: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: false },
      },
    }),
    now: NOW,
    ...over,
  };
}

const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

describe("parseHealthBody", () => {
  it("accepts a well-formed body", () => {
    expect(
      parseHealthBody({
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: false, turnstile: true },
      }),
    ).toEqual({
      present: true,
      body: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: false, turnstile: true },
      },
    });
  });

  it("coerces an unknown prismic value and a missing forms object to null", () => {
    expect(parseHealthBody({ ok: false, prismic: "weird" })).toEqual({
      present: true,
      body: { ok: false, prismic: null, forms: null },
    });
  });

  it("rejects a non-object / missing-ok body as not-present", () => {
    expect(parseHealthBody(null)).toEqual({ present: false });
    expect(parseHealthBody("nope")).toEqual({ present: false });
    expect(parseHealthBody({ prismic: "ok" })).toEqual({ present: false });
    expect(parseHealthBody({ ok: "yes" })).toEqual({ present: false });
  });
});

describe("functionHealthAudit", () => {
  it("skips a site with no deployed URL (no details)", async () => {
    const r = await functionHealthAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("no deployed URL");
    expect(r.details).toBeUndefined();
  });

  it("passes + records details when /health is ok:true", async () => {
    const r = await functionHealthAudit({ site, now: NOW, functionHealthDeps: deps() });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ ok: true, prismic: "ok" });
    expect((r.details as { checkedAt: string }).checkedAt).toBe(NOW.toISOString());
  });

  it("fails (records details) when /health answers ok:false", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({
        fetchHealth: async () => ({
          present: true,
          body: { ok: false, prismic: "error", forms: null },
        }),
      }),
    });
    expect(r.status).toBe("fail");
    expect(r.details).toMatchObject({ ok: false, prismic: "error" });
  });

  it("self-skips with NO details when there is no usable report (preserve prior)", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({ fetchHealth: async () => ({ present: false }) }),
    });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("health endpoint unreachable / not JSON");
    expect(r.details).toBeUndefined();
  });

  it("treats a deps throw as a self-skip (never propagates past the audit)", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({
        fetchHealth: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });
});

describe("defaultFunctionHealthDeps (real-shape, injected fetch — no network)", () => {
  it("GETs {deployedUrl}/health with a timeout signal and parses the body", async () => {
    let calledUrl = "";
    let hadSignal = false;
    const fakeFetch = (async (url: string, init?: { signal?: AbortSignal }) => {
      calledUrl = String(url);
      hadSignal = init?.signal instanceof AbortSignal;
      return { ok: true, json: async () => ({ ok: true, prismic: "ok", forms: null }) };
    }) as unknown as typeof fetch;
    const d = defaultFunctionHealthDeps(NOW, fakeFetch);
    const r = await d.fetchHealth("https://acme.example.com");
    expect(calledUrl).toBe("https://acme.example.com/health");
    expect(hadSignal).toBe(true);
    expect(r).toEqual({ present: true, body: { ok: true, prismic: "ok", forms: null } });
  });

  it("returns {present:false} on a non-2xx response (couldn't read)", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: false,
    });
  });

  it("returns {present:false} when fetch rejects (network error / timeout)", async () => {
    const fakeFetch = (async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: false,
    });
  });

  it("returns {present:false} on a non-JSON body", async () => {
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: false,
    });
  });
});
```

- [ ] **Step 2: Run it — confirm it fails.** The module does not exist yet.

```bash
pnpm exec vitest run tests/audits/function-health.test.ts
```

Expected: FAIL — `Cannot find module '../../src/audits/function-health.js'`.

- [ ] **Step 3: Add `"function-health"` to `AuditName`.** In `src/types.ts`, change the `AuditName` union to:

```ts
export type AuditName =
  | "deps"
  | "lighthouse"
  | "a11y"
  | "security"
  | "lint"
  | "domain"
  | "browser"
  | "netlify-deploy"
  | "function-health";
```

- [ ] **Step 4: Create the audit.** Create `src/audits/function-health.ts`:

```ts
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** The parts of the deployed `/health` body this audit reads. `ok` is the endpoint's self-rollup
 *  (`functionRan && prismic !== "error"`); `prismic` is the server-side CMS probe status; `forms`
 *  are booleans recorded for the dashboard only. A public endpoint can return anything, so every
 *  field is validated/coerced by `parseHealthBody`. */
export type HealthBody = {
  ok: boolean;
  prismic: "ok" | "error" | "skipped" | null;
  forms: { ingestUrl: boolean; ingestToken: boolean; turnstile: boolean } | null;
};

/** Outcome of fetching `{deployedUrl}/health`, distinguishing "no usable report" (`present:false`
 *  → self-skip, the writer preserves the prior verdict) from "read a 200 JSON body" (`present:true`
 *  → a real pass/fail). Mirrors `netlify-deploy`'s `NetlifyDeployFetch` read/no-read split. */
export type HealthFetch = { present: false } | { present: true; body: HealthBody };

/** Injected IO so the audit is unit-testable without a network. `fetchHealth` returns a
 *  `HealthFetch`; `now` is the clock for the checked-at stamp. */
export type FunctionHealthDeps = {
  fetchHealth: (deployedUrl: string) => Promise<HealthFetch>;
  now: Date;
};

const HEALTH_TIMEOUT_MS = 10_000;

/** Coerce an untrusted `/health` JSON payload into a `HealthFetch`. PURE. A non-object, or a body
 *  without a boolean `ok`, is `{present:false}` (not a usable report). An unrecognized `prismic`
 *  or a missing/!object `forms` degrades that field to null but keeps the body present. */
export function parseHealthBody(raw: unknown): HealthFetch {
  if (!raw || typeof raw !== "object") return { present: false };
  const o = raw as Record<string, unknown>;
  if (typeof o["ok"] !== "boolean") return { present: false };
  const prismic =
    o["prismic"] === "ok" || o["prismic"] === "error" || o["prismic"] === "skipped"
      ? (o["prismic"] as "ok" | "error" | "skipped")
      : null;
  const f = o["forms"];
  const forms =
    f && typeof f === "object"
      ? {
          ingestUrl: (f as Record<string, unknown>)["ingestUrl"] === true,
          ingestToken: (f as Record<string, unknown>)["ingestToken"] === true,
          turnstile: (f as Record<string, unknown>)["turnstile"] === true,
        }
      : null;
  return { present: true, body: { ok: o["ok"], prismic, forms } };
}

/** Real fetch deps. GETs `{deployedUrl}/health` with a 10s abort timeout. ANY failure to obtain a
 *  usable 200 JSON body — network error, timeout, non-2xx, non-JSON, wrong shape — resolves to
 *  `{present:false}` (self-skip → preserve prior). NEVER throws, so one site's dead endpoint can't
 *  red an unrelated site in the fleet sweep. `fetchImpl` is injected only so the default deps stay
 *  testable; production callers pass nothing. */
export function defaultFunctionHealthDeps(
  now: Date,
  fetchImpl: typeof fetch = fetch,
): FunctionHealthDeps {
  return {
    now,
    fetchHealth: async (deployedUrl): Promise<HealthFetch> => {
      let url: string;
      try {
        // Root `/health` — an absolute path replaces any path on the deployed URL.
        url = new URL("/health", deployedUrl).toString();
      } catch {
        return { present: false }; // unparseable deployed URL — nothing to probe
      }
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      } catch {
        return { present: false }; // network error / timeout — couldn't read
      }
      if (!res.ok) return { present: false }; // non-2xx — couldn't read
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { present: false }; // non-JSON — couldn't read
      }
      return parseHealthBody(body);
    },
  };
}

/**
 * Audit a site's deployed `/health` function. Checkout-free — needs only `site.deployedUrl`. Skips
 * a site with no deployed URL. Semantics (spec Phase 2):
 *  - no usable report (unreachable / non-2xx / non-JSON) → `skip` WITHOUT details → the Airtable
 *    writer preserves the prior verdict (a site that hasn't adopted `/health`, or a transient
 *    outage, stays "never ran"; Plan 4 maps that to unknown/amber, which blocks).
 *  - a 200 JSON body with `ok:false` → `fail` (records details so the fail persists).
 *  - a 200 JSON body with `ok:true` → `pass` (records details).
 * `details` carries `{ ok, prismic, forms, checkedAt }`; the Airtable layer derives the
 * `Function health` + `CMS Reachable` verdicts (CMS from `prismic === "ok"`) + the checked-at stamp.
 * It must NEVER write `Deploy status` — that stays the Netlify build state.
 */
export async function functionHealthAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "function-health", site: label, status: "skip", summary: "no deployed URL" };
  }
  const now = ctx.now ?? new Date();
  const deps = ctx.functionHealthDeps ?? defaultFunctionHealthDeps(now);
  const fetched: HealthFetch = await deps
    .fetchHealth(site.deployedUrl)
    .catch(() => ({ present: false }) as HealthFetch);

  if (!fetched.present) {
    return {
      audit: "function-health",
      site: label,
      status: "skip",
      summary: "health endpoint unreachable / not JSON",
    };
  }
  const checkedAt = now.toISOString();
  const status: AuditResult["status"] = fetched.body.ok ? "pass" : "fail";
  const summary = `health ${fetched.body.ok ? "ok" : "not ok"} (prismic ${fetched.body.prismic ?? "?"})`;
  return {
    audit: "function-health",
    site: label,
    status,
    summary,
    details: {
      ok: fetched.body.ok,
      prismic: fetched.body.prismic,
      forms: fetched.body.forms,
      checkedAt,
    },
  };
}
```

- [ ] **Step 5: Inject the deps.** In `src/audits/util/inject.ts`, add the import after the `NetlifyDeployDeps` import:

```ts
import type { FunctionHealthDeps } from "../function-health.js";
```

and add to the `AuditContext` type (after the `netlifyDeployDeps?` member):

```ts
  /** `/health` fetch injection for the function-health audit (tests). Defaults to a real GET. */
  functionHealthDeps?: FunctionHealthDeps;
```

- [ ] **Step 6: Register the audit.** In `src/audits/index.ts`, add the import after the `netlifyDeployAudit` import:

```ts
import { functionHealthAudit } from "./function-health.js";
```

and add the `REGISTRY` entry after the `"netlify-deploy": netlifyDeployAudit,` line:

```ts
  "function-health": functionHealthAudit,
```

- [ ] **Step 7: Run the audit test — confirm it passes.**

```bash
pnpm exec vitest run tests/audits/function-health.test.ts
```

Expected: PASS (all cases green).

- [ ] **Step 8: Typecheck (proves `AuditName`/`REGISTRY`/`inject` line up).**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 9: Commit.**

```bash
git add src/types.ts src/audits/function-health.ts src/audits/util/inject.ts src/audits/index.ts tests/audits/function-health.test.ts
git commit -m "feat(audits): checkout-free function-health audit (/health fetch, self-skip)"
```

---

### Task 3: Persist function-health (airtable extractor + writer + write path + checkout-free + nightly)

Wire the verdict through the write-back: an `-airtable` extractor, a `FunctionHealthResult` type + `functionHealthFields` writer + `updateAuditFields` slice, the collect-and-write block, the `CHECKOUT_FREE_AUDITS` entry, and the nightly workflow's `--only` list.

**Files:** Create `src/audits/function-health-airtable.ts`, `tests/audits/function-health-airtable.test.ts` (Test); Modify `src/reports/airtable/websites.ts`, `src/audits/write-audits-to-airtable.ts`, `src/cli/commands/audit.ts`, `.github/workflows/fleet-lighthouse.yml`, `tests/audits/write-audits-to-airtable.test.ts` (Test)

- [ ] **Step 1: Write the failing extractor test.** Create `tests/audits/function-health-airtable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hasFunctionHealthResult,
  functionHealthResultFromAudit,
} from "../../src/audits/function-health-airtable.js";
import type { AuditResult } from "../../src/types.js";

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    audit: "function-health",
    site: "acme",
    status: "pass",
    summary: "health ok (prismic ok)",
    details: { ok: true, prismic: "ok", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    ...over,
  };
}

describe("hasFunctionHealthResult", () => {
  it("is true for a function-health audit with a details payload", () => {
    expect(hasFunctionHealthResult(result())).toBe(true);
  });
  it("is false for a non-function-health audit", () => {
    expect(
      hasFunctionHealthResult({ audit: "domain", site: "x", status: "pass", summary: "" }),
    ).toBe(false);
  });
  it("is false for a self-skipped audit (no details → writer preserves prior)", () => {
    expect(hasFunctionHealthResult(result({ status: "skip", details: undefined }))).toBe(false);
  });
});

describe("functionHealthResultFromAudit", () => {
  it("maps ok:true + prismic ok → pass / pass", () => {
    expect(functionHealthResultFromAudit(result())).toEqual({
      functionHealth: "pass",
      cmsReachable: "pass",
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
  });
  it("maps ok:false → functionHealth fail", () => {
    const r = result({
      details: { ok: false, prismic: "ok", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(r).functionHealth).toBe("fail");
  });
  it("maps any non-ok prismic (error/skipped/null) → cmsReachable fail", () => {
    const err = result({
      details: { ok: true, prismic: "error", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    const skip = result({
      details: { ok: true, prismic: "skipped", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(err).cmsReachable).toBe("fail");
    expect(functionHealthResultFromAudit(skip).cmsReachable).toBe("fail");
  });
  it("throws for a non-function-health audit", () => {
    expect(() =>
      functionHealthResultFromAudit({ audit: "domain", site: "x", status: "pass", summary: "" }),
    ).toThrow(/Expected a 'function-health'/);
  });
});
```

- [ ] **Step 2: Run it — confirm it fails.** The extractor module does not exist.

```bash
pnpm exec vitest run tests/audits/function-health-airtable.test.ts
```

Expected: FAIL — `Cannot find module '../../src/audits/function-health-airtable.js'`.

- [ ] **Step 3: Add the `FunctionHealthResult` type + `functionHealthFields` writer.** In `src/reports/airtable/websites.ts`, add the type after the `NetlifyDeployResult` type (after its closing `};`, ~line 388):

```ts
export type FunctionHealthResult = {
  /** `pass` when `/health` answered `ok:true`, else `fail`. Never null — the audit only produces a
   *  result when it ran (a self-skip carries no details, so this extractor isn't reached). */
  functionHealth: "pass" | "fail";
  /** `pass` when the same body's `prismic === "ok"`, else `fail`. */
  cmsReachable: "pass" | "fail";
  /** When the audit ran (freshness stamp for both verdicts). */
  checkedAt: string;
};
```

Add the writer after `netlifyDeployFields` (after its closing `}`, ~line 536):

```ts
function functionHealthFields(r: FunctionHealthResult): FieldSet {
  // Single-select verdicts: the audit only supplies a result when it actually ran (a self-skip is
  // dropped before this writer), so both verdicts are always a concrete pass/fail — there is no
  // null-clear case here. Written SEPARATELY from "Deploy status" so the Netlify build state keeps
  // its own meaning.
  return {
    "Function health": r.functionHealth,
    "CMS Reachable": r.cmsReachable,
    "Function health checked at": r.checkedAt,
  };
}
```

- [ ] **Step 4: Add the `updateAuditFields` slice.** In `src/reports/airtable/websites.ts`, extend the `updateAuditFields` `audits` parameter type by adding after `netlifyDeploy?: NetlifyDeployResult;` (~line 668):

```ts
    functionHealth?: FunctionHealthResult;
```

and add the merge after `if (audits.netlifyDeploy) Object.assign(fields, netlifyDeployFields(audits.netlifyDeploy));` (~line 682):

```ts
if (audits.functionHealth) Object.assign(fields, functionHealthFields(audits.functionHealth));
```

- [ ] **Step 5: Create the extractor.** Create `src/audits/function-health-airtable.ts` (`import type` only — the audit import graph must not statically reach the airtable runtime; `test:dist` enforces this):

```ts
import type { AuditResult } from "../types.js";
import type { FunctionHealthResult } from "../reports/airtable/websites.js";

type FunctionHealthDetails = {
  ok: boolean;
  prismic: "ok" | "error" | "skipped" | null;
  forms: unknown;
  checkedAt: string;
};

/** True when an AuditResult is a `function-health` audit carrying a usable details payload (i.e. it
 *  actually ran — a self-skip for an unreachable / non-JSON `/health`, or a site with no deployed
 *  URL, has no details, so the writer preserves the prior verdict). */
export function hasFunctionHealthResult(result: AuditResult): boolean {
  if (result.audit !== "function-health") return false;
  const d = result.details as FunctionHealthDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable function-health verdicts. `functionHealth` from `ok`; `cmsReachable`
 *  from `prismic === "ok"` (the server-side CMS probe folded into `/health` — no per-site token). */
export function functionHealthResultFromAudit(result: AuditResult): FunctionHealthResult {
  if (result.audit !== "function-health") {
    throw new Error(`Expected a 'function-health' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as FunctionHealthDetails | undefined;
  return {
    functionHealth: d?.ok === true ? "pass" : "fail",
    cmsReachable: d?.prismic === "ok" ? "pass" : "fail",
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
```

- [ ] **Step 6: Run both airtable tests — confirm they pass.**

```bash
pnpm exec vitest run tests/audits/function-health-airtable.test.ts
```

Expected: PASS.

- [ ] **Step 7: Write the failing write-path test.** Append to `tests/audits/write-audits-to-airtable.test.ts` (the `makeFakeBase`, `row`, and `lhResult` helpers are already defined at the top of the file):

```ts
it("merges the function-health verdicts into the single atomic write", async () => {
  const { base, calls } = makeFakeBase();
  const fhResult: AuditResult = {
    audit: "function-health",
    site: "acme",
    status: "pass",
    summary: "health ok (prismic ok)",
    details: { ok: true, prismic: "ok", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
  } as unknown as AuditResult;
  await writeAuditsToAirtable({
    base,
    websites: [row()],
    slug: "acme",
    results: [
      lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
      fhResult,
    ],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.fields).toMatchObject({
    "Function health": "pass",
    "CMS Reachable": "pass",
    "Function health checked at": "2026-07-06T00:00:00.000Z",
  });
  // Must NOT touch Deploy status — function-health is separate from the Netlify build state.
  expect(calls[0]!.fields).not.toHaveProperty("Deploy status");
});

it("does NOT write a function-health verdict when the audit self-skipped (no details)", async () => {
  const { base, calls } = makeFakeBase();
  const skipped: AuditResult = {
    audit: "function-health",
    site: "acme",
    status: "skip",
    summary: "health endpoint unreachable / not JSON",
  } as unknown as AuditResult;
  await writeAuditsToAirtable({
    base,
    websites: [row()],
    slug: "acme",
    results: [
      lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
      skipped,
    ],
  });
  expect(calls[0]!.fields).not.toHaveProperty("Function health");
});
```

- [ ] **Step 8: Run it — confirm it fails.** The collect-and-write block isn't wired.

```bash
pnpm exec vitest run tests/audits/write-audits-to-airtable.test.ts
```

Expected: FAIL — `Function health` absent from the written fields (`toMatchObject` mismatch).

- [ ] **Step 9: Wire the collect-and-write block.** In `src/audits/write-audits-to-airtable.ts`:

Add to the imports of extractor fns (after the `hasNetlifyDeployResult` import line):

```ts
import {
  hasFunctionHealthResult,
  functionHealthResultFromAudit,
} from "./function-health-airtable.js";
```

Add `FunctionHealthResult` to the `import type { ... } from "../reports/airtable/websites.js"` list (after `NetlifyDeployResult,`):

```ts
  FunctionHealthResult,
```

Extend the `WriteSummary` audit union — add after `| "netlify-deploy"`:

```ts
      | "function-health"
```

Extend the local `audits` object type — add after `netlifyDeploy?: NetlifyDeployResult;`:

```ts
    functionHealth?: FunctionHealthResult;
```

Add the collect block after the existing `netlify-deploy` block (after its closing `}`, ~line 150):

```ts
const functionHealth = results.find((r) => r.audit === "function-health");
if (functionHealth && hasFunctionHealthResult(functionHealth)) {
  const result = functionHealthResultFromAudit(functionHealth);
  audits.functionHealth = result;
  writes.push({ audit: "function-health", counts: result });
}
```

- [ ] **Step 10: Add to `CHECKOUT_FREE_AUDITS`.** In `src/cli/commands/audit.ts`, change the `CHECKOUT_FREE_AUDITS` set to include `"function-health"`:

```ts
const CHECKOUT_FREE_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>([
  "lighthouse",
  "domain",
  "browser",
  "netlify-deploy",
  "function-health",
]);
```

(It is keyed off `site.deployedUrl`, so leave `NETLIFY_ID_AUDITS` unchanged — `auditNeedsCheckout` already gates non-netlify checkout-free audits on `deployedUrl`.)

- [ ] **Step 11: Add it to the nightly checkout-free sweep.** In `.github/workflows/fleet-lighthouse.yml`, change the `--only` line in the "Fleet Lighthouse + domain + browser audit + Airtable write-back" step from:

```yaml
--only lighthouse,domain,browser,netlify-deploy \
```

to:

```yaml
--only lighthouse,domain,browser,netlify-deploy,function-health \
```

- [ ] **Step 12: Run the write-path test — confirm it passes.**

```bash
pnpm exec vitest run tests/audits/write-audits-to-airtable.test.ts
```

Expected: PASS (both new cases green; existing merge tests still green).

- [ ] **Step 13: Typecheck + lint + build + dist-smoke (the extractor must not drag airtable into the audit graph).**

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test:dist
```

Expected: exit 0 for each; `test:dist` prints its checks with `✓` (no central-only import reached from the CLI/forms/configs entries).

- [ ] **Step 14: Commit.**

```bash
git add src/audits/function-health-airtable.ts src/reports/airtable/websites.ts src/audits/write-audits-to-airtable.ts src/cli/commands/audit.ts .github/workflows/fleet-lighthouse.yml tests/audits/function-health-airtable.test.ts tests/audits/write-audits-to-airtable.test.ts
git commit -m "feat(audits): persist function-health + CMS verdicts; add to nightly checkout-free sweep"
```

---

### Task 4: Browser audit emits `reachableOk` + `titleMetaOk`

Extend the existing Playwright browser audit to emit two new verdicts from data on pages it already opens: the chromium `goto` response status (`reachableOk`) and one `page.title()` + one `meta[name=description]` read (`titleMetaOk`). The reduction lives in the pure `summarizeBrowser`, so it is fully unit-testable; the real `defaultBrowserRunner` captures the raw signals.

**Files:** Modify `src/audits/browser.ts`, `tests/audits/browser.test.ts` (Test)

- [ ] **Step 1: Write the failing `summarizeBrowser` tests.** In `tests/audits/browser.test.ts`, first replace the existing `route()` helper (top of the file) so every `RouteResult` carries the new fields with sensible defaults:

```ts
function route(
  url: string,
  desktopOk: boolean,
  mobileOk: boolean,
  links: string[] = [],
  over: { status?: number | null; title?: string | null; metaDescription?: string | null } = {},
): RouteResult {
  return {
    url,
    desktop: [
      { engine: "chromium", ok: desktopOk },
      { engine: "firefox", ok: desktopOk },
      { engine: "webkit", ok: desktopOk },
    ],
    mobile: [
      { device: "Pixel 7", ok: mobileOk },
      { device: "iPhone 14", ok: mobileOk },
    ],
    links,
    status: over.status !== undefined ? over.status : 200,
    title: over.title !== undefined ? over.title : `Title for ${url}`,
    metaDescription: over.metaDescription !== undefined ? over.metaDescription : `Meta for ${url}`,
  };
}
```

Then add a new `describe` block:

```ts
describe("summarizeBrowser → reachableOk + titleMetaOk", () => {
  it("reachableOk true when every sampled route is 2xx/3xx", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { status: 200 }),
        route("https://a.com/b", true, true, [], { status: 301 }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.reachableOk).toBe(true);
  });

  it("reachableOk false when any route is 4xx/5xx or unreachable (null status)", () => {
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { status: 404 })], [], { "/": 1 })
        .reachableOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { status: null })], [], { "/": 1 })
        .reachableOk,
    ).toBe(false);
  });

  it("reachableOk false for empty observations (prove, don't assume)", () => {
    expect(summarizeBrowser([], [], {}).reachableOk).toBe(false);
  });

  it("titleMetaOk true when every route has a non-empty title ≤70 + meta, all titles unique", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Home", metaDescription: "Welcome home" }),
        route("https://a.com/b", true, true, [], { title: "About", metaDescription: "About us" }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleMetaOk).toBe(true);
  });

  it("titleMetaOk false when a title is empty, missing meta, or >70 chars", () => {
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { title: "" })], [], { "/": 1 })
        .titleMetaOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { metaDescription: "" })], [], {
        "/": 1,
      }).titleMetaOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { title: "x".repeat(71) })], [], {
        "/": 1,
      }).titleMetaOk,
    ).toBe(false);
  });

  it("titleMetaOk false on duplicate titles across the sample", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Same", metaDescription: "one" }),
        route("https://a.com/b", true, true, [], { title: "Same", metaDescription: "two" }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleMetaOk).toBe(false);
  });

  it("titleMetaOk false for empty observations (nothing proven)", () => {
    expect(summarizeBrowser([], [], {}).titleMetaOk).toBe(false);
  });
});
```

Also extend the existing "passes when all three verdicts are green" `browserAudit` case to assert the new verdicts flow into `details`. Add after its `expect(r.details).toMatchObject(...)` line:

```ts
expect(r.details).toMatchObject({ reachableOk: true, titleMetaOk: true });
```

(That case's `fakeRunner` builds routes via `route(...)`, which now defaults `status:200` + unique titles + meta, so both verdicts are true.)

- [ ] **Step 2: Run it — confirm it fails.** `reachableOk`/`titleMetaOk` aren't produced yet.

```bash
pnpm exec vitest run tests/audits/browser.test.ts
```

Expected: FAIL — `RouteResult` has no `status`/`title`/`metaDescription` (type error in the helper) and `s.reachableOk` is `undefined`.

- [ ] **Step 3: Extend the `RouteResult` and `BrowserSummary` types.** In `src/audits/browser.ts`, replace the `RouteResult` type with:

```ts
/** One route probed across desktop engines + mobile devices, plus the internal links found on it,
 *  plus the chromium-derived reachability + SEO signals (captured on the page chromium already
 *  opened — no extra navigation). */
export type RouteResult = {
  url: string;
  /** Per desktop engine (chromium/firefox/webkit): loaded with no JS error + a visible main landmark. */
  desktop: Array<{ engine: string; ok: boolean }>;
  /** Per mobile device: loaded with no JS error and no horizontal overflow. */
  mobile: Array<{ device: string; ok: boolean }>;
  /** Same-origin links discovered on the page (absolute URLs), for the Links check. */
  links: string[];
  /** HTTP status of the chromium navigation (2xx/3xx = reachable). null = the nav failed/threw. */
  status: number | null;
  /** The chromium `<title>` (trimmed by the reducer), or null when not captured. */
  title: string | null;
  /** The chromium `meta[name="description"]` content, or null when absent/not captured. */
  metaDescription: string | null;
};
```

Replace the `BrowserSummary` type with:

```ts
export type BrowserSummary = {
  desktopOk: boolean;
  mobileOk: boolean;
  linksOk: boolean;
  /** Every sampled route returned a 2xx/3xx status (point-in-time uptime). */
  reachableOk: boolean;
  /** Every sampled route has a non-empty `<title>` ≤ 70 chars + a non-empty meta description, and
   *  no two routes share a title. */
  titleMetaOk: boolean;
  brokenLinks: number;
  routesChecked: number;
  note: string;
};
```

- [ ] **Step 4: Compute the two verdicts in `summarizeBrowser`.** In `src/audits/browser.ts`, inside `summarizeBrowser`, add after the `linksOk` line (`const linksOk = links.length > 0 && brokenLinks === 0;`):

```ts
// reachableOk: every sampled route returned 2xx/3xx. Empty observations → false (fail-safe).
const reachableOk =
  routes.length > 0 && routes.every((r) => r.status !== null && r.status >= 200 && r.status < 400);

// titleMetaOk (chromium-only signals): every route has a non-empty title ≤ 70 chars + a non-empty
// meta description, AND no two routes share a title. Empty observations → false (fail-safe).
const trimmedTitles = routes.map((r) => (r.title ?? "").trim());
const eachTitleMetaValid =
  routes.length > 0 &&
  routes.every((r, i) => {
    const t = trimmedTitles[i]!;
    const desc = (r.metaDescription ?? "").trim();
    return t.length > 0 && t.length <= 70 && desc.length > 0;
  });
const noDuplicateTitles = new Set(trimmedTitles).size === trimmedTitles.length;
const titleMetaOk = eachTitleMetaValid && noDuplicateTitles;
```

and add both to the returned object — change the final `return { desktopOk, mobileOk, linksOk, brokenLinks, routesChecked: routes.length, note };` to:

```ts
return {
  desktopOk,
  mobileOk,
  linksOk,
  reachableOk,
  titleMetaOk,
  brokenLinks,
  routesChecked: routes.length,
  note,
};
```

- [ ] **Step 5: Capture the raw signals in `defaultBrowserRunner`.** In `src/audits/browser.ts`, inside the `probe(urls)` method, in the per-URL loop, add three route-level captures next to `const desktop` / `const linkSet` declarations:

```ts
let status: number | null = null;
let title: string | null = null;
let metaDescription: string | null = null;
```

Then, inside the chromium branch `if (engine === "chromium") { ... }` (which already runs the link `evaluate`), add at the TOP of that branch, before the `const hrefs` line:

```ts
status = resp ? resp.status() : null;
title = ((await page.title().catch(() => "")) as string).trim() || null;
metaDescription =
  (
    ((await page
      .evaluate(
        "document.querySelector('meta[name=\"description\"]')?.getAttribute('content') || ''",
      )
      .catch(() => "")) as string) || ""
  ).trim() || null;
```

Finally, extend the `results.push({ ... })` at the end of the per-URL loop from `results.push({ url, desktop, mobile, links: [...linkSet] });` to:

```ts
results.push({ url, desktop, mobile, links: [...linkSet], status, title, metaDescription });
```

(No change to the audit's own pass/warn rollup — the two new verdicts persist independently; `summarizeBrowser`'s `note` and the `status` line already cover the existing three verdicts.)

- [ ] **Step 6: Run the browser tests — confirm they pass.**

```bash
pnpm exec vitest run tests/audits/browser.test.ts
```

Expected: PASS (the new `describe` block green; existing `summarizeBrowser`/`browserAudit` cases still green).

- [ ] **Step 7: Typecheck.**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 8: Commit.**

```bash
git add src/audits/browser.ts tests/audits/browser.test.ts
git commit -m "feat(audits): browser audit emits reachableOk + titleMetaOk verdicts"
```

---

### Task 5: Persist the browser verdicts (tri-state single-select columns)

Carry `reachableOk`/`titleMetaOk` through the browser write path: the `-airtable` extractor, the `BrowserAuditFields` type, the `browserFields` writer (serialize `true→"pass"`, `false→"fail"` — single-select tri-state), and the `WebsiteRow` fields (already added in Task 1, mapRow already reads them). Gated by the existing `browserCheckedAt` (no new timestamp).

**Files:** Modify `src/audits/browser-airtable.ts`, `src/reports/airtable/websites.ts`, `tests/audits/write-audits-to-airtable.test.ts` (Test)

- [ ] **Step 1: Write the failing write-path assertion.** In `tests/audits/write-audits-to-airtable.test.ts`, extend the existing "merges the browser verdicts into the single atomic write" test: add `reachableOk`/`titleMetaOk` to its `browserResult` details and to the asserted fields. Change its `details` object to:

```ts
      details: {
        desktopOk: true,
        mobileOk: false,
        linksOk: true,
        reachableOk: true,
        titleMetaOk: false,
        brokenLinks: 0,
        checkedAt: "2026-06-18T00:00:00.000Z",
      },
```

and add to its `toMatchObject({ ... })`:

```ts
      "Uptime Reachable": "pass",
      "Titles & Meta OK": "fail",
```

- [ ] **Step 2: Run it — confirm it fails.** The writer doesn't emit the two columns yet.

```bash
pnpm exec vitest run tests/audits/write-audits-to-airtable.test.ts
```

Expected: FAIL — `Uptime Reachable` / `Titles & Meta OK` absent from the written fields.

- [ ] **Step 3: Extend `BrowserAuditFields` + `browserFields`.** In `src/reports/airtable/websites.ts`, extend the `BrowserAuditFields` type — add after `linksOk: boolean;`:

```ts
reachableOk: boolean;
titleMetaOk: boolean;
```

and extend the `browserFields` writer to emit the two single-select verdicts:

```ts
function browserFields(r: BrowserAuditFields): FieldSet {
  return {
    "Crossbrowser OK": r.desktopOk,
    "Mobile OK": r.mobileOk,
    "Links OK": r.linksOk,
    "Broken links": r.brokenLinks,
    "Browser checked at": r.checkedAt,
    // NEW tri-state single-select verdicts (empty = never ran). The browser audit only produces a
    // BrowserAuditFields when it actually ran (hasBrowserResult guards on checkedAt), so each verdict
    // is always a concrete boolean here — serialize true→"pass", false→"fail". The existing boolean
    // columns above are deliberately NOT retrofitted (out of scope).
    "Uptime Reachable": r.reachableOk ? "pass" : "fail",
    "Titles & Meta OK": r.titleMetaOk ? "pass" : "fail",
  };
}
```

- [ ] **Step 4: Extend the extractor.** In `src/audits/browser-airtable.ts`, extend the `BrowserDetails` type — add after `linksOk: boolean;`:

```ts
reachableOk: boolean;
titleMetaOk: boolean;
```

and extend `browserFieldsFromAudit`'s returned object — add after `linksOk: d?.linksOk === true,`:

```ts
    reachableOk: d?.reachableOk === true,
    titleMetaOk: d?.titleMetaOk === true,
```

- [ ] **Step 5: Run the write-path test — confirm it passes.**

```bash
pnpm exec vitest run tests/audits/write-audits-to-airtable.test.ts
```

Expected: PASS (the extended browser-merge assertions green; all other cases still green).

- [ ] **Step 6: Typecheck.**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit.**

```bash
git add src/audits/browser-airtable.ts src/reports/airtable/websites.ts tests/audits/write-audits-to-airtable.test.ts
git commit -m "feat(audits): persist browser reachableOk + titleMetaOk (tri-state single-select)"
```

---

### Task 6: Full-gate verification

Run the complete CI gate over the whole change set (both typecheck configs, lint + prettier, the coverage floors over `src/**/*.ts`, the tsup build, and the dist import-graph smoke) and confirm the working tree stays clean.

**Files:** none (verification only)

- [ ] **Step 1: Typecheck (both configs).**

```bash
pnpm typecheck
```

Expected: exit 0 (`tsc --noEmit` and `-p tsconfig.netlify.json` both clean).

- [ ] **Step 2: Lint + format.**

```bash
pnpm lint
```

Expected: exit 0 (eslint clean — no `no-explicit-any`; prettier `--check` clean). If prettier flags formatting, run `pnpm exec prettier --write .` on the touched files, re-run, and amend the relevant commit.

- [ ] **Step 3: Coverage — every new `src` file is exercised, floors hold.**

```bash
pnpm test:coverage
```

Expected: all suites green; coverage at/above statements 78 / branches 67 / functions 76 / lines 80. (`function-health.ts`, `function-health-airtable.ts`, and the browser/websites additions are each covered by the tests added above.)

- [ ] **Step 4: Build + dist smoke (the audit import graph must not reach central-only packages).**

```bash
pnpm build && pnpm test:dist
```

Expected: exit 0; `smoke-dist` prints each check with `✓` (loading the CLI/forms/configs entries under the central-dep blocker does not resolve `airtable`/libSQL/`mjml` — the new `function-health-airtable.ts` uses `import type` only).

- [ ] **Step 5: Working tree clean (tests wrote only to tmpdir).**

```bash
git status --porcelain
```

Expected: empty output.

- [ ] **Step 6: Confirm the commit series.**

```bash
git log --oneline main..HEAD
```

Expected: the five feat commits from Tasks 1–5, in order.

---

## Notes for the executor

- **Scope boundary:** this plan PRODUCES and PERSISTS columns only. The auto-tick evidence functions (`deployEvidence`, `cmsEvidence`, `uptimeEvidence`, `titlesEvidence`) that READ `functionHealth`/`cmsReachable`/`functionHealthCheckedAt`/`deployCheckedAt`/`reachableOk`/`titleMetaOk` are Plan 4 — do not add them here.
- **`/health` is a Plan 1 (reddoor-starter) dependency.** The audit degrades safely if `/health` is absent (self-skip → preserve prior), so this plan's tests never hit a live endpoint — all `/health` IO is dep-injected. In production the verdicts stay "never ran" until each site ships `/health`.
- **New Airtable columns are operator-created single-selects.** `Function health`, `CMS Reachable`, `Uptime Reachable`, `Titles & Meta OK` are single-select with options `pass`/`fail` (empty = never ran); `Function health checked at` is a date/text column. `Deploy checked at` already exists (netlify-deploy writes it). The code reads a missing column as `null` (harmless) and Airtable rejects a write to a truly-absent column with `UNKNOWN_FIELD_NAME`, so the columns must exist before the nightly write-back lands — an operator/controller step, out of code scope.
- **`function-health` self-skip semantics (per this plan's scope):** unreachable / non-2xx / non-JSON → `skip` (no details → preserve prior). The only `fail` is a reachable 200-JSON `/health` that self-reports `ok:false`. See open issue #1.
