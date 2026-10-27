# Health Gate Plan 1 — Starter (/health endpoint + smoke suite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the reddoor-starter half of the Report Health Gate — a public, leak-safe `/health` endpoint that server-side-probes Prismic and reports form-config presence, plus promote reddoor-website's `test:unit`/`test:smoke` split (shared Playwright config + committed per-site route manifest + hydration/console smoke suite) into the starter so every `/new-site` clone inherits it.

**Architecture:** Two independent spec phases, both scoped entirely to `reddoor-starter`. Phase 1 adds `src/routes/health/+server.ts` (`prerender = false` → deploys as a Netlify function under adapter-netlify v6) returning `{ ok, prismic, forms }`; the downstream `function-health` audit (Plan 2, reddoor-maintenance) consumes this contract. Phase 4 rewires the test scripts, replaces the inline `playwright.config.ts` with a 4-line spread of the shared `@reddoorla/maintenance/configs/playwright-a11y` base (+ `reducedMotion:"reduce"`), moves the single a11y spec under `tests/a11y/`, and adds a `tests/smoke/` suite driven by a committed `routes.ts` manifest. No maintenance-side code is touched here; the off-disk `reddoorla/.github@45ded88` reusable CI workflow bump is noted but not built.

**Tech Stack:** SvelteKit 2 (adapter-netlify v6), Svelte 5, TypeScript (strict, `moduleResolution: bundler`), Vitest 4 (jsdom env, `src/**/*.test.ts`), Playwright 1.6x (`tests/**/*.spec.ts`), `@prismicio/client` / `@prismicio/svelte`, pnpm 11.8.

---

## File Structure

**Phase 1 — `/health` endpoint**

- **Create** `src/routes/health/+server.ts` — GET handler returning `{ ok, prismic, forms }`; `prerender = false`; server-side Prismic reachability probe (public `getRepository`, no token, time-boxed, status string only) + forms-config booleans; never POSTs to the ingest.
- **Create** `src/routes/health/server.test.ts` — Vitest unit test for the GET handler: prismic `ok`/`error`/`skipped`, forms booleans, and never-POST, with `$lib/prismicio` + `$env/dynamic/*` mocked.

**Phase 4 — smoke-suite promotion**

- **Modify** `package.json:14-16` — replace `test`/`test:watch`/`test:a11y` scripts with `test:unit`/`test:unit:watch`/`test:smoke` (matches reddoor-website).
- **Modify** `playwright.config.ts` (full-file replace) — 4-line `...base` spread of `@reddoorla/maintenance/configs/playwright-a11y` + `use.reducedMotion:"reduce"`.
- **Move** `tests/a11y.spec.ts` → `tests/a11y/fixtures.spec.ts` — unchanged content (the `/dev/*` axe fixtures), relocated under the a11y lane.
- **Create** `tests/smoke/routes.ts` — committed per-site manifest: `SmokeRoute = {path, name, hydrationMarker?, expectStatus?}`; ships the safe default (`/` + `footer` marker) that each site's figma-slices build grows.
- **Create** `tests/smoke/pages.spec.ts` — `attachConsoleWatcher` + per-route status + hydration-marker assertion (driven off the manifest) + a `404` renders-error-component test.

**Out of scope (noted, do not build):** the authoritative off-disk reusable CI workflow `reddoorla/.github` (pinned `@45ded88`) must be bumped to invoke both `pnpm test:unit` and `pnpm test:smoke` — the single lever that makes the split actually run on PRs. It lives outside all three repos and is owned as Phase 4 follow-up.

---

### Task 1: `/health` endpoint

**Files:**

- Create: `src/routes/health/+server.ts`
- Test: `src/routes/health/server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/routes/health/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factories (also hoisted) can close over the same
// mutable objects. `isPlaceholderRepo` is exposed as a getter so the endpoint's
// live ES binding re-reads it each call; the env objects are mutated in place
// (never reassigned) so the module keeps the reference the factory captured.
const mocks = vi.hoisted(() => ({
  isPlaceholderRepo: false,
  getRepository: vi.fn<() => Promise<unknown>>(),
  privateEnv: {} as Record<string, string | undefined>,
  publicEnv: {} as Record<string, string | undefined>,
}));

vi.mock("$lib/prismicio", () => ({
  createClient: () => ({ getRepository: mocks.getRepository }),
  get isPlaceholderRepo() {
    return mocks.isPlaceholderRepo;
  },
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.privateEnv }));
vi.mock("$env/dynamic/public", () => ({ env: mocks.publicEnv }));

import { GET } from "./+server";

type HealthBody = {
  ok: boolean;
  prismic: "ok" | "error" | "skipped";
  forms: { ingestUrl: boolean; ingestToken: boolean; turnstile: boolean };
};

// Spy fetch handed to the handler. The endpoint passes it to createClient (which
// is mocked and ignores it), so a clean run leaves this untouched — that is how
// we prove /health never POSTs to the ingest.
const fetchSpy = vi.fn();

async function callHealth(): Promise<{ status: number; body: HealthBody }> {
  const res = await GET({
    fetch: fetchSpy,
  } as unknown as Parameters<typeof GET>[0]);
  return { status: res.status, body: (await res.json()) as HealthBody };
}

beforeEach(() => {
  mocks.isPlaceholderRepo = false;
  mocks.getRepository.mockReset();
  delete mocks.privateEnv.FORMS_INGEST_URL;
  delete mocks.privateEnv.FORMS_INGEST_TOKEN;
  delete mocks.publicEnv.PUBLIC_TURNSTILE_SITE_KEY;
  fetchSpy.mockReset();
});

describe("/health GET", () => {
  it("reports prismic 'ok' and ok:true when getRepository resolves", async () => {
    mocks.getRepository.mockResolvedValue({ id: "repo" });
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body.prismic).toBe("ok");
    expect(body.ok).toBe(true);
  });

  it("reports prismic 'error' and ok:false when getRepository rejects", async () => {
    mocks.getRepository.mockRejectedValue(new Error("network down"));
    const { body } = await callHealth();
    expect(body.prismic).toBe("error");
    expect(body.ok).toBe(false);
  });

  it("reports prismic 'skipped' (ok:true) and never calls Prismic on the placeholder repo", async () => {
    mocks.isPlaceholderRepo = true;
    const { body } = await callHealth();
    expect(body.prismic).toBe("skipped");
    expect(body.ok).toBe(true);
    expect(mocks.getRepository).not.toHaveBeenCalled();
  });

  it("maps forms env presence to booleans", async () => {
    mocks.getRepository.mockResolvedValue({});
    mocks.privateEnv.FORMS_INGEST_URL = "https://ingest.example/submit";
    // FORMS_INGEST_TOKEN intentionally left unset.
    mocks.publicEnv.PUBLIC_TURNSTILE_SITE_KEY = "0x_site_key";
    const { body } = await callHealth();
    expect(body.forms).toEqual({
      ingestUrl: true,
      ingestToken: false,
      turnstile: true,
    });
  });

  it("never POSTs to the ingest (public, unauthenticated endpoint)", async () => {
    mocks.getRepository.mockResolvedValue({});
    mocks.privateEnv.FORMS_INGEST_URL = "https://ingest.example/submit";
    mocks.privateEnv.FORMS_INGEST_TOKEN = "secret";
    await callHealth();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/health/server.test.ts`
Expected: FAIL — Vitest cannot resolve the import `./+server` ("Failed to resolve import \"./+server\"" / "Cannot find module"), because the endpoint does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/health/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { createClient, isPlaceholderRepo } from "$lib/prismicio";
import type { RequestHandler } from "./$types";

// Deploys as a Netlify function under adapter-netlify v6 — a live probe, so it
// must never be prerendered.
export const prerender = false;

type PrismicHealth = "ok" | "error" | "skipped";

// Server-side Prismic reachability probe. Hits the PUBLIC repository-metadata
// endpoint (getRepository — no token), time-boxed, and returns ONLY a status
// string. The repository body is never included: /health is public and
// unauthenticated, so it exposes booleans and status strings, nothing more.
async function probePrismic(fetch: typeof globalThis.fetch): Promise<PrismicHealth> {
  if (isPlaceholderRepo) return "skipped";
  const client = createClient({ fetch });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("prismic health probe timed out")), 5000);
    });
    await Promise.race([client.getRepository(), timeout]);
    return "ok";
  } catch {
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const GET: RequestHandler = async ({ fetch }) => {
  const prismic = await probePrismic(fetch);
  const forms = {
    ingestUrl: !!privateEnv.FORMS_INGEST_URL,
    ingestToken: !!privateEnv.FORMS_INGEST_TOKEN,
    turnstile: !!publicEnv.PUBLIC_TURNSTILE_SITE_KEY,
  };
  // We are inside the handler, so the function ran. The downstream function-health
  // audit treats an unreachable endpoint as "not present"; ok is false only when
  // the Prismic probe actively errored.
  const functionRan = true;
  const ok = functionRan && prismic !== "error";
  return json({ ok, prismic, forms });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/routes/health/server.test.ts`
Expected: PASS — `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

- [ ] **Step 5: Typecheck the new route**

Run: `pnpm check`
Expected: `svelte-check` completes with `0 errors` (it runs `svelte-kit sync` first, which generates `.svelte-kit/types/src/routes/health/$types.d.ts` for the `RequestHandler` import).

- [ ] **Step 6: Commit**

```bash
git add src/routes/health/+server.ts src/routes/health/server.test.ts
git commit -m "feat(health): add /health endpoint (ok + server-side Prismic probe + forms booleans)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Split test scripts into `test:unit` / `test:smoke`

**Files:**

- Modify: `package.json:14-16`

- [ ] **Step 1: Replace the test scripts**

In `package.json`, replace these three lines (currently `package.json:14-16`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:a11y": "playwright test",
```

with (matches `reddoor-website/package.json:18-20`):

```json
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:smoke": "playwright install chromium && playwright test",
```

- [ ] **Step 2: Run the unit lane to confirm it works under the new name**

Run: `pnpm test:unit`
Expected: PASS — Vitest runs every `src/**/*.test.ts` (including `src/routes/health/server.test.ts` from Task 1 and the existing `src/lib/components/TurnstileWidget.test.ts`) and reports all files passed. There should be no `Missing script: "test"` error because nothing references the old name.

- [ ] **Step 3: Confirm the old script name is gone**

Run: `pnpm run 2>&1 | grep -E "test:unit|test:smoke|test:a11y" || true`
Expected: lists `test:unit`, `test:unit:watch`, `test:smoke`; `test:a11y` is absent.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(test): split scripts into test:unit + test:smoke (match reddoor-website)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Replace inline Playwright config with the shared base spread

**Files:**

- Modify: `playwright.config.ts` (full-file replace)

- [ ] **Step 1: Replace the entire file**

Overwrite `playwright.config.ts` with (matches `reddoor-website/playwright.config.ts`; the shared base lives at `@reddoorla/maintenance/configs/playwright-a11y`, whose subpath export resolves in installed `node_modules`):

```ts
import { defineConfig } from "@playwright/test";
import base from "@reddoorla/maintenance/configs/playwright-a11y";

// Emulate reduced motion in tests: instant scrollIntoView (no long animated
// smooth-scroll that flakes Playwright's actionability checks under parallel
// load) and view transitions fall back to instant. Pairs with the
// prefers-reduced-motion gate on scroll-behavior in src/app.css.
export default defineConfig({
  ...base,
  use: { ...base.use, reducedMotion: "reduce" },
});
```

- [ ] **Step 2: Confirm the config loads and discovers specs**

Run: `pnpm exec playwright test --list`
Expected: Playwright loads the config (proving the `@reddoorla/maintenance/configs/playwright-a11y` import resolves) and lists the two existing a11y fixture tests from `tests/a11y.spec.ts` — `a11y fixtures has no axe violations` and `animate-in demo has no axe violations`. `--list` does not start the web server, so this is fast.

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: `0 errors`.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts
git commit -m "chore(test): use shared playwright-a11y base config (+ reducedMotion reduce)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Move the a11y spec under `tests/a11y/`

**Files:**

- Move: `tests/a11y.spec.ts` → `tests/a11y/fixtures.spec.ts` (content unchanged)

- [ ] **Step 1: Move the file with git**

Run:

```bash
mkdir -p tests/a11y
git mv tests/a11y.spec.ts tests/a11y/fixtures.spec.ts
```

The content is unchanged — it is still the axe scan of the two `/dev/*` fixture routes. For reference, `tests/a11y/fixtures.spec.ts` should read exactly:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = [
  { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
  { path: "/dev/animate-in", name: "animate-in demo" },
];

for (const { path, name } of pages) {
  test(`${name} has no axe violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

- [ ] **Step 2: Run the a11y lane to confirm the move (clean green checkpoint)**

Run: `pnpm test:smoke`
Expected: PASS — Playwright installs chromium (no-op if cached), boots `vite:dev`, waits for `http://localhost:5173/dev/a11y-fixtures` to 200, then runs the relocated spec. Both fixture tests pass (`2 passed`) because the `/dev/*` routes render without Prismic, so they are green even on the unwired placeholder repo. This confirms the recursive `testDir: "tests"` + `testMatch: /.*\.spec\.ts$/` from the shared base picks up the nested `tests/a11y/` path.

- [ ] **Step 3: Commit**

```bash
git add tests/a11y/fixtures.spec.ts
git commit -m "chore(test): relocate a11y spec to tests/a11y/fixtures.spec.ts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Add the committed per-site route manifest

**Files:**

- Create: `tests/smoke/routes.ts`

- [ ] **Step 1: Create the manifest**

Create `tests/smoke/routes.ts`:

```ts
// Committed per-site smoke manifest. `tests/smoke/pages.spec.ts` iterates this
// list, asserting each route returns its expected status and paints a hydration
// marker with no console errors. This ships the SAFE DEFAULT every reddoor-starter
// clone inherits; each site's figma-slices build grows the list as real routes
// land (add `{ path, name, hydrationMarker }` entries).
//
// NOTE on the default `/` entry: it expects 200, which holds once the clone is
// wired to a real Prismic repo (getByUID("page","home") resolves). On the bare
// placeholder starter, `/` returns 404 (the Prismic lookup throws → error(404)),
// so the `/` case only goes green after Prismic is wired — by design, since the
// gate is about real site health. The hydration marker `footer` is the shared
// layout footer, present on every page including the error page.

export type SmokeRoute = {
  /** Route path to visit, e.g. "/" or "/about". */
  path: string;
  /** Human-readable label used in the test title. */
  name: string;
  /** CSS selector asserted visible after load (hydration proof). Default: skip. */
  hydrationMarker?: string;
  /** Expected HTTP status. Default: 200. */
  expectStatus?: number;
};

export const smokeRoutes: SmokeRoute[] = [{ path: "/", name: "home", hydrationMarker: "footer" }];
```

- [ ] **Step 2: Typecheck the manifest**

Run: `pnpm check`
Expected: `0 errors` — the generated `.svelte-kit/tsconfig.json` includes `../tests/**/*.ts`, so `svelte-check` typechecks the manifest.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/routes.ts
git commit -m "test(smoke): add committed per-site route manifest (safe default / + footer)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Add the smoke suite (console + status + hydration + 404)

**Files:**

- Create: `tests/smoke/pages.spec.ts`

- [ ] **Step 1: Write the smoke suite**

Create `tests/smoke/pages.spec.ts` (mirrors `reddoor-website/tests/smoke/pages.spec.ts`'s `attachConsoleWatcher` + per-route + 404 shape, but iterates the committed manifest):

```ts
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { smokeRoutes } from "./routes";

// Console messages we don't care about. Add patterns here only after seeing them
// in CI and confirming they aren't actionable. Patterns are matched against both
// the message text and the offending resource URL — Chromium's "Failed to load
// resource" text omits the URL, so URL matching catches third-party network noise.
const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // Vimeo iframe embeds + their CDN telemetry endpoints occasionally 403 from
  // cloud IPs due to bot detection.
  /vimeo/i,
  // Turnstile (Cloudflare) telemetry occasionally surfaces in console.
  /turnstile|challenges\.cloudflare/i,
];

function attachConsoleWatcher(page: Page, extraAllowed: RegExp[] = []) {
  const errors: string[] = [];
  const allowed = [...ALLOWED_CONSOLE_PATTERNS, ...extraAllowed];
  const isAllowed = (s: string) => !!s && allowed.some((re) => re.test(s));

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location()?.url ?? "";
    if (isAllowed(text) || isAllowed(url)) return;
    errors.push(`[console.error] ${text}${url ? ` (${url})` : ""}`);
  });

  page.on("pageerror", (err) => {
    if (isAllowed(err.message)) return;
    errors.push(`[pageerror] ${err.message}`);
  });

  return errors;
}

for (const route of smokeRoutes) {
  test(`${route.path} (${route.name}) loads with no console errors`, async ({ page }) => {
    const errors = attachConsoleWatcher(page);
    const response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), `HTTP status for ${route.path}`).toBe(route.expectStatus ?? 200);
    if (route.hydrationMarker) {
      await expect(
        page.locator(route.hydrationMarker),
        `hydration marker "${route.hydrationMarker}" on ${route.path}`,
      ).toBeVisible();
    }
    expect(errors, `console errors on ${route.path}`).toEqual([]);
  });
}

test("404 page renders the custom error component", async ({ page }) => {
  // The browser logs a top-level "Failed to load resource: 404" for the page
  // itself — expected on a 404 route, not a bug. Allow it here.
  const errors = attachConsoleWatcher(page, [/Failed to load resource.*404/i]);
  const response = await page.goto("/this-uid-does-not-exist", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(404);
  // src/routes/+error.svelte renders `<h1>{page.status}</h1>` → "404".
  await expect(page.getByText("404", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Typecheck the spec**

Run: `pnpm check`
Expected: `0 errors` (the spec imports `smokeRoutes` from `./routes` and `@playwright/test` types; both resolve).

- [ ] **Step 3: Run the full smoke suite**

Run: `pnpm test:smoke`
Expected: Playwright boots `vite:dev` and runs `tests/a11y/fixtures.spec.ts` + `tests/smoke/pages.spec.ts`. The two a11y fixture tests and the `404 page renders the custom error component` test PASS on any clone (including the placeholder). The `/ (home)` test asserts status `200`: it PASSES on a Prismic-wired clone and reports `404` on the bare placeholder starter (documented in `tests/smoke/routes.ts` — the `/` route's Prismic lookup throws → `error(404)` until wired). Confirm the suite RUNS and discovers all three spec files (the spec's acceptance per the design's testing strategy: "smoke-suite promotion validated by the suite running").

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/pages.spec.ts
git commit -m "test(smoke): add per-route status + hydration + console + 404 suite" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phases 1 and 4 only — this plan's scope):**

- Phase 1 — Starter `/health` endpoint (`{ ok, prismic, forms }`, `prerender = false`, public server-side Prismic probe via `createClient({fetch}).getRepository()`, `"skipped"` on `isPlaceholderRepo`, try/catch + time-box, status string only, forms booleans from `FORMS_INGEST_URL`/`FORMS_INGEST_TOKEN`/`PUBLIC_TURNSTILE_SITE_KEY`, never POST to ingest, `ok = functionRan && prismic !== "error"`) → **Task 1**.
- Phase 4 — `test:unit`/`test:smoke` script split → **Task 2**; 4-line `...base` spread of `@reddoorla/maintenance/configs/playwright-a11y` + `reducedMotion:"reduce"` → **Task 3**; `tests/a11y.spec.ts` → `tests/a11y/fixtures.spec.ts` → **Task 4**; committed `tests/smoke/routes.ts` manifest (`{path,name,hydrationMarker?,expectStatus?}[]`, safe default `/` + footer marker) → **Task 5**; `tests/smoke/pages.spec.ts` (`attachConsoleWatcher` + per-route 200 + hydration marker + 404) → **Task 6**.
- Off-disk `reddoorla/.github@45ded88` reusable CI bump → noted in **File Structure / Out of scope**, not built (per scope).

**Placeholder scan:** No `TBD`/`similar to`/`add error handling` placeholders — every code step is complete and repeated verbatim, not cross-referenced.

**Type consistency:** `SmokeRoute` (Task 5) is the exact type imported by `pages.spec.ts` (Task 6); `PrismicHealth`/`HealthBody` union `"ok"|"error"|"skipped"` matches between endpoint (Task 1 Step 3) and test (Task 1 Step 1); `GET` handler shape (`RequestHandler`) matches the test's `Parameters<typeof GET>[0]` call.
